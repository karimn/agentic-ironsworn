// Shared DuckDB + Ollama plumbing for the lore graph. Both rag/lore.ts (entity
// CRUD + search) and rag/communities.ts (GraphRAG clusters) import from here so
// they share the same lazy per-campaign DB cache, schema, and embedding client.

import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { runDbMigrations } from "../migrations/index.js";
import { LORE_MIGRATIONS } from "../migrations/lore.js";

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(`${campaignPath}/lore.duckdb`);

  const conn = await instance.connect();
  try {
    // vss is required for HNSW vector indexes. If the extension CDN is
    // unreachable, degrade gracefully: tables are created without the HNSW
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

    // GraphRAG community layer (issue #57). Hierarchical clusters of entities
    // produced by recompute_communities. member_ids holds direct children:
    // entity ids at level 0; child community ids at level > 0. embedding is
    // nullable because summaries are generated only for created/changed
    // communities — unchanged communities keep their existing summary+embedding
    // across reruns. The HNSW index on `embedding` is created below and
    // services search_lore_global (Phase C / issue #57).
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

    // Proximity layer (issue #108). Pairwise weighted edges between lore
    // entities along a single dimension (`space` or `time`). Spatial edges
    // are symmetric in magnitude — direction inversion happens at read time.
    // Temporal edges are normalized so from_id is the earlier event and
    // order_kind is always 'before'. UNIQUE (from_id, to_id, dimension)
    // ensures one row per pair per dimension; canonical ordering at write
    // time prevents (A,B) and (B,A) from coexisting.
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

    await runDbMigrations(conn, LORE_MIGRATIONS);
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

/**
 * Returns the cached DB promise for a campaign without forcing init. Used by
 * checkpoint paths that must skip cleanly when the DB hasn't been opened yet.
 */
export function peekLoreDb(campaignPath: string): Promise<DuckDBInstance> | undefined {
  return dbPromises.get(campaignPath);
}

// DuckDB's hnsw_enable_experimental_persistence flag is connection-scoped, not
// database-scoped. The initDb connection sets it, but every subsequent write
// connection opens fresh without it — causing "Duplicate keys not allowed in
// high-level wrappers" when DuckDB tries to replay buffered HNSW index appends.
// Every connection that writes to an HNSW-indexed table must set this flag.
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

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

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
