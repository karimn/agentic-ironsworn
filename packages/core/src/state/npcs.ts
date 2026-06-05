import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn, getWorldEmbedding } from "../rag/world-db.js";
import { slugify } from "../rag/lore.js";

type DuckDBConn = Awaited<ReturnType<DuckDBInstance["connect"]>>;

// NOTE: npcFilePath is kept for legacy callers/tests that may import it.
// It now returns a synthetic path — the file is NOT written to disk.
// Nothing in the codebase should rely on the file existing after Phase 2.
export function npcFilePath(campaignPath: string, name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return join(campaignPath, "npcs", `${sanitized}.md`);
}

// ---------------------------------------------------------------------------
// Markdown rendering — keeps session_briefing / get_npc shapes intact
// ---------------------------------------------------------------------------

interface NpcHistoryEntry {
  timestamp: string;
  description: string;
  impression: string;
}

function renderNpcMarkdown(canonical: string, history: NpcHistoryEntry[]): string {
  if (history.length === 0) {
    const ts = new Date().toISOString();
    return `# ${canonical}\n\n## ${ts}\n\n**Description:** (none)\n**Impression:** (none)\n`;
  }
  // Build a multi-section doc matching the old append-only format.
  // The `# Name` heading must appear first so session_briefing's regex matches.
  let doc = `# ${canonical}\n`;
  for (const entry of history) {
    doc += `\n## ${entry.timestamp}\n\n**Description:** ${entry.description}\n**Impression:** ${entry.impression}\n`;
  }
  return doc;
}

/** Attempt to get a zero-vector fallback when Ollama is unreachable. */
async function _safeEmbedding(text: string): Promise<number[]> {
  try {
    return await getWorldEmbedding(text);
  } catch {
    // Zero-vector fallback so NPC/thread ops work without Ollama.
    // NOTE: This produces non-semantic embeddings; they are correct placeholders until
    // Ollama is available and the entity can be re-embedded (e.g. via a future re-embed pass).
    return Array(768).fill(0) as number[];
  }
}

function _parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Core entity resolution — find visible person entity by name
// ---------------------------------------------------------------------------

