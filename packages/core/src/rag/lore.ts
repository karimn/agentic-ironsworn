import { DuckDBInstance } from "@duckdb/node-api";
import { resolveWorldContext } from "../world.js";
import {
  getWorldDb,
  openWorldWriteConn,
  peekWorldDb,
  getWorldEmbedding,
} from "./world-db.js";

export const LORE_TYPES = [
  "place",
  "person",
  "faction",
  "material",
  "concept",
  "creature",
  "event",
  "truth",
  "thread",
] as const;

export type LoreType = (typeof LORE_TYPES)[number];

export interface ProvenanceInput {
  source_kind: "manual" | "scene" | "document" | "extraction";
  source_id?: string;
  excerpt?: string;
  confidence?: number;
}

export interface ProvenanceEntry {
  id: string;
  subject_kind: "entity" | "relation" | "proximity";
  subject_id: string;
  source_kind: string;
  source_id: string | null;
  excerpt: string | null;
  confidence: number | null;
  created_at: string;
}

export interface LoreRelation {
  direction: "from" | "to";
  relation: string;
  entity: { id: string; canonical: string; type: LoreType };
  notes?: string;
  metadata: Record<string, unknown>;
}

export interface LoreEntity {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  community_id: string | null;
  campaign_id: string | null;
  created_in_campaign: string | null;
  relations: LoreRelation[];
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  provenance?: ProvenanceInput;
  _created_at?: string;
  _skipRecordingProvenance?: boolean;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  aliases?: string[];
  provenance?: ProvenanceInput;
  _created_at?: string;
  _skipRecordingProvenance?: boolean;
}

