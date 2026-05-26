import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { runDbMigrations } from "../migrations/index.js";
import { LORE_MIGRATIONS } from "../migrations/lore.js";

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

const dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });
  const instance = await DuckDBInstance.create(`${campaignPath}/lore.duckdb`);
  const conn = await instance.connect();
  try {
    let vssLoaded = false;
    try {
      await conn.run("LOAD vss;");
      await conn.run("SET hnsw_enable_experimental_persistence = true;");
      vssLoaded = true;
    } catch {
      // vss not pre-installed; HNSW index skipped
    }
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
    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS lore_embedding_idx
        ON lore_entities USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }
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
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_communities (
        id           TEXT PRIMARY KEY,
        level        INTEGER NOT NULL,
        parent_id    TEXT,
        member_ids   TEXT[] NOT NULL DEFAULT [],
        member_count INTEGER NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        embedding    FLOAT[768],
        metadata     TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_communities_parent_idx
      ON lore_communities (parent_id)
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_communities_level_idx
      ON lore_communities (level)
    `);
    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS lore_communities_embedding_idx
        ON lore_communities USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_extraction_log (
        scene_id          TEXT PRIMARY KEY,
        extracted_at      TEXT NOT NULL,
        entities_created  INTEGER NOT NULL DEFAULT 0,
        entities_updated  INTEGER NOT NULL DEFAULT 0,
        relations_created INTEGER NOT NULL DEFAULT 0,
        skipped           INTEGER NOT NULL DEFAULT 0
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_proximity_edges (
        id         TEXT PRIMARY KEY,
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        dimension  TEXT NOT NULL,
        magnitude  FLOAT NOT NULL,
        direction  TEXT,
        order_kind TEXT,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (from_id, to_id, dimension)
      )
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_proximity_from_idx
      ON lore_proximity_edges (from_id, dimension)
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_proximity_to_idx
      ON lore_proximity_edges (to_id, dimension)
    `);
    await runDbMigrations(conn, LORE_MIGRATIONS, "");
  } finally {
    conn.closeSync();
  }
  return instance;
}

export function getLoreDb(campaignPath: string): Promise<DuckDBInstance> {
  const cached = dbPromises.get(campaignPath);
  if (cached !== undefined) return cached;
  const promise = initDb(campaignPath).catch((e) => {
    dbPromises.delete(campaignPath);
    throw e;
  });
  dbPromises.set(campaignPath, promise);
  return promise;
}

export function peekLoreDb(campaignPath: string): Promise<DuckDBInstance> | undefined {
  return dbPromises.get(campaignPath);
}

export async function openLoreWriteConn(
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

export async function getLoreEmbedding(text: string): Promise<number[]> {
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
    throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { embeddings: number[][] };
  if (!data.embeddings || !Array.isArray(data.embeddings[0])) {
    throw new Error("Unexpected Ollama response shape");
  }
  if (data.embeddings[0].length !== 768) {
    throw new Error(`Expected 768-dim embedding, got ${data.embeddings[0].length}`);
  }
  if (!data.embeddings[0].every((v) => typeof v === "number" && isFinite(v))) {
    throw new Error("Invalid embedding values from Ollama");
  }
  return data.embeddings[0];
}