async function _resolvePersonEntity(
  conn: DuckDBConn,
  name: string,
  campaignId: string,
): Promise<{ id: string; canonical: string; metadata: Record<string, unknown>; updated_at: string } | null> {
  const needle = name.toLowerCase();
  const result = await conn.runAndReadAll(
    `SELECT id, canonical, metadata, updated_at
     FROM entities
     WHERE type = 'person'
       AND (campaign_id IS NULL OR campaign_id = ?)
       AND (lower(canonical) = ? OR lower(slug) = ?
            OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?))
     ORDER BY (campaign_id IS NOT NULL) DESC, canonical
     LIMIT 1`,
    [campaignId, needle, needle, needle],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: String(r["id"]),
    canonical: String(r["canonical"]),
    metadata: _parseJsonObject(r["metadata"]),
    updated_at: String(r["updated_at"]),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function upsertNpc(
  campaignPath: string,
  name: string,
  description?: string,
  impression?: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const existing = await _resolvePersonEntity(conn, name, ctx.campaignId);
    const timestamp = new Date().toISOString();
    const desc = description ?? "(none)";
    const imp = impression ?? "(none)";
    const entry: NpcHistoryEntry = { timestamp, description: desc, impression: imp };

    let history: NpcHistoryEntry[];
    let entityId: string;
    const slug = slugify(name);
    const summary = `${desc} ${imp}`.trim();
    const embedding = await _safeEmbedding(summary);
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

    if (existing !== null) {
      entityId = existing.id;
      history = (existing.metadata["history"] as NpcHistoryEntry[] | undefined) ?? [];
      history.push(entry);
      const metadataJson = JSON.stringify({ ...existing.metadata, history });
      await conn.run(
        `UPDATE entities SET summary = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ?
         WHERE id = ?`,
        [summary, metadataJson, timestamp, entityId],
      );
    } else {
      entityId = crypto.randomUUID();
      history = [entry];
      const metadataJson = JSON.stringify({ history });
      const aliasesLiteral = `['${slug}']::TEXT[]`;
      await conn.run(
        `INSERT INTO entities
           (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
            campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, ?, ?, ${aliasesLiteral}, 'person', ?, '{}', ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
        [entityId, slug, name, summary, metadataJson,
         ctx.campaignId, ctx.campaignId, timestamp, timestamp],
      );
    }
  } finally {
    conn.closeSync();
  }
}

export async function getNpc(
  campaignPath: string,
  name: string,
): Promise<string | null> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const entity = await _resolvePersonEntity(conn, name, ctx.campaignId);
    if (entity === null) return null;
    const history = (entity.metadata["history"] as NpcHistoryEntry[] | undefined) ?? [];
    return renderNpcMarkdown(entity.canonical, history);
  } finally {
    conn.closeSync();
  }
}

export async function getNpcLastUpdated(
  campaignPath: string,
  name: string,
): Promise<string | null> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const entity = await _resolvePersonEntity(conn, name, ctx.campaignId);
    if (entity === null) return null;
    return entity.updated_at;
  } finally {
    conn.closeSync();
  }
}

export async function listNpcs(
  campaignPath: string,
): Promise<Record<string, string>> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT canonical, slug, metadata, updated_at
       FROM entities
       WHERE type = 'person'
         AND (campaign_id IS NULL OR campaign_id = ?)
       ORDER BY canonical`,
      [ctx.campaignId],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    const out: Record<string, string> = {};
    for (const r of rows) {
      const canonical = String(r["canonical"]);
      const slug = String(r["slug"] ?? slugify(canonical));
      const metadata = _parseJsonObject(r["metadata"]);
      const history = (metadata["history"] as NpcHistoryEntry[] | undefined) ?? [];
      const filename = `${slug}.md`;
      out[filename] = renderNpcMarkdown(canonical, history);
    }
    return out;
  } finally {
    conn.closeSync();
  }
}

/**
 * writeNpcRaw — used by import_campaign with raw old-format markdown.
 * Parses the markdown (canonical from # heading; uses the last Description and Impression values)
 * and upserts a person entity.
 */
export async function writeNpcRaw(
  campaignPath: string,
  filename: string,
  content: string,
): Promise<void> {
  // Extract canonical name from the `# Name` heading
  const headingMatch = content.match(/^# (.+)$/m);
  const canonical = headingMatch ? headingMatch[1]!.trim() : filename.replace(/\.md$/, "");

  // Extract all Description/Impression sections and use the last one
  const descMatches = [...content.matchAll(/\*\*Description:\*\*\s*(.+)/g)];
  const impMatches = [...content.matchAll(/\*\*Impression:\*\*\s*(.+)/g)];
  const description = descMatches.length > 0 ? descMatches[descMatches.length - 1]![1]!.trim() : undefined;
  const impression = impMatches.length > 0 ? impMatches[impMatches.length - 1]![1]!.trim() : undefined;

  await upsertNpc(campaignPath, canonical, description, impression);
}

// ---------------------------------------------------------------------------
// Pure staleness helpers — unchanged
// ---------------------------------------------------------------------------

const STALE_NPC_SCENE_THRESHOLD = 3;

export interface NpcStalenessInput {
  name: string;
  lastUpdated: string;
  scenesSinceUpdate: number;
}

export interface StaleNpc {
  name: string;
  scenes_since_update: number;
  last_updated: string;
}

export function findStaleNpcs(
  inputs: NpcStalenessInput[],
  threshold: number = STALE_NPC_SCENE_THRESHOLD,
): StaleNpc[] {
  return inputs
    .filter((n) => n.scenesSinceUpdate >= threshold)
    .map((n) => ({
      name: n.name,
      scenes_since_update: n.scenesSinceUpdate,
      last_updated: n.lastUpdated,
    }))
    .sort((a, b) => b.scenes_since_update - a.scenes_since_update);
}