export interface UpsertLoreResult {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Returns true if s looks like a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];
  const metadata = parseJsonObject(row["metadata"]);
  const communityRaw = metadata["community"];
  const community_id = typeof communityRaw === "string" && communityRaw.length > 0
    ? communityRaw
    : null;
  return {
    id: String(row["id"] ?? ""),
    slug: String(row["slug"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content: parseJsonObject(row["content"]),
    metadata,
    community_id,
    campaign_id: row["campaign_id"] != null ? String(row["campaign_id"]) : null,
    created_in_campaign: row["created_in_campaign"] != null ? String(row["created_in_campaign"]) : null,
    relations: [],
  };
}

/**
 * Visibility predicate SQL fragment.
 * When includeSiblings is true, the whole world is visible (no filter).
 * The `?` placeholder expects the campaignId parameter.
 */
function visibilityClause(includeSiblings: boolean): string {
  if (includeSiblings) return "1=1";
  return "(campaign_id IS NULL OR campaign_id = ?)";
}

export async function recordProvenance(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  subjectKind: "entity" | "relation" | "proximity",
  subjectId: string,
  prov: ProvenanceInput | undefined,
  createdAtOverride?: string,
): Promise<void> {
  const effective: ProvenanceInput = prov ?? { source_kind: "manual" };
  const id = crypto.randomUUID();
  const now = createdAtOverride ?? new Date().toISOString();
  await conn.run(
    `INSERT INTO lore_provenance
       (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, subjectKind, subjectId, effective.source_kind, effective.source_id ?? null, effective.excerpt ?? null, effective.confidence ?? null, now],
  );
}

/**
 * Resolve an existing visible entity row by id/canonical/alias/slug.
 * Returns null when nothing matches.
 *
 * @param campaignId Active campaign id for visibility filter.
 * @param includeSiblings When true, drop the visibility filter.
 */
async function resolveExisting(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  needle: string,
  campaignId: string,
  includeSiblings = false,
): Promise<{ id: string; slug: string; canonical: string; aliases: string[]; metadata: string; campaign_id: string | null } | null> {
  const needleLower = needle.toLowerCase();
  const vis = visibilityClause(includeSiblings);
  const params: (string | null)[] = [needleLower, needleLower, needleLower, needleLower];
  if (!includeSiblings) {
    // visibility clause has ONE `?` for campaign_id — we need it 4 times (once per OR arm)
    // We use a CTE approach: pass campaignId once at the end and reference in the predicate
    const result = await conn.runAndReadAll(
      `SELECT id, slug, canonical, aliases, metadata, campaign_id
       FROM entities
       WHERE ${vis}
         AND (lower(id::TEXT) = ? OR lower(canonical) = ? OR lower(slug) = ?
              OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?))
       ORDER BY (campaign_id IS NOT NULL) DESC, canonical LIMIT 1`,
      [campaignId, needleLower, needleLower, needleLower, needleLower],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: String(r["id"]),
      slug: String(r["slug"] ?? ""),
      canonical: String(r["canonical"]),
      aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
      metadata: typeof r["metadata"] === "string" ? r["metadata"] : "{}",
      campaign_id: r["campaign_id"] != null ? String(r["campaign_id"]) : null,
    };
  } else {
    const result = await conn.runAndReadAll(
      `SELECT id, slug, canonical, aliases, metadata, campaign_id
       FROM entities
       WHERE lower(id::TEXT) = ? OR lower(canonical) = ? OR lower(slug) = ?
              OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?)
       ORDER BY (campaign_id IS NOT NULL) DESC, canonical LIMIT 1`,
      params,
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: String(r["id"]),
      slug: String(r["slug"] ?? ""),
      canonical: String(r["canonical"]),
      aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
      metadata: typeof r["metadata"] === "string" ? r["metadata"] : "{}",
      campaign_id: r["campaign_id"] != null ? String(r["campaign_id"]) : null,
    };
  }
}

/**
 * Resolve entity id for use in link operations (throws if not found).
 * Visibility predicate applied.
 */
async function resolveId(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  identifier: string,
  campaignId: string,
  includeSiblings = false,
): Promise<string> {
  const row = await resolveExisting(conn, identifier, campaignId, includeSiblings);
  if (row === null) {
    throw new Error(`Lore entity not found: "${identifier}"`);
  }
  return row.id;
}

export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const ctx = await resolveWorldContext(campaignPath);
  const [embedding, instance] = await Promise.all([
    getWorldEmbedding(input.summary),
    getWorldDb(ctx),
  ]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = input._created_at ?? new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});
  const conn = await openWorldWriteConn(instance);
  try {
    // ------------------------------------------------------------------
    // Determine the target row via dual id semantics:
    //   1. input.id is a valid UUID  → find row by UUID PK
    //   2. input.id present but NOT a UUID (legacy slug) → treat as slug seed
    //   3. input.id absent → resolve by canonical/alias/slug
    // ------------------------------------------------------------------
    let existingRow: Awaited<ReturnType<typeof resolveExisting>> = null;

    if (input.id !== undefined && input.id.length > 0) {
      if (looksLikeUuid(input.id)) {
        // Case 1: UUID PK lookup
        const r = await conn.runAndReadAll(
          `SELECT id, slug, canonical, aliases, metadata, campaign_id
           FROM entities WHERE id = ?`,
          [input.id],
        );
        const rows = r.getRowObjectsJS() as Record<string, unknown>[];
        if (rows.length > 0) {
          const row = rows[0];
          existingRow = {
            id: String(row["id"]),
            slug: String(row["slug"] ?? ""),
            canonical: String(row["canonical"]),
            aliases: Array.isArray(row["aliases"]) ? (row["aliases"] as unknown[]).map(String) : [],
            metadata: typeof row["metadata"] === "string" ? row["metadata"] : "{}",
            campaign_id: row["campaign_id"] != null ? String(row["campaign_id"]) : null,
          };
        }
      } else {
        // Case 2: legacy slug seed — resolve visible row by that slug first;
        // if not found, create with slug = input.id
        existingRow = await resolveExisting(conn, input.id, ctx.campaignId);
        // If resolveExisting found nothing, we'll create with slug = input.id below
      }
    } else {
      // Case 3: no id provided — resolve by canonical/alias/slug
      existingRow = await resolveExisting(conn, input.canonical, ctx.campaignId);
    }

    const incomingAliases = input.aliases ?? [];
    let mergedAliases: string[];
    let metadataJson: string;
    let updated = false;
    let entityId: string;
    let entitySlug: string;

    if (existingRow !== null) {
      updated = true;
      entityId = existingRow.id;
      entitySlug = existingRow.slug;

      // Merge aliases: preserve old aliases, move old canonical to aliases on rename
      const oldCanonical = existingRow.canonical;
      const oldAliases = existingRow.aliases;
      const seen = new Set<string>();
      const acc: string[] = [];
      const push = (name: string) => {
        const key = name.toLowerCase();
        if (key.length === 0) return;
        if (key === input.canonical.toLowerCase()) return;
        if (seen.has(key)) return;
        seen.add(key);
        acc.push(name);
      };
      for (const a of oldAliases) push(a);
      // Also add the old slug as an alias for resolution backwards-compat
      if (entitySlug.length > 0 && entitySlug !== slugify(input.canonical)) {
        push(entitySlug);
      }
      if (oldCanonical.length > 0 && oldCanonical.toLowerCase() !== input.canonical.toLowerCase()) {
        push(oldCanonical);
      }
      for (const a of incomingAliases) push(a);
      mergedAliases = acc;

      if (input.metadata !== undefined) {
        metadataJson = JSON.stringify(input.metadata);
      } else {
        metadataJson = existingRow.metadata;
      }
    } else {
      // New entity. Preserve an explicit UUID id (v3 import / export roundtrip
      // is idempotent on UUID); otherwise mint a fresh one. A non-UUID input.id
      // is treated as a slug seed, not an id.
      entityId =
        input.id !== undefined && looksLikeUuid(input.id)
          ? input.id
          : crypto.randomUUID();
      // Prefer explicit slug seed when input.id is a non-UUID string
      entitySlug = (input.id !== undefined && input.id.length > 0 && !looksLikeUuid(input.id))
        ? input.id
        : slugify(input.canonical);

      const seen = new Set<string>();
      mergedAliases = [];
      // Include the slug as an alias for backwards-compat resolution
      const slgKey = entitySlug.toLowerCase();
      if (slgKey.length > 0 && slgKey !== input.canonical.toLowerCase()) {
        seen.add(slgKey);
        mergedAliases.push(entitySlug);
      }
      for (const a of incomingAliases) {
        const key = a.toLowerCase();
        if (key.length === 0 || key === input.canonical.toLowerCase()) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedAliases.push(a);
      }
      metadataJson = JSON.stringify(input.metadata ?? {});
    }

    const aliasesLiteral = `[${mergedAliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

    if (existingRow !== null) {
      // Update — do NOT change campaign_id (canonize is a separate Phase 3 op)
      await conn.run(
        `UPDATE entities SET canonical = ?, slug = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
           content = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ? WHERE id = ?`,
        [input.canonical, entitySlug, input.type, input.summary, contentJson, metadataJson, now, entityId],
      );
    } else {
      await conn.run(
        `INSERT INTO entities
           (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
            campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, ?, ?, ${aliasesLiteral}, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
        [entityId, entitySlug, input.canonical, input.type, input.summary, contentJson, metadataJson,
         ctx.campaignId, ctx.campaignId, now, now],
      );
    }

    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "entity", entityId, input.provenance, now);
    }

    return { id: entityId, slug: entitySlug, canonical: input.canonical, aliases: mergedAliases, updated };
  } finally {
    conn.closeSync();
  }
}

export interface LoreSearchHit {
  id: string;
  slug: string;
  canonical: string;
  type: LoreType;
  summary: string;
  score: number;
}

export async function searchLore(
  campaignPath: string,
  query: string,
  k = 5,
  type?: LoreType,
  opts?: { includeSiblings?: boolean },
): Promise<LoreSearchHit[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const [embedding, instance] = await Promise.all([
    getWorldEmbedding(query),
    getWorldDb(ctx),
  ]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const includeSiblings = opts?.includeSiblings ?? false;
  const vis = visibilityClause(includeSiblings);
  const conn = await instance.connect();
  try {
    let sql: string;
    let params: (string | number)[];

    if (!includeSiblings) {
      // Visibility predicate in WHERE BEFORE ORDER BY (embedding-leakage fix)
      if (type) {
        sql = `SELECT id, slug, canonical, type, summary,
                      array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
               FROM entities
               WHERE ${vis} AND type = ?
               ORDER BY score DESC LIMIT ?`;
        params = [ctx.campaignId, type, k];
      } else {
        sql = `SELECT id, slug, canonical, type, summary,
                      array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
               FROM entities
               WHERE ${vis}
               ORDER BY score DESC LIMIT ?`;
        params = [ctx.campaignId, k];
      }
    } else {
      if (type) {
        sql = `SELECT id, slug, canonical, type, summary,
                      array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
               FROM entities WHERE type = ? ORDER BY score DESC LIMIT ?`;
        params = [type, k];
      } else {
        sql = `SELECT id, slug, canonical, type, summary,
                      array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
               FROM entities ORDER BY score DESC LIMIT ?`;
        params = [k];
      }
    }

    const result = await conn.runAndReadAll(sql, params);
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      slug: String(row["slug"] ?? ""),
      canonical: String(row["canonical"] ?? ""),
      type: String(row["type"] ?? "concept") as LoreType,
      summary: String(row["summary"] ?? ""),
      score: typeof row["score"] === "number" ? row["score"]
        : typeof row["score"] === "bigint" ? Number(row["score"]) : Number.NaN,
    }));
  } finally {
    conn.closeSync();
  }
}

export async function linkLore(
  campaignPath: string,
  input: LinkLoreInput,
): Promise<{ from_id: string; to_id: string; relation: string; relation_id: string }> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const fromId = await resolveId(conn, input.from, ctx.campaignId);
    const toId = await resolveId(conn, input.to, ctx.campaignId);
    const now = input._created_at ?? new Date().toISOString();
    const overwriteMetadata = input.metadata !== undefined;
    const metadataJson = JSON.stringify(input.metadata ?? {});

    // Determine campaign_id for the relation:
    // NULL only when BOTH endpoints are canon (campaign_id IS NULL); otherwise ctx.campaignId
    // First look up campaign_ids of from/to endpoints
    const endpointResult = await conn.runAndReadAll(
      `SELECT id, campaign_id FROM entities WHERE id IN (?, ?)`,
      [fromId, toId],
    );
    const endpointRows = endpointResult.getRowObjectsJS() as Record<string, unknown>[];
    const fromRow = endpointRows.find((r) => String(r["id"]) === fromId);
    const toRow = endpointRows.find((r) => String(r["id"]) === toId);
    const fromIsCanon = fromRow?.["campaign_id"] == null;
    const toIsCanon = toRow?.["campaign_id"] == null;
    const relationCampaignId = (fromIsCanon && toIsCanon) ? null : ctx.campaignId;

    // Check if relation already exists (by unique key: from_entity, to_entity, label, campaign_id)
    const existingResult = await conn.runAndReadAll(
      `SELECT id FROM relations WHERE from_entity = ? AND to_entity = ? AND label = ?
       AND (campaign_id IS NULL AND ? IS NULL OR campaign_id = ?)`,
      [fromId, toId, input.relation, relationCampaignId, relationCampaignId],
    );
    const existingRows = existingResult.getRowObjectsJS() as Record<string, unknown>[];
    const metadataConflictClause = overwriteMetadata
      ? "metadata = EXCLUDED.metadata"
      : "metadata = relations.metadata";

    let relationId: string;
    if (existingRows.length > 0) {
      relationId = String(existingRows[0]["id"]);
      // Update notes/metadata on conflict
      await conn.run(
        `UPDATE relations SET
           notes = COALESCE(?, notes),
           ${metadataConflictClause.replace("EXCLUDED.metadata", "?").replace("relations.metadata", "metadata")}
         WHERE id = ?`,
        overwriteMetadata
          ? [input.notes ?? null, metadataJson, relationId]
          : [input.notes ?? null, relationId],
      );
    } else {
      relationId = crypto.randomUUID();
      await conn.run(
        `INSERT INTO relations (id, from_entity, to_entity, label, notes, metadata, campaign_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [relationId, fromId, toId, input.relation, input.notes ?? null, metadataJson, relationCampaignId, now],
      );
    }

    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "relation", relationId, input.provenance, now);
    }
    return { from_id: fromId, to_id: toId, relation: input.relation, relation_id: relationId };
  } finally {
    conn.closeSync();
  }
}

