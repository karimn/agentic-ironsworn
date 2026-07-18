import { readFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveWorldContext, loadWorldJson } from "../world.js";
import { getWorldDb, openWorldWriteConn, getWorldEmbedding } from "./world-db.js";
import { upsertLore, linkLore, canonizeEntity, type LoreType } from "./lore.js";

// ---------------------------------------------------------------------------
// Setting seed (FW4, #199): package a world's canon (`campaign_id IS NULL`
// entities, relations, and community summaries) as a portable JSON file, and
// load one into a fresh world at init time.
//
// This is the fiction-facing half of "setting as world seed"
// (docs/design/agentic-rpg-v1.md). Packaging/distribution as an installable
// npm setting module (docs/design/agentic-rpg-v1.md's "Setting package"
// contract) is platform work (#7) and deliberately out of scope here — the
// seed is a plain JSON file the player points `ironsworn-init.sh
// --from-setting` at.
// ---------------------------------------------------------------------------

export const SETTING_SEED_SCHEMA_VERSION = 1;

export const SETTING_SEED_PENDING_FILENAME = "setting-seed.pending.json";
export const SETTING_SEED_IMPORTED_FILENAME = "setting-seed.imported.json";

export interface SettingSeedEntity {
  id: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  aliases: string[];
}

export interface SettingSeedRelation {
  from_entity: string;
  to_entity: string;
  label: string;
  notes: string | null;
  metadata: Record<string, unknown>;
}

