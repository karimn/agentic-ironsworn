import type { DbMigration } from "./index.js";

// Lore DB migrations. The baseline schema (tables created by initDb in
// rag/lore-db.ts) is version 0. Append new entries here when the schema
// changes; never edit or reorder existing entries.
//
// Example:
//   {
//     version: 1,
//     description: "add source_url column to lore_entities",
//     async up(conn) {
//       await conn.run("ALTER TABLE lore_entities ADD COLUMN IF NOT EXISTS source_url TEXT");
//     },
//   },
export const LORE_MIGRATIONS: DbMigration[] = [];