export interface LoreGraph {
  root: LoreEntity;
  nodes: LoreEntity[];
  edges: Array<{
    from_id: string;
    to_id: string;
    relation: string;
    notes?: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function getLoreGraph(
  campaignPath: string,
  identifier: string,
  depth = 1,
  opts?: { includeSiblings?: boolean },
): Promise<LoreGraph | null> {
  if (depth < 1) throw new Error("getLoreGraph depth must be >= 1");
  const root = await getLore(campaignPath, identifier, opts);
  if (root === null) return null;
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  const includeSiblings = opts?.includeSiblings ?? false;
  const vis = visibilityClause(includeSiblings);
  try {
    const visited = new Set<string>([root.id]);
    let frontier = new Set<string>([root.id]);
    const edges: LoreGraph["edges"] = [];
    for (let hop = 0; hop < depth; hop++) {
      if (frontier.size === 0) break;
      const placeholders = Array.from(frontier).map(() => "?").join(",");
      const params = Array.from(frontier);
      // Visibility on relations: filter both endpoints to visible entities
      // NOTE: We apply visibility on from_entity/to_entity by joining entities
      let relSql: string;
      let relParams: (string | null)[];
      if (!includeSiblings) {
        relSql = `SELECT r.id AS rel_id, r.from_entity AS from_id, r.to_entity AS to_id, r.label AS relation, r.notes, r.metadata
               FROM relations r
               JOIN entities fe ON fe.id = r.from_entity AND (fe.campaign_id IS NULL OR fe.campaign_id = ?)
               JOIN entities te ON te.id = r.to_entity AND (te.campaign_id IS NULL OR te.campaign_id = ?)
               WHERE r.from_entity IN (${placeholders}) OR r.to_entity IN (${placeholders})`;
        relParams = [ctx.campaignId, ctx.campaignId, ...params, ...params];
      } else {
        relSql = `SELECT r.id AS rel_id, r.from_entity AS from_id, r.to_entity AS to_id, r.label AS relation, r.notes, r.metadata
               FROM relations r
               WHERE r.from_entity IN (${placeholders}) OR r.to_entity IN (${placeholders})`;
        relParams = [...params, ...params];
      }

      const result = await conn.runAndReadAll(relSql, relParams);
      const next = new Set<string>();
      for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
        const fromId = String(row["from_id"]);
        const toId = String(row["to_id"]);
        const relation = String(row["relation"]);
        const notes = row["notes"] ? String(row["notes"]) : undefined;
        const edgeKey = `${fromId}|${toId}|${relation}`;
        if (!edges.some((e) => `${e.from_id}|${e.to_id}|${e.relation}` === edgeKey)) {
          edges.push({ from_id: fromId, to_id: toId, relation, notes, metadata: parseJsonObject(row["metadata"]) });
        }
        for (const id of [fromId, toId]) {
          if (!visited.has(id)) { visited.add(id); next.add(id); }
        }
      }
      frontier = next;
    }
    const allIds = Array.from(visited);
    const placeholders = allIds.map(() => "?").join(",");
    let nodeParams: (string | null)[];
    let nodeSql: string;
    if (!includeSiblings) {
      nodeSql = `SELECT id, slug, canonical, aliases, type, summary, content, metadata, campaign_id, created_in_campaign
                 FROM entities WHERE ${vis} AND id IN (${placeholders})`;
      nodeParams = [ctx.campaignId, ...allIds];
    } else {
      nodeSql = `SELECT id, slug, canonical, aliases, type, summary, content, metadata, campaign_id, created_in_campaign
                 FROM entities WHERE id IN (${placeholders})`;
      nodeParams = allIds;
    }
    const nodesResult = await conn.runAndReadAll(nodeSql, nodeParams);
    const nodes = (nodesResult.getRowObjectsJS() as Record<string, unknown>[]).map(rowToEntity);
    return { root, nodes, edges };
  } finally {
    conn.closeSync();
  }
}

export async function getLore(
  campaignPath: string,
  identifier: string,
  opts?: { includeSiblings?: boolean },
): Promise<LoreEntity | null> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const needle = identifier.toLowerCase();
  const includeSiblings = opts?.includeSiblings ?? false;
  const vis = visibilityClause(includeSiblings);
  const conn = await instance.connect();
  try {
    let entityResult;
    if (!includeSiblings) {
      entityResult = await conn.runAndReadAll(
        `SELECT id, slug, canonical, aliases, type, summary, content, metadata, campaign_id, created_in_campaign
         FROM entities
         WHERE ${vis}
           AND (lower(id::TEXT) = ? OR lower(canonical) = ? OR lower(slug) = ?
                OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?))
         ORDER BY (campaign_id IS NOT NULL) DESC, canonical LIMIT 1`,
        [ctx.campaignId, needle, needle, needle, needle],
      );
    } else {
      entityResult = await conn.runAndReadAll(
        `SELECT id, slug, canonical, aliases, type, summary, content, metadata, campaign_id, created_in_campaign
         FROM entities
         WHERE lower(id::TEXT) = ? OR lower(canonical) = ? OR lower(slug) = ?
                OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?)
         ORDER BY (campaign_id IS NOT NULL) DESC, canonical LIMIT 1`,
        [needle, needle, needle, needle],
      );
    }
    const rows = entityResult.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const entity = rowToEntity(rows[0]);

    // Load relations — join with visible entities on both sides
    let outgoing;
    let incoming;
    if (!includeSiblings) {
      outgoing = await conn.runAndReadAll(
        `SELECT r.label AS relation, r.notes, r.metadata,
                e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
         FROM relations r
         JOIN entities e ON e.id = r.to_entity AND (e.campaign_id IS NULL OR e.campaign_id = ?)
         WHERE r.from_entity = ?`,
        [ctx.campaignId, entity.id],
      );
      incoming = await conn.runAndReadAll(
        `SELECT r.label AS relation, r.notes, r.metadata,
                e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
         FROM relations r
         JOIN entities e ON e.id = r.from_entity AND (e.campaign_id IS NULL OR e.campaign_id = ?)
         WHERE r.to_entity = ?`,
        [ctx.campaignId, entity.id],
      );
    } else {
      outgoing = await conn.runAndReadAll(
        `SELECT r.label AS relation, r.notes, r.metadata,
                e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
         FROM relations r JOIN entities e ON e.id = r.to_entity WHERE r.from_entity = ?`,
        [entity.id],
      );
      incoming = await conn.runAndReadAll(
        `SELECT r.label AS relation, r.notes, r.metadata,
                e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
         FROM relations r JOIN entities e ON e.id = r.from_entity WHERE r.to_entity = ?`,
        [entity.id],
      );
    }

    const relations: LoreRelation[] = [];
    for (const row of outgoing.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "from",
        relation: String(row["relation"]),
        entity: { id: String(row["other_id"]), canonical: String(row["other_canonical"]), type: String(row["other_type"]) as LoreType },
        notes: row["notes"] ? String(row["notes"]) : undefined,
        metadata: parseJsonObject(row["metadata"]),
      });
    }
    for (const row of incoming.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "to",
        relation: String(row["relation"]),
        entity: { id: String(row["other_id"]), canonical: String(row["other_canonical"]), type: String(row["other_type"]) as LoreType },
        notes: row["notes"] ? String(row["notes"]) : undefined,
        metadata: parseJsonObject(row["metadata"]),
      });
    }
    entity.relations = relations;
    return entity;
  } finally {
    conn.closeSync();
  }
}

