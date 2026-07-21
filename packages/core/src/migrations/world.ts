import type { DbMigration } from "./index.js";

// World DB migrations — append-only; never edit or reorder existing entries.
// Baseline (version 0): the CREATE TABLE statements in rag/world-db.ts.
// Add entries here as the schema evolves; runDbMigrations skips past
// already-applied versions automatically.
export const WORLD_MIGRATIONS: DbMigration[] = [
  {
    version: 1,
    description: "add valid_at and invalid_at to relations for bi-temporal fact tracking",
    async up(conn) {
      await conn.run(
        "ALTER TABLE relations ADD COLUMN IF NOT EXISTS valid_at TEXT",
      );
      await conn.run(
        "ALTER TABLE relations ADD COLUMN IF NOT EXISTS invalid_at TEXT",
      );
    },
  },
  {
    version: 2,
    description: "add contradictions table for write-time conflict surfacing",
    async up(conn) {
      await conn.run(`
        CREATE TABLE IF NOT EXISTS contradictions (
          id                      TEXT PRIMARY KEY,
          kind                    TEXT NOT NULL,
          entity_id               TEXT,
          relation_id             TEXT,
          conflicting_relation_id TEXT,
          existing_value          TEXT NOT NULL,
          incoming_value          TEXT NOT NULL,
          similarity              REAL,
          campaign_id             TEXT,
          created_at              TEXT NOT NULL,
          resolved_at             TEXT,
          resolution              TEXT
        )
      `);
      await conn.run(
        `CREATE INDEX IF NOT EXISTS contradictions_campaign_id_idx ON contradictions (campaign_id)`,
      );
      await conn.run(
        `CREATE INDEX IF NOT EXISTS contradictions_entity_id_idx ON contradictions (entity_id)`,
      );
    },
  },
  {
    version: 3,
    description: "add observations table for the runtime-observability track (referee + watcher sink)",
    async up(conn) {
      await conn.run(`
        CREATE TABLE IF NOT EXISTS observations (
          id          TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          source      TEXT NOT NULL,
          severity    TEXT NOT NULL,
          kind        TEXT NOT NULL,
          detail      TEXT NOT NULL,
          turn_ref    TEXT,
          blocked     BOOLEAN NOT NULL DEFAULT FALSE,
          resolved_at TEXT,
          resolution  TEXT
        )
      `);
      await conn.run(
        `CREATE INDEX IF NOT EXISTS observations_campaign_id_idx ON observations (campaign_id)`,
      );
    },
  },
];
