import { DuckDBInstance, DuckDBValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Scene {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
  score?: number;
}

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const _dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(
    `${campaignPath}/scenes.duckdb`,
  );

  const conn = await instance.connect();
  try {
    // vss is required for HNSW vector indexes. If the extension CDN is
    // unreachable, degrade gracefully: the table is created without the HNSW
    // index, so reads/writes still work but vector search is unavailable.
    let vssLoaded = false;
    try {
      await conn.run("LOAD vss;");
      await conn.run("SET hnsw_enable_experimental_persistence = true;");
      vssLoaded = true;
    } catch {
      // vss not pre-installed; HNSW index skipped
    }

    await conn.run(`
      CREATE TABLE IF NOT EXISTS scenes (
        id                 TEXT PRIMARY KEY,
        text               TEXT NOT NULL,
        embedding          FLOAT[768] NOT NULL,
        timestamp          TEXT NOT NULL,
        kind               TEXT NOT NULL DEFAULT 'scene',
        complication_theme TEXT
      )
    `);

    await conn.run(`
      ALTER TABLE scenes ADD COLUMN IF NOT EXISTS complication_theme TEXT
    `);

    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS scenes_embedding_idx
        ON scenes USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }
  } finally {
    conn.closeSync();
  }

  return instance;
}

function getDb(campaignPath: string): Promise<DuckDBInstance> {
  const cached = _dbPromises.get(campaignPath);
  if (cached !== undefined) return cached;

  const promise = initDb(campaignPath).catch((e) => {
    _dbPromises.delete(campaignPath);
    throw e;
  });
  _dbPromises.set(campaignPath, promise);
  return promise;
}

// See lore.ts openWriteConn for explanation. Same connection-scoped flag
// required on every write connection to an HNSW-indexed table.
async function openWriteConn(
  instance: DuckDBInstance,
): Promise<Awaited<ReturnType<DuckDBInstance["connect"]>>> {
  const conn = await instance.connect();
  try {
    await conn.run("SET hnsw_enable_experimental_persistence = true;");
  } catch {
    // vss not loaded; skip HNSW persistence flag
  }
  return conn;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function getEmbedding(text: string): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: text }),
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(`Ollama unavailable at ${OLLAMA_BASE_URL}: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Ollama embed failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { embeddings: number[][] };

  if (!data.embeddings || !Array.isArray(data.embeddings[0])) {
    throw new Error("Unexpected Ollama response shape");
  }

  if (data.embeddings[0].length !== 768) {
    throw new Error(
      `Expected 768-dim embedding, got ${data.embeddings[0].length}`,
    );
  }

  if (!data.embeddings[0].every((v) => typeof v === "number" && isFinite(v))) {
    throw new Error("Invalid embedding values from Ollama");
  }

  return data.embeddings[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function recordScene(
  campaignPath: string,
  summary: string,
  kind?: string,
  complicationTheme?: string,
): Promise<void> {
  const [embedding, instance] = await Promise.all([
    getEmbedding(summary),
    getDb(campaignPath),
  ]);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sceneKind = kind ?? "scene";

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme)
       VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?)`,
      [id, summary, timestamp, sceneKind, complicationTheme ?? null],
    );
  } finally {
    conn.closeSync();
  }
}

export async function getScene(
  campaignPath: string,
  id: string,
): Promise<Scene | null> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const rows = (
      await conn.runAndReadAll(
        `SELECT id, text, timestamp, kind, complication_theme FROM scenes WHERE id = ?`,
        [id],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      id: String(row["id"]),
      text: String(row["text"]),
      timestamp: String(row["timestamp"]),
      kind: String(row["kind"]),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
    };
  } finally {
    conn.closeSync();
  }
}

