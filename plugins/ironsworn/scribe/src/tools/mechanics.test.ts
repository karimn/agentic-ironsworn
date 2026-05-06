import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register } from "./mechanics.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let campaignDir: string;
let client: Client;
let server: McpServer;

const CHARACTER = {
  name: "Kara",
  stats: { edge: 2, heart: 3, iron: 1, shadow: 2, wits: 3 },
  momentum: 2,
  momentumReset: 2,
  health: 4,
  spirit: 3,
  supply: 3,
  debilities: {},
  assets: [],
  progressTracks: [],
  companions: [],
  bonds: 0,
  experience: 0,
  customState: {},
};

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-mechanics-test-"));
  await writeFile(join(campaignDir, "character.json"), JSON.stringify(CHARACTER));

  server = new McpServer({ name: "test", version: "0.0.1" });
  register(server, campaignDir);

  client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("resolve_move resource stats", () => {
  it("accepts supply as a valid stat", async () => {
    const result = await client.callTool({ name: "resolve_move", arguments: { move_name: "Make Camp", stat: "supply", adds: 0 } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.stat).toBe("supply");
    expect(parsed.statValue).toBe(3);
  });

  it("accepts health as a valid stat", async () => {
    const result = await client.callTool({ name: "resolve_move", arguments: { move_name: "Endure Harm", stat: "health", adds: 0 } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.stat).toBe("health");
    expect(parsed.statValue).toBe(4);
  });

  it("accepts spirit as a valid stat", async () => {
    const result = await client.callTool({ name: "resolve_move", arguments: { move_name: "Endure Stress", stat: "spirit", adds: 0 } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.stat).toBe("spirit");
    expect(parsed.statValue).toBe(3);
  });

  it("still accepts core stats", async () => {
    const result = await client.callTool({ name: "resolve_move", arguments: { move_name: "Face Danger", stat: "edge", adds: 0 } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.stat).toBe("edge");
    expect(parsed.statValue).toBe(2);
  });

  it("rejects invalid stat names", async () => {
    const result = await client.callTool({ name: "resolve_move", arguments: { move_name: "Face Danger", stat: "bogus", adds: 0 } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Unknown stat");
    expect(text).toContain("supply");
    expect(text).toContain("health");
    expect(text).toContain("spirit");
  });
});