export interface SettingSeedCommunity {
  id: string;
  level: number;
  parent_id: string | null;
  member_ids: string[];
  member_count: number;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface SettingSeed {
  schemaVersion: number;
  sourceWorld: string;
  exportedAt: string;
  entities: SettingSeedEntity[];
  relations: SettingSeedRelation[];
  communities: SettingSeedCommunity[];
}

export interface SettingSeedImportCounts {
  entities: number;
  relations: number;
  communities: number;
}

// ---------------------------------------------------------------------------
// Export — filter the world DB to `campaign_id IS NULL` canon
// ---------------------------------------------------------------------------

export async function exportSettingSeed(campaignPath: string): Promise<SettingSeed> {
  const ctx = await resolveWorldContext(campaignPath);
  const [worldJson, instance] = await Promise.all([
    loadWorldJson(ctx.worldRoot),
    getWorldDb(ctx),
  ]);
  const conn = await instance.connect();
  try {
    const [entRows, relRows, communityRows] = await Promise.all([
      conn.runAndReadAll(
        `SELECT id, canonical, aliases, type, summary, content, metadata
         FROM entities WHERE campaign_id IS NULL ORDER BY created_at`,
      ),
      conn.runAndReadAll(
        `SELECT from_entity, to_entity, label, notes, metadata
         FROM relations WHERE campaign_id IS NULL AND invalid_at IS NULL ORDER BY created_at`,
      ),
      conn.runAndReadAll(
        `SELECT id, level, parent_id, member_ids, member_count, summary, metadata
         FROM lore_communities WHERE campaign_id IS NULL ORDER BY level, created_at`,
      ),
    ]);

    const entities: SettingSeedEntity[] = (entRows.getRowObjectsJS() as Record<string, unknown>[]).map((r) => ({
      id: String(r["id"]),
      canonical: String(r["canonical"]),
      type: String(r["type"]) as LoreType,
      summary: String(r["summary"]),
      content: JSON.parse(typeof r["content"] === "string" ? r["content"] : "{}") as Record<string, unknown>,
      metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
      aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
    }));

    const relations: SettingSeedRelation[] = (relRows.getRowObjectsJS() as Record<string, unknown>[]).map((r) => ({
      from_entity: String(r["from_entity"]),
      to_entity: String(r["to_entity"]),
      label: String(r["label"]),
      notes: r["notes"] != null ? String(r["notes"]) : null,
      metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
    }));

    const communities: SettingSeedCommunity[] = (communityRows.getRowObjectsJS() as Record<string, unknown>[]).map((r) => ({
      id: String(r["id"]),
      level: Number(r["level"]),
      parent_id: r["parent_id"] != null ? String(r["parent_id"]) : null,
      member_ids: Array.isArray(r["member_ids"]) ? (r["member_ids"] as unknown[]).map(String) : [],
      member_count: Number(r["member_count"]),
      summary: String(r["summary"] ?? ""),
      metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
    }));

    return {
      schemaVersion: SETTING_SEED_SCHEMA_VERSION,
      sourceWorld: worldJson?.name ?? basename(ctx.worldRoot),
      exportedAt: new Date().toISOString(),
      entities,
      relations,
      communities,
    };
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Import — land seed rows as `campaign_id IS NULL` canon
// ---------------------------------------------------------------------------

/**
 * Load a setting seed into `campaignPath`'s world DB as world canon.
 *
 * Reuses the existing per-campaign write path rather than inserting rows
 * directly: each entity is created via `upsertLore` (scoped to the calling
 * campaign) and immediately promoted with `canonizeEntity` (the same
 * primitive the canonize ritual, FW2, uses). Once both endpoints of a
 * relation are canon, `linkLore` already resolves the relation's
 * `campaign_id` to NULL on its own (see its "both endpoints canon" check) —
 * so relations need no separate canonize step. Only community rows need a
 * direct insert, since community summaries have no per-campaign write path
 * to reuse.
 *
 * Entity/community ids are preserved from the seed (they're already UUIDs
 * exported from a source world's DB); safe because this is meant to run
 * against a freshly-scaffolded, still-empty world.
 */
export async function importSettingSeed(
  campaignPath: string,
  seed: SettingSeed,
): Promise<SettingSeedImportCounts> {
  if (seed.schemaVersion !== SETTING_SEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported setting seed schema version: ${seed.schemaVersion}`);
  }

  const idMap = new Map<string, string>();
  for (const e of seed.entities) {
    const result = await upsertLore(campaignPath, {
      id: e.id,
      canonical: e.canonical,
      type: e.type,
      summary: e.summary,
      content: e.content,
      metadata: e.metadata,
      aliases: e.aliases,
      _skipRecordingProvenance: true,
    });
    idMap.set(e.id, result.id);
    await canonizeEntity(campaignPath, result.id);
  }

  for (const r of seed.relations) {
    const fromId = idMap.get(r.from_entity) ?? r.from_entity;
    const toId = idMap.get(r.to_entity) ?? r.to_entity;
    await linkLore(campaignPath, {
      from: fromId,
      to: toId,
      relation: r.label,
      notes: r.notes ?? undefined,
      metadata: r.metadata,
      _skipRecordingProvenance: true,
    });
  }

  if (seed.communities.length > 0) {
    const ctx = await resolveWorldContext(campaignPath);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const now = new Date().toISOString();
      for (const c of seed.communities) {
        const memberIds = c.member_ids.map((m) => idMap.get(m) ?? m);
        const embedding = await getWorldEmbedding(c.summary).catch(() => null);
        const memberIdsLit = `[${memberIds.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;
        const embedLit = embedding !== null ? `[${embedding.join(",")}]::FLOAT[768]` : "NULL";
        await conn.run(
          `INSERT INTO lore_communities
             (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
           VALUES (?, ?, ?, ${memberIdsLit}, ?, ?, ${embedLit}, ?, NULL, ?, ?)`,
          [c.id, c.level, c.parent_id, c.member_count, c.summary, JSON.stringify(c.metadata), now, now],
        );
      }
    } finally {
      conn.closeSync();
    }
  }

  return {
    entities: seed.entities.length,
    relations: seed.relations.length,
    communities: seed.communities.length,
  };
}

// ---------------------------------------------------------------------------
// Pending-seed convenience — the world-init round trip
// ---------------------------------------------------------------------------

/**
 * If `<worldRoot>/setting-seed.pending.json` exists, import it as world
 * canon and rename it to `setting-seed.imported.json` so it runs exactly
 * once. `ironsworn-init.sh --from-setting <path>` stages the pending file
 * at world-init time; this is called from `buildContext` on every session
 * so the import happens transparently on the world's first context build
 * without any extra step for the player or the GM agent to remember.
 */
export async function maybeImportPendingSettingSeed(
  campaignPath: string,
): Promise<{ imported: boolean; counts?: SettingSeedImportCounts }> {
  const ctx = await resolveWorldContext(campaignPath);
  const pendingPath = join(ctx.worldRoot, SETTING_SEED_PENDING_FILENAME);
  let raw: string;
  try {
    raw = await readFile(pendingPath, "utf-8");
  } catch {
    return { imported: false };
  }

  const seed = JSON.parse(raw) as SettingSeed;
  const counts = await importSettingSeed(campaignPath, seed);
  await rename(pendingPath, join(ctx.worldRoot, SETTING_SEED_IMPORTED_FILENAME)).catch(() => undefined);
  return { imported: true, counts };
}
