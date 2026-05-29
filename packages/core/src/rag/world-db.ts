import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { runDbMigrations } from "../migrations/index.js";
import { WORLD_MIGRATIONS } from "../migrations/world.js";
import { ensureWorldJson, assertEmbeddingPin } from "../world.js";
import type { WorldContext } from "../world.js";

// Re-export WorldContext so callers can import from a single place.
export type { WorldContext } from "../world.js";

// ---------------------------------------------------------------------------
// Lazy instance cache — keyed by worldDbPath (same pattern as lore-db.ts)
// ---------------------------------------------------------------------------

const dbPromises = new Map<string, Promise<DuckDBInstance>>();

// ---------------------------------------------------------------------------
// initDb — opens world.duckdb with the full target schema
// ---------------------------------------------------------------------------

async function initDb(ctx: WorldContext): Promise<DuckDBInstance> {
  // mkdir -p the worldRoot before anything else
  await mkdir(ctx.worldRoot, { recursive: true });

  // Fail fast on embedding-pin mismatch BEFORE opening the DB (spec Decision 3)
  const worldJson = await ensureWorldJson(ctx.worldRoot, basename(ctx.worldRoot));
  assertEmbeddingPin(worldJson.embedding);

  const instance = await DuckDBInstance.create(ctx.worldDbPath);
  const conn = await instance.connect();
  try {
    // -----------------------------------------------------------------------
    // Load VSS extension for HNSW indexes
    // -----------------------------------------------------------------------
    let vssLoaded = false;
    try {
      await conn.run("LOAD vss;");
      await conn.run("SET hnsw_enable_experimental_persistence = true;");
      vssLoaded = true;
    } catch {
      // vss not pre-installed; HNSW indexes skipped
    }

    // -----------------------------------------------------------------------
    // entities — UUID PKs, campaign_id partition column (NULL = world canon)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS entities (
        id                  UUID PRIMARY KEY,
        slug                TEXT NOT NULL,
        canonical           TEXT NOT NULL,
        aliases             TEXT[] NOT NULL DEFAULT [],
        type                TEXT NOT NULL,
        summary             TEXT NOT NULL,
        content             TEXT NOT NULL DEFAULT '{}',
        metadata            TEXT NOT NULL DEFAULT '{}',
        embedding           FLOAT[768] NOT NULL,
        campaign_id         TEXT,
        created_in_campaign TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      )
    `);
    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS entities_embedding_idx
        ON entities USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }
    await conn.run(`
      CREATE INDEX IF NOT EXISTS entities_campaign_id_idx
      ON entities (campaign_id)
    `);

    // -----------------------------------------------------------------------
    // relations — UUID PKs, campaign_id for overlay state (D10)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS relations (
        id          UUID PRIMARY KEY,
        from_entity UUID NOT NULL,
        to_entity   UUID NOT NULL,
        label       TEXT NOT NULL,
        notes       TEXT,
        metadata    TEXT NOT NULL DEFAULT '{}',
        embedding   FLOAT[768],
        campaign_id TEXT,
        created_at  TEXT NOT NULL,
        UNIQUE (from_entity, to_entity, label, campaign_id)
      )
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS relations_campaign_id_idx
      ON relations (campaign_id)
    `);

    // -----------------------------------------------------------------------
    // scenes — always campaign-owned; place_entity is a geospatial anchor
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS scenes (
        id                 UUID PRIMARY KEY,
        campaign_id        TEXT NOT NULL,
        place_entity       UUID,
        text               TEXT NOT NULL,
        embedding          FLOAT[768] NOT NULL,
        kind               TEXT NOT NULL DEFAULT 'scene',
        complication_theme TEXT,
        quality_notes      TEXT,
        timestamp          TEXT NOT NULL
      )
    `);
    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS scenes_embedding_idx
        ON scenes USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }
    await conn.run(`
      CREATE INDEX IF NOT EXISTS scenes_campaign_id_idx
      ON scenes (campaign_id)
    `);

    // -----------------------------------------------------------------------
    // scene_entity_refs — FK-backed entity refs per scene (replaces name-warning)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS scene_entity_refs (
        scene_id  UUID NOT NULL,
        entity_id UUID NOT NULL,
        role      TEXT NOT NULL DEFAULT 'present',
        PRIMARY KEY (scene_id, entity_id)
      )
    `);

    // -----------------------------------------------------------------------
    // scene_beats — per-beat narrative log; FK on scene_id (now UUID)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS scene_beats (
        id         UUID PRIMARY KEY,
        scene_id   UUID NOT NULL,
        beat_index INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        speaker    TEXT,
        text       TEXT NOT NULL,
        embedding  FLOAT[768] NOT NULL,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (scene_id, beat_index)
      )
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS scene_beats_scene_idx
      ON scene_beats (scene_id, beat_index)
    `);
    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS scene_beats_embedding_idx
        ON scene_beats USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }

    // -----------------------------------------------------------------------
    // lore_provenance — subject_id now holds UUIDs
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_provenance (
        id           UUID PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id   UUID NOT NULL,
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

    // -----------------------------------------------------------------------
    // lore_communities — gains campaign_id; clusters visible subgraph (Decision 5)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_communities (
        id           UUID PRIMARY KEY,
        level        INTEGER NOT NULL,
        parent_id    UUID,
        member_ids   UUID[] NOT NULL DEFAULT [],
        member_count INTEGER NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        embedding    FLOAT[768],
        metadata     TEXT NOT NULL DEFAULT '{}',
        campaign_id  TEXT,
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

    // -----------------------------------------------------------------------
    // lore_proximity_edges — gains campaign_id; from_id/to_id now UUIDs
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_proximity_edges (
        id         UUID PRIMARY KEY,
        from_id    UUID NOT NULL,
        to_id      UUID NOT NULL,
        dimension  TEXT NOT NULL,
        magnitude  FLOAT NOT NULL,
        direction  TEXT,
        order_kind TEXT,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        campaign_id TEXT,
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

    // -----------------------------------------------------------------------
    // lore_extraction_log — scene_id now UUID
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_extraction_log (
        scene_id          UUID PRIMARY KEY,
        extracted_at      TEXT NOT NULL,
        entities_created  INTEGER NOT NULL DEFAULT 0,
        entities_updated  INTEGER NOT NULL DEFAULT 0,
        relations_created INTEGER NOT NULL DEFAULT 0,
        skipped           INTEGER NOT NULL DEFAULT 0
      )
    `);

    // -----------------------------------------------------------------------
    // Run any post-baseline migrations
    // -----------------------------------------------------------------------
    await runDbMigrations(conn, WORLD_MIGRATIONS, "");
  } finally {
    conn.closeSync();
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Public API — matching the pattern of getLoreDb / peekLoreDb
// ---------------------------------------------------------------------------

/** Open (or return cached) world.duckdb for the given WorldContext. */
export function getWorldDb(ctx: WorldContext): Promise<DuckDBInstance> {
  const cached = dbPromises.get(ctx.worldDbPath);
  if (cached !== undefined) return cached;
  const promise = initDb(ctx).catch((e) => {
    dbPromises.delete(ctx.worldDbPath);
    throw e;
  });
  dbPromises.set(ctx.worldDbPath, promise);
  return promise;
}

/** Return the cached promise without opening, or undefined if not yet opened. */
export function peekWorldDb(worldDbPath: string): Promise<DuckDBInstance> | undefined {
  return dbPromises.get(worldDbPath);
}

/** Open a write-capable connection with the HNSW persistence flag set (if vss is available). */
export async function openWorldWriteConn(
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
// Embedding — re-export from lore-db.ts to avoid duplication
// ---------------------------------------------------------------------------

// NOTE: We intentionally re-export getLoreEmbedding rather than copying the
// implementation, since both functions are identical (same Ollama endpoint,
// same model, same 768-dim validation). Phase 1 can rename the export or add
// a thin wrapper if a world-specific name is preferred.
export { getLoreEmbedding as getWorldEmbedding } from "./lore-db.js";
