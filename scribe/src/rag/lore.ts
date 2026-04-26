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

export type LoreType =
  | "material"
  | "faction"
  | "place"
  | "concept"
  | "creature"
  | "event"
  | "truth";

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  aliases?: string[];
}

export interface UpsertLoreResult {
  id: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const _dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(`${campaignPath}/lore.duckdb`);

  const conn = await instance.connect();
  try {
    await conn.run("INSTALL vss;");
    await conn.run("LOAD vss;");

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_entities (
        id         TEXT PRIMARY KEY,
        canonical  TEXT NOT NULL,
        aliases    TEXT[] NOT NULL DEFAULT [],
        type       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '{}',
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768] NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_embedding_idx
      ON lore_entities USING HNSW (embedding)
      WITH (metric = 'cosine')
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_relations (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        relation   TEXT NOT NULL,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768],
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation)
      )
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_provenance (
        id           TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id   TEXT NOT NULL,
        source_kind  TEXT NOT NULL,
        source_id    TEXT,
        excerpt      TEXT,
        confidence   FLOAT,
        created_at   TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_provenance_subject_idx
      ON lore_provenance (subject_kind, subject_id)
    `);
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
// Row mapping helper
// ---------------------------------------------------------------------------

function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];

  let content: Record<string, unknown> = {};
  const contentRaw = row["content"];
  if (typeof contentRaw === "string" && contentRaw.length > 0) {
    try {
      content = JSON.parse(contentRaw) as Record<string, unknown>;
    } catch {
      content = {};
    }
  }

  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// NOTE: This is the insert-only stage of upsertLore. Calling it with an
// existing id will currently throw a PRIMARY KEY violation, and `updated`
// is hardcoded to false. The full upsert behavior (SELECT-then-INSERT-or-
// UPDATE with rename → alias migration) is added in a later task; the
// function name and result shape are stable from day one so callers
// added in subsequent tasks don't need to change.
export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }

  const [embedding, instance] = await Promise.all([
    getEmbedding(input.summary),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});
  const aliases = input.aliases ?? [];
  const aliasesLiteral = `[${aliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

  const conn = await instance.connect();
  try {
    await conn.run(
      `INSERT INTO lore_entities
         (id, canonical, aliases, type, summary, content, embedding, created_at, updated_at)
       VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
      [id, input.canonical, input.type, input.summary, contentJson, now, now],
    );
  } finally {
    conn.closeSync();
  }

  return { id, canonical: input.canonical, aliases, updated: false };
}

export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getDb(campaignPath);

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content
       FROM lore_entities
       WHERE id = ?
       LIMIT 1`,
      [identifier],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;

    return rowToEntity(rows[0]);
  } finally {
    conn.closeSync();
  }
}
