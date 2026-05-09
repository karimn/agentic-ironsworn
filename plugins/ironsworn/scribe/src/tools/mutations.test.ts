import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register } from "./mutations.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let campaignDir: string;
let client: Client;
let server: McpServer;

const CHARACTER_WITH_TRACKS = {
  name: "Kara",
  stats: { edge: 2, heart: 3, iron: 1, shadow: 2, wits: 3 },
  momentum: 2,
  momentumReset: 2,
  health: 4,
  spirit: 3,
  supply: 3,
  debilities: {},
  assets: [],
  progressTracks: [
    { name: "Remove Caldren from Holtfen", rank: "dangerous", kind: "vow", ticks: 0, completed: false },
    { name: "Explore the Caverns", rank: "troublesome", kind: "journey", ticks: 20, completed: false },
    { name: "Almost Full", rank: "formidable", kind: "vow", ticks: 36, completed: false },
    { name: "Combat Ended", rank: "formidable", kind: "combat", ticks: 40, completed: false },
  ],
  companions: [],
  bonds: 0,
  experience: 0,
  customState: {},
};

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-mutations-test-"));
  await writeFile(join(campaignDir, "character.json"), JSON.stringify(CHARACTER_WITH_TRACKS));

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

describe("tick_progress", () => {
  it("returns applied.prior_ticks matching the track ticks before the tick", async () => {
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Remove Caldren from Holtfen", marks: 1 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.applied.prior_ticks).toBe(0);
  });

  it("returns applied.ticks_added as actual ticks added (not clamped)", async () => {
    // dangerous rank: 1 mark = 8 ticks; starting at 0 → ticks_added = 8
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Remove Caldren from Holtfen", marks: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.applied.ticks_added).toBe(16); // 2 marks * 8 ticks/mark
    expect(parsed.applied.prior_ticks).toBe(0);
    expect(parsed.applied.requested_marks).toBe(2);
    expect(parsed.applied.clamped).toBe(false);
  });

  it("returns applied.clamped=false when no clamping occurs", async () => {
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Remove Caldren from Holtfen", marks: 1 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.applied.clamped).toBe(false);
    expect(parsed.warnings).toBeUndefined();
  });

  it("returns applied.clamped=true and a warning when marks exceed max ticks", async () => {
    // dangerous rank: 16 marks * 8 ticks = 128 ticks, clamped to 40
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Remove Caldren from Holtfen", marks: 16 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.ticks).toBe(40);
    expect(parsed.applied.prior_ticks).toBe(0);
    expect(parsed.applied.requested_marks).toBe(16);
    expect(parsed.applied.ticks_added).toBe(40); // actual delta after clamping
    expect(parsed.applied.clamped).toBe(true);
    expect(parsed.warnings).toBeDefined();
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("16");
    expect(parsed.warnings[0]).toContain("clamped");
  });

  it("returns applied.ticks_added as actual delta when clamping occurs at partial fill", async () => {
    // Almost Full track: formidable (4 ticks/mark), ticks=36, room=4
    // 4 marks requested = 4*4=16 ticks, but only 4 ticks fit → ticks_added=4
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Almost Full", marks: 4 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.track.ticks).toBe(40);
    expect(parsed.applied.prior_ticks).toBe(36);
    expect(parsed.applied.ticks_added).toBe(4); // only 4 ticks fit
    expect(parsed.applied.clamped).toBe(true);
    expect(parsed.warnings).toHaveLength(1);
  });

  it("defaults to 1 mark when marks not specified", async () => {
    // dangerous: 1 mark = 8 ticks
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Remove Caldren from Holtfen" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.applied.requested_marks).toBe(1);
    expect(parsed.applied.ticks_added).toBe(8);
    expect(parsed.applied.clamped).toBe(false);
  });

  it("returns error for unknown track name", async () => {
    const result = await client.callTool({
      name: "tick_progress",
      arguments: { track_name: "Nonexistent Track", marks: 1 },
    });
    expect(result.isError).toBe(true);
  });
});

describe("close_track", () => {
  it("marks a non-vow track as completed without awarding XP", async () => {
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Combat Ended" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.completed).toBe(true);
    expect(parsed.xpAwarded).toBe(0);
  });

  it("does not change XP when closing a non-vow track", async () => {
    const before = await client.callTool({ name: "get_character_digest", arguments: {} });
    // close_track doesn't exist yet in read tools, so check via close_track result
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Explore the Caverns" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.xpAwarded).toBe(0);
    expect(parsed.track.completed).toBe(true);
    expect(parsed.track.name).toBe("Explore the Caverns");
  });

  it("also works for vow tracks (closes without awarding XP, unlike fulfill_progress)", async () => {
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Remove Caldren from Holtfen" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.completed).toBe(true);
    expect(parsed.xpAwarded).toBe(0);
  });

  it("returns error for unknown track name", async () => {
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Nonexistent Track" },
    });
    expect(result.isError).toBe(true);
  });

  it("is idempotent — closing an already-completed track succeeds", async () => {
    // First close
    await client.callTool({ name: "close_track", arguments: { track_name: "Combat Ended" } });
    // Second close — should still succeed
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Combat Ended" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.completed).toBe(true);
  });
});
