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
];