export async function updateScene(
  campaignPath: string,
  id: string,
  fields: { summary?: string; kind?: string; complication_theme?: string },
): Promise<void> {
  const instance = await getDb(campaignPath);

  // Build SET clauses for provided fields
  const setClauses: string[] = [];
  const params: DuckDBValue[] = [];

  if (fields.summary !== undefined) {
    // Re-embed when summary changes
    const embedding = await getEmbedding(fields.summary);
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
    setClauses.push(`text = ?`);
    params.push(fields.summary);
    setClauses.push(`embedding = ${embeddingLiteral}`);
  }
  if (fields.kind !== undefined) {
    setClauses.push(`kind = ?`);
    params.push(fields.kind);
  }
  if (fields.complication_theme !== undefined) {
    setClauses.push(`complication_theme = ?`);
    params.push(fields.complication_theme);
  }

  if (setClauses.length === 0) return;

  params.push(id);

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `UPDATE scenes SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );
  } finally {
    conn.closeSync();
  }
}

export async function deleteScene(
  campaignPath: string,
  id: string,
): Promise<void> {
  const instance = await getDb(campaignPath);
  const conn = await openWriteConn(instance);
  try {
    await conn.run(`DELETE FROM scenes WHERE id = ?`, [id]);
  } finally {
    conn.closeSync();
  }
}

export interface SceneExport {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
}

export async function exportScenes(campaignPath: string): Promise<SceneExport[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const rows = (
      await conn.runAndReadAll(
        `SELECT id, text, timestamp, kind, complication_theme FROM scenes ORDER BY timestamp`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      text: String(r["text"]),
      timestamp: String(r["timestamp"]),
      kind: String(r["kind"]),
      complication_theme: r["complication_theme"] != null ? String(r["complication_theme"]) : undefined,
    }));
  } finally {
    conn.closeSync();
  }
}

export async function importScene(
  campaignPath: string,
  id: string,
  text: string,
  timestamp: string,
  kind: string,
  complicationTheme?: string,
): Promise<boolean> {
  const instance = await getDb(campaignPath);

  const checkConn = await instance.connect();
  let exists = false;
  try {
    const rows = (
      await checkConn.runAndReadAll(`SELECT id FROM scenes WHERE id = ?`, [id])
    ).getRowObjectsJS() as unknown[];
    exists = rows.length > 0;
  } finally {
    checkConn.closeSync();
  }
  if (exists) return false;

  const [embedding] = await Promise.all([getEmbedding(text)]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme) VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?)`,
      [id, text, timestamp, kind, complicationTheme ?? null],
    );
    return true;
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

/**
 * Flush the WAL to the main database file.
 *
 * See lore.ts checkpointLore for full rationale. The scenes DB also carries
 * an HNSW index, so vss must be loaded before issuing the CHECKPOINT.
 *
 * Safe to call at any time; no-op if the DB has not been opened yet.
 */
export async function checkpointScenes(campaignPath: string): Promise<void> {
  const cached = _dbPromises.get(campaignPath);
  if (cached === undefined) return;

  const instance = await cached;
  const conn = await instance.connect();
  try {
    // vss must be loaded before checkpointing a DB that contains an HNSW index.
    // Swallow install errors if the CDN is unreachable; CHECKPOINT proceeds
    // without the HNSW index in that case.
    try {
      await conn.run("LOAD vss;");
    } catch {
      // vss not pre-installed; checkpoint without HNSW
    }
    await conn.run("CHECKPOINT;");
  } finally {
    conn.closeSync();
  }
}

export async function searchScenes(
  campaignPath: string,
  query: string,
  k?: number,
): Promise<Scene[]> {
  const limit = k ?? 5;

  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM scenes
       ORDER BY score DESC
       LIMIT ?`,
      [limit],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
      score:
        typeof row["score"] === "number"
          ? row["score"]
          : typeof row["score"] === "bigint"
            ? Number(row["score"])
            : undefined,
    }));
  } finally {
    conn.closeSync();
  }
}

export interface ComplicationScene {
  summary: string;
  complication_theme: string;
  kind: string;
  timestamp: string;
}

export async function getRecentComplications(
  campaignPath: string,
  k: number = 5,
): Promise<ComplicationScene[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT text, complication_theme, kind, timestamp
       FROM scenes
       WHERE complication_theme IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT ?`,
      [k],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      summary: String(row["text"] ?? ""),
      complication_theme: String(row["complication_theme"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      timestamp: String(row["timestamp"] ?? ""),
    }));
  } finally {
    conn.closeSync();
  }
}
