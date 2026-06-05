import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn, getWorldEmbedding } from "../rag/world-db.js";
import { slugify } from "../rag/lore.js";

// NOTE: threads.yaml is no longer used. Threads are stored as entities(type='thread')
// in world.duckdb. The loadThreads/saveThreads functions operate on the entity store.

export type ThreadKind = "goal" | "threat" | "debt" | "other";
export type ThreadStatus = "open" | "closed";

export interface Thread {
  title: string;
  kind: ThreadKind;
  status: ThreadStatus;
  notes: string;
  openedAt: string;
  closedAt?: string;
  resolution?: string;
}

// ---------------------------------------------------------------------------
// Entity ↔ Thread mapping
// canonical = title
// metadata = { kind, status, notes, openedAt, closedAt?, resolution? }
// summary for embedding = title + notes
// ---------------------------------------------------------------------------

function _parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function _rowToThread(metadata: Record<string, unknown>, canonical: string): Thread {
  return {
    title: canonical,
    kind: String(metadata["kind"] ?? "other") as ThreadKind,
    status: String(metadata["status"] ?? "open") as ThreadStatus,
    notes: String(metadata["notes"] ?? ""),
    openedAt: String(metadata["openedAt"] ?? new Date().toISOString()),
    closedAt: metadata["closedAt"] != null ? String(metadata["closedAt"]) : undefined,
    resolution: metadata["resolution"] != null ? String(metadata["resolution"]) : undefined,
  };
}

/** Zero-vector fallback for embedding when Ollama is unavailable. */
async function _safeEmbedding(text: string): Promise<number[]> {
  try {
    return await getWorldEmbedding(text);
  } catch {
    return Array(768).fill(0) as number[];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openThread(
  campaignPath: string,
  title: string,
  kind: ThreadKind,
  notes?: string,
): Promise<Thread> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const openedAt = new Date().toISOString();
    const notesStr = notes ?? "";
    const thread: Thread = {
      title,
      kind,
      status: "open",
      notes: notesStr,
      openedAt,
    };
    const metadata = { kind, status: "open", notes: notesStr, openedAt };
    const metadataJson = JSON.stringify(metadata);
    const summary = notesStr.length > 0 ? `${title} ${notesStr}` : title;
    const embedding = await _safeEmbedding(summary);
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
    const entityId = crypto.randomUUID();
    const slug = slugify(title);
    // Allow duplicate titles in the same campaign (different "runs" of a thread)
    // using a unique slug per creation to avoid PK collision.
    // NOTE: Resolution prefers campaign-scoped entities.
    await conn.run(
      `INSERT INTO entities
         (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
          campaign_id, created_in_campaign, created_at, updated_at)
       VALUES (?, ?, ?, []::TEXT[], 'thread', ?, '{}', ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
      [entityId, slug, title, summary, metadataJson,
       ctx.campaignId, ctx.campaignId, openedAt, openedAt],
    );
    return thread;
  } finally {
    conn.closeSync();
  }
}

export async function closeThread(
  campaignPath: string,
  title: string,
  resolution: string,
): Promise<Thread> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    // Find open thread entity by title (case-insensitive), campaign-scoped
    const needle = title.toLowerCase();
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, metadata, updated_at
       FROM entities
       WHERE type = 'thread'
         AND (campaign_id IS NULL OR campaign_id = ?)
         AND lower(canonical) = ?
       ORDER BY
         -- prefer campaign-scoped over canon, prefer open over closed
         (campaign_id IS NOT NULL) DESC,
         CASE WHEN json_extract_string(metadata, '$.status') = 'open' THEN 0 ELSE 1 END ASC,
         updated_at DESC
       LIMIT 1`,
      [ctx.campaignId, needle],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) {
      throw new Error(`Thread not found: "${title}"`);
    }
    const row = rows[0]!;
    const entityId = String(row["id"]);
    const canonical = String(row["canonical"]);
    const existingMeta = _parseJsonObject(row["metadata"]);
    const closedAt = new Date().toISOString();
    const updatedMeta = { ...existingMeta, status: "closed", closedAt, resolution };
    const metadataJson = JSON.stringify(updatedMeta);
    await conn.run(
      `UPDATE entities SET metadata = ?, updated_at = ? WHERE id = ?`,
      [metadataJson, closedAt, entityId],
    );
    return _rowToThread(updatedMeta, canonical);
  } finally {
    conn.closeSync();
  }
}

export async function listThreads(
  campaignPath: string,
  status?: ThreadStatus,
): Promise<Thread[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT canonical, metadata
       FROM entities
       WHERE type = 'thread'
         AND (campaign_id IS NULL OR campaign_id = ?)
       ORDER BY created_at ASC`,
      [ctx.campaignId],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    const threads = rows.map((r) => {
      const metadata = _parseJsonObject(r["metadata"]);
      return _rowToThread(metadata, String(r["canonical"]));
    });
    if (status === undefined) return threads;
    return threads.filter((t) => t.status === status);
  } finally {
    conn.closeSync();
  }
}

/**
 * loadThreads — used by export_campaign and context/build.ts.
 * Returns all visible threads for the active campaign.
 */
export async function loadThreads(campaignPath: string): Promise<Thread[]> {
  return listThreads(campaignPath);
}

/**
 * saveThreads — used by import_campaign.
 * Upserts each thread as an entity (idempotent on title + kind + openedAt).
 */
export async function saveThreads(campaignPath: string, threads: Thread[]): Promise<void> {
  for (const thread of threads) {
    await _upsertThreadEntity(campaignPath, thread);
  }
}

async function _upsertThreadEntity(campaignPath: string, thread: Thread): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    // Try to find existing by title + openedAt (stable identity for import idempotency)
    const needle = thread.title.toLowerCase();
    const existing = await conn.runAndReadAll(
      `SELECT id FROM entities
       WHERE type = 'thread'
         AND (campaign_id IS NULL OR campaign_id = ?)
         AND lower(canonical) = ?
         AND json_extract_string(metadata, '$.openedAt') = ?
       LIMIT 1`,
      [ctx.campaignId, needle, thread.openedAt],
    );
    const existingRows = existing.getRowObjectsJS() as Record<string, unknown>[];
    const metadata = {
      kind: thread.kind,
      status: thread.status,
      notes: thread.notes,
      openedAt: thread.openedAt,
      ...(thread.closedAt !== undefined ? { closedAt: thread.closedAt } : {}),
      ...(thread.resolution !== undefined ? { resolution: thread.resolution } : {}),
    };
    const metadataJson = JSON.stringify(metadata);
    const now = new Date().toISOString();
    if (existingRows.length > 0) {
      const entityId = String(existingRows[0]!["id"]);
      await conn.run(
        `UPDATE entities SET metadata = ?, updated_at = ? WHERE id = ?`,
        [metadataJson, now, entityId],
      );
    } else {
      const entityId = crypto.randomUUID();
      const slug = slugify(thread.title);
      const summary = thread.notes.length > 0 ? `${thread.title} ${thread.notes}` : thread.title;
      const embedding = await _safeEmbedding(summary);
      const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
      await conn.run(
        `INSERT INTO entities
           (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
            campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, ?, ?, []::TEXT[], 'thread', ?, '{}', ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
        [entityId, slug, thread.title, summary, metadataJson,
         ctx.campaignId, ctx.campaignId, thread.openedAt, now],
      );
    }
  } finally {
    conn.closeSync();
  }
}