export async function listProvenance(
  campaignPath: string,
  subjectKind: "entity" | "relation",
  subjectId: string,
): Promise<ProvenanceEntry[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at
       FROM lore_provenance WHERE subject_kind = ? AND subject_id::TEXT = ? ORDER BY created_at ASC`,
      [subjectKind, subjectId],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]),
      subject_kind: String(row["subject_kind"]) as "entity" | "relation",
      subject_id: String(row["subject_id"]),
      source_kind: String(row["source_kind"]),
      source_id: row["source_id"] ? String(row["source_id"]) : null,
      excerpt: row["excerpt"] ? String(row["excerpt"]) : null,
      confidence: typeof row["confidence"] === "number" ? row["confidence"]
        : typeof row["confidence"] === "bigint" ? Number(row["confidence"]) : null,
      created_at: String(row["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}

export interface LoreEntityExport {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  type: string;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  campaign_id: string | null;
  created_in_campaign: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoreRelationExport {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  notes?: string;
  metadata: Record<string, unknown>;
  campaign_id: string | null;
  created_at: string;
}

export async function exportLore(
  campaignPath: string,
): Promise<{ entities: LoreEntityExport[]; relations: LoreRelationExport[] }> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const entRows = (await conn.runAndReadAll(
      `SELECT id, slug, canonical, aliases, type, summary, content, metadata,
              campaign_id, created_in_campaign, created_at, updated_at
       FROM entities
       WHERE campaign_id IS NULL OR campaign_id = ?
       ORDER BY created_at`,
      [ctx.campaignId],
    )).getRowObjectsJS() as Record<string, unknown>[];

    const relRows = (await conn.runAndReadAll(
      `SELECT id, from_entity AS from_id, to_entity AS to_id, label AS relation,
              notes, metadata, campaign_id, created_at
       FROM relations
       WHERE campaign_id IS NULL OR campaign_id = ?
       ORDER BY created_at`,
      [ctx.campaignId],
    )).getRowObjectsJS() as Record<string, unknown>[];

    return {
      entities: entRows.map((r) => ({
        id: String(r["id"]),
        slug: String(r["slug"] ?? ""),
        canonical: String(r["canonical"]),
        aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
        type: String(r["type"]),
        summary: String(r["summary"]),
        content: JSON.parse(typeof r["content"] === "string" ? r["content"] : "{}") as Record<string, unknown>,
        metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
        campaign_id: r["campaign_id"] != null ? String(r["campaign_id"]) : null,
        created_in_campaign: r["created_in_campaign"] != null ? String(r["created_in_campaign"]) : null,
        created_at: String(r["created_at"]),
        updated_at: String(r["updated_at"]),
      })),
      relations: relRows.map((r) => ({
        id: String(r["id"]),
        from_id: String(r["from_id"]),
        to_id: String(r["to_id"]),
        relation: String(r["relation"]),
        notes: r["notes"] != null ? String(r["notes"]) : undefined,
        metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
        campaign_id: r["campaign_id"] != null ? String(r["campaign_id"]) : null,
        created_at: String(r["created_at"]),
      })),
    };
  } finally {
    conn.closeSync();
  }
}

export async function exportProvenance(
  campaignPath: string,
): Promise<ProvenanceEntry[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at
       FROM lore_provenance ORDER BY created_at`,
    )).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      subject_kind: String(r["subject_kind"]) as "entity" | "relation" | "proximity",
      subject_id: String(r["subject_id"]),
      source_kind: String(r["source_kind"]),
      source_id: r["source_id"] != null ? String(r["source_id"]) : null,
      excerpt: r["excerpt"] != null ? String(r["excerpt"]) : null,
      confidence: typeof r["confidence"] === "number" ? r["confidence"] : null,
      created_at: String(r["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}

export async function replayProvenance(
  campaignPath: string,
  entry: ProvenanceEntry,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO lore_provenance (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.subject_kind, entry.subject_id, entry.source_kind, entry.source_id, entry.excerpt, entry.confidence, entry.created_at],
    );
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Canonize / Decanonize — Phase 3a
// ---------------------------------------------------------------------------

/**
 * Promote an entity to world canon: flip `campaign_id` to NULL.
 * Resolution uses the visibility filter (you can only canonize something you can see).
 * Throws if the entity is not found.
 */
export async function canonizeEntity(
  campaignPath: string,
  identifier: string,
): Promise<{ id: string; canonical: string }> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const existing = await resolveExisting(conn, identifier, ctx.campaignId);
    if (existing === null) throw new Error(`Entity not found (visible to campaign "${ctx.campaignId}"): "${identifier}"`);
    const now = new Date().toISOString();
    await conn.run(
      `UPDATE entities SET campaign_id = NULL, updated_at = ? WHERE id = ?`,
      [now, existing.id],
    );
    return { id: existing.id, canonical: existing.canonical };
  } finally {
    conn.closeSync();
  }
}

