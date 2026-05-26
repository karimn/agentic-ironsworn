import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as readTools from "./tools/read.js";
import * as mechanicsTools from "./tools/mechanics.js";
import * as mutationsTools from "./tools/mutations.js";
import * as narrativeTools from "./tools/narrative.js";
import * as loreTools from "./tools/lore.js";
import * as campaignTools from "./tools/campaign.js";
import { loadExpansions } from "./expansions/loader.js";
import { checkpointLore, checkpointScenes, startPeriodicCheckpoint, replayFailures, shutdown as drainBeatQueue } from "@agentic-rpg/core";

const CAMPAIGN_PATH = process.env.SCRIBE_CAMPAIGN ?? "campaigns/default";

const server = new McpServer({
  name: "scribe",
  version: "0.0.1",
});

readTools.register(server, CAMPAIGN_PATH);
mechanicsTools.register(server, CAMPAIGN_PATH);
mutationsTools.register(server, CAMPAIGN_PATH);
narrativeTools.register(server, CAMPAIGN_PATH);
loreTools.register(server, CAMPAIGN_PATH);
campaignTools.register(server, CAMPAIGN_PATH);

await loadExpansions(server, CAMPAIGN_PATH);

// Replay any beats that failed to persist in a previous session
await replayFailures(CAMPAIGN_PATH).catch((e: unknown) => {
  process.stderr.write(`[scribe] beat replay failed: ${e}\n`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — flush WAL before the process exits
// ---------------------------------------------------------------------------
// DuckDB auto-checkpoints on a clean close, but only if the instance is
// explicitly closed. Since the MCP server holds open instances in lazy caches,
// we must checkpoint manually on SIGTERM / SIGINT so the tracked .duckdb
// binaries are up-to-date after each session. Without this, all writes live
// only in .duckdb.wal files that are gitignored, and a clone or hard crash
// loses all campaign data.

async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[scribe] ${signal} received — draining beat queue and checkpointing DuckDB…\n`);
  await drainBeatQueue(CAMPAIGN_PATH).catch((e: unknown) => {
    process.stderr.write(`[scribe] beat queue drain failed: ${e}\n`);
  });
  await Promise.all([
    checkpointLore(CAMPAIGN_PATH).catch((e: unknown) => {
      process.stderr.write(`[scribe] lore checkpoint failed: ${e}\n`);
    }),
    checkpointScenes(CAMPAIGN_PATH).catch((e: unknown) => {
      process.stderr.write(`[scribe] scenes checkpoint failed: ${e}\n`);
    }),
  ]);
  process.stderr.write("[scribe] checkpoint complete — exiting\n");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

startPeriodicCheckpoint(CAMPAIGN_PATH);

const transport = new StdioServerTransport();
await server.connect(transport);
