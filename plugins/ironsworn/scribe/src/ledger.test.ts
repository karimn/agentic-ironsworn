import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { instrumentServer, LEDGER_FILENAME, type LedgerEntry } from "./ledger.js";

let campaignDir: string;
let client: Client;
let server: McpServer;

async function connect(): Promise<void> {
  client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

async function readLedger(): Promise<LedgerEntry[]> {
  const raw = await readFile(join(campaignDir, LEDGER_FILENAME), "utf-8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LedgerEntry);
}

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-ledger-test-"));
  server = new McpServer({ name: "test", version: "0.0.1" });
  instrumentServer(server, campaignDir);
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("instrumentServer", () => {
  it("logs args and allowlisted result fields for a schema'd tool", async () => {
    server.tool(
      "resolve_move",
      "fake resolve",
      { move_name: z.string(), stat: z.string() },
      async ({ move_name, stat }) => ({
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            moveName: move_name,
            stat,
            band: "weak_hit",
            burnOffered: true,
            actionDie: 3,
            challengeDice: [4, 9],
            outcomeText: "a very long rules text that should not be logged",
          }),
        }],
      }),
    );
    await connect();
    await client.callTool({
      name: "resolve_move",
      arguments: { move_name: "Face Danger", stat: "iron" },
    });

    const [entry] = await readLedger();
    expect(entry!.tool).toBe("resolve_move");
    expect(entry!.args).toEqual({ move_name: "Face Danger", stat: "iron" });
    expect(entry!.result).toEqual({
      moveName: "Face Danger",
      stat: "iron",
      band: "weak_hit",
      burnOffered: true,
      actionDie: 3,
      challengeDice: [4, 9],
    });
    expect(entry!.isError).toBe(false);
  });

  it("truncates long string args", async () => {
    server.tool(
      "record_scene",
      "fake",
      { summary: z.string() },
      async () => ({ content: [{ type: "text" as const, text: "{}" }] }),
    );
    await connect();
    await client.callTool({
      name: "record_scene",
      arguments: { summary: "x".repeat(1000) },
    });
    const [entry] = await readLedger();
    expect((entry!.args["summary"] as string).length).toBe(301); // 300 + ellipsis
  });

  it("logs unlisted tools with args only, and marks isError results", async () => {
    server.tool(
      "get_character_digest",
      "fake",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "Error: nope" }],
        isError: true,
      }),
    );
    await connect();
    await client.callTool({ name: "get_character_digest", arguments: {} });
    const [entry] = await readLedger();
    expect(entry!.tool).toBe("get_character_digest");
    expect(entry!.result).toBeUndefined();
    expect(entry!.isError).toBe(true);
  });

  it("never fails the tool call when the ledger write fails", async () => {
    server.tool(
      "roll_yes_no",
      "fake",
      { likelihood: z.string() },
      async () => ({
        content: [{ type: "text" as const, text: JSON.stringify({ answer: "yes" }) }],
      }),
    );
    await connect();
    // Make the campaign dir unwritable so appendFile fails.
    await chmod(campaignDir, 0o500);
    try {
      const result = await client.callTool({
        name: "roll_yes_no",
        arguments: { likelihood: "50_50" },
      });
      const blocks = result.content as { text: string }[];
      expect(JSON.parse(blocks[0]!.text)).toEqual({ answer: "yes" });
    } finally {
      await chmod(campaignDir, 0o700);
    }
  });

  it("covers tools registered after instrumentation by other modules (expansion pattern)", async () => {
    // Simulate an expansion registering through the same patched server.tool.
    const registerExpansionTool = (s: McpServer): void => {
      s.tool("delve_the_depths", "fake expansion tool", { area: z.string() }, async () => ({
        content: [{ type: "text" as const, text: "{}" }],
      }));
    };
    registerExpansionTool(server);
    await connect();
    await client.callTool({ name: "delve_the_depths", arguments: { area: "Ruins" } });
    const [entry] = await readLedger();
    expect(entry!.tool).toBe("delve_the_depths");
    expect(entry!.args).toEqual({ area: "Ruins" });
  });
});