/**
 * Reverse a canonization: flip `campaign_id` back to a named campaign.
 * Resolution uses the visibility filter (including canon, i.e. current campaign or NULL).
 * Throws if the entity is not found.
 */
export async function decanonizeEntity(
  campaignPath: string,
  identifier: string,
  intoCampaign: string,
): Promise<{ id: string; canonical: string }> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const existing = await resolveExisting(conn, identifier, ctx.campaignId);
    if (existing === null) throw new Error(`Entity not found (visible to campaign "${ctx.campaignId}"): "${identifier}"`);
    const now = new Date().toISOString();
    await conn.run(
      `UPDATE entities SET campaign_id = ?, updated_at = ? WHERE id = ?`,
      [intoCampaign, now, existing.id],
    );
    return { id: existing.id, canonical: existing.canonical };
  } finally {
    conn.closeSync();
  }
}

/**
 * Promote a relation to world canon: flip `campaign_id` to NULL.
 * `relationId` must be the UUID from `linkLore`'s `relation_id` return value.
 * Throws if the relation is not found.
 */
export async function canonizeRelation(
  campaignPath: string,
  relationId: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(`UPDATE relations SET campaign_id = NULL WHERE id = ?`, [relationId]);
    // Verify the row actually existed (DuckDB does not error on 0-row updates)
    const check = await conn.runAndReadAll(`SELECT id FROM relations WHERE id = ?`, [relationId]);
    const rows = check.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) throw new Error(`Relation not found: "${relationId}"`);
  } finally {
    conn.closeSync();
  }
}

/**
 * Reverse a relation canonization: flip `campaign_id` back to a named campaign.
 * Throws if the relation is not found.
 */
export async function decanonizeRelation(
  campaignPath: string,
  relationId: string,
  intoCampaign: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(`UPDATE relations SET campaign_id = ? WHERE id = ?`, [intoCampaign, relationId]);
    const check = await conn.runAndReadAll(`SELECT id FROM relations WHERE id = ?`, [relationId]);
    const rows = check.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) throw new Error(`Relation not found: "${relationId}"`);
  } finally {
    conn.closeSync();
  }
}

export async function checkpointLore(campaignPath: string): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const cached = peekWorldDb(ctx.worldDbPath);
  if (cached === undefined) return;
  const instance = await cached;
  const conn = await instance.connect();
  try {
    try { await conn.run("LOAD vss;"); } catch { /* vss not pre-installed */ }
    await conn.run("CHECKPOINT;");
  } finally {
    conn.closeSync();
  }
}
