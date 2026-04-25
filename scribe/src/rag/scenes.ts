import { DuckDBInstance } from "@duckdb/node-api";
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
    await conn.run("INSTALL vss;");
    await conn.run("LOAD vss;");

    await conn.run(`
      CREATE TABLE IF NOT EXISTS scenes (
        id        TEXT PRIMARY KEY,
        text      TEXT NOT NULL,
        embedding FLOAT[768] NOT NULL,
        timestamp TEXT NOT NULL,
        kind      TEXT NOT NULL DEFAULT 'scene'
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS scenes_embedding_idx
      ON scenes USING HNSW (embedding)
      WITH (metric = 'cosine')
    `);
  } finally {
    conn.closeSync();
  }

  return instance;
}

function getDb(campaignPath: string): Promise<DuckDBInstance> {
  const cached = _dbPromises.get(campaignPath);
  if (cached !== undefined) return cached;

  const promise = initDb(campaignPath);
  _dbPromises.set(campaignPath, promise);
  return promise;
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
): Promise<void> {
  const [embedding, instance] = await Promise.all([
    getEmbedding(summary),
    getDb(campaignPath),
  ]);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sceneKind = kind ?? "scene";

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind)
       VALUES (?, ?, ${embeddingLiteral}, ?, ?)`,
      [id, summary, timestamp, sceneKind],
    );
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
      `SELECT id, text, timestamp, kind,
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
