/**
 * CLI shim: migrate a legacy campaign layout into world.duckdb.
 *
 * Usage:
 *   bun run plugins/ironsworn/scribe/src/migrate.ts [campaignPath]
 *
 * If campaignPath is omitted, SCRIBE_CAMPAIGN env var is used, falling back to
 * "campaigns/default".
 *
 * Prints a JSON MigrateReport to stdout.
 */

import { migrateToWorldDb } from "@agentic-rpg/core";

const campaignPath =
  process.argv[2] ??
  process.env["SCRIBE_CAMPAIGN"] ??
  "campaigns/default";

try {
  const report = await migrateToWorldDb(campaignPath);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[migrate] ERROR: ${message}\n`);
  process.exit(1);
}
