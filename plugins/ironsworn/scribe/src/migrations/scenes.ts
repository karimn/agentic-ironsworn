import type { DbMigration } from "./index.js";

// Scenes DB migrations. The baseline schema (tables created by initDb in
// rag/scenes.ts) is version 0. Append new entries here when the schema
// changes; never edit or reorder existing entries.
//
// Example:
//   {
//     version: 1,
//     description: "add arc column to scenes",
//     async up(conn) {
//       await conn.run("ALTER TABLE scenes ADD COLUMN IF NOT EXISTS arc TEXT");
//     },
//   },
export const SCENES_MIGRATIONS: DbMigration[] = [];
