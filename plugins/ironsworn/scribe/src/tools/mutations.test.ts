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
    { name: "Remove Caldren from Holtfen", rank: "dangerous", kind: "vow", ticks: 0, status: "active" },
    { name: "Explore the Caverns", rank: "troublesome", kind: "journey", ticks: 20, status: "active" },
    { name: "Almost Full", rank: "formidable", kind: "vow", ticks: 36, status: "active" },
    { name: "Combat Ended", rank: "formidable", kind: "combat", ticks: 40, status: "active" },
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

describe("amount parameter naming", () => {
  it("restore_spirit accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "restore_spirit",
      arguments: { amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.spirit).toBe(5); // 3 + 2 = 5
  });

  it("restore_supply accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "restore_supply",
      arguments: { amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.supply).toBe(5); // 3 + 2 = 5
  });

  it("restore_health accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "restore_health",
      arguments: { amount: 1 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.health).toBe(5); // 4 + 1 = 5
  });

  it("suffer_harm accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "suffer_harm",
      arguments: { amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.health).toBe(2); // 4 - 2 = 2
  });

  it("suffer_stress accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "suffer_stress",
      arguments: { amount: 1 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.spirit).toBe(2); // 3 - 1 = 2
  });

  it("consume_supply accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "consume_supply",
      arguments: { amount: 1 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.supply).toBe(2); // 3 - 1 = 2
  });

  it("take_momentum accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "take_momentum",
      arguments: { amount: 3 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.state.momentum).toBe(5); // 2 + 3 = 5
  });

  it("gain_experience accepts 'amount' parameter", async () => {
    const result = await client.callTool({
      name: "gain_experience",
      arguments: { amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.experience).toBe(2);
  });

  it("spend_experience accepts 'amount' parameter", async () => {
    // first gain some XP
    await client.callTool({ name: "gain_experience", arguments: { amount: 5 } });
    const result = await client.callTool({
      name: "spend_experience",
      arguments: { amount: 3 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.experience).toBe(2);
  });

  it("companion_suffer_harm accepts 'amount' parameter", async () => {
    // first add a companion
    await client.callTool({
      name: "upsert_companion",
      arguments: { companion_name: "Wolf", health: 4 },
    });
    const result = await client.callTool({
      name: "companion_suffer_harm",
      arguments: { companion_name: "Wolf", amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.companion.health).toBe(2);
  });

  it("companion_restore_health accepts 'amount' parameter", async () => {
    // first add a companion with low health
    await client.callTool({
      name: "upsert_companion",
      arguments: { companion_name: "Wolf", health: 2 },
    });
    const result = await client.callTool({
      name: "companion_restore_health",
      arguments: { companion_name: "Wolf", amount: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.companion.health).toBe(4);
  });
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
  it("marks a non-vow track as fulfilled without awarding XP", async () => {
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Combat Ended" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.status).toBe("fulfilled");
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
    expect(parsed.track.status).toBe("fulfilled");
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
    expect(parsed.track.status).toBe("fulfilled");
    expect(parsed.xpAwarded).toBe(0);
  });

  it("returns error for unknown track name", async () => {
    const result = await client.callTool({
      name: "close_track",
      arguments: { track_name: "Nonexistent Track" },
    });
    expect(result.isError).toBe(true);
  });

  it("is idempotent — closing an already-fulfilled track succeeds", async () => {
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
    expect(parsed.track.status).toBe("fulfilled");
  });
});

// ---------------------------------------------------------------------------
// issue #91: vow track ↔ thread auto-coupling
// ---------------------------------------------------------------------------

import { loadThreads } from "../state/threads.js";

describe("create_progress_track — vow auto-creates thread", () => {
  it("creates a matching open thread when kind=vow", async () => {
    const result = await client.callTool({
      name: "create_progress_track",
      arguments: { name: "Find the Oracle", rank: "dangerous", kind: "vow" },
    });
    expect(result.isError).not.toBe(true);

    const threads = await loadThreads(campaignDir);
    const thread = threads.find((t) => t.title.toLowerCase() === "find the oracle");
    expect(thread).toBeDefined();
    expect(thread!.status).toBe("open");
    expect(thread!.kind).toBe("vow");
  });

  it("does NOT create a thread for non-vow kinds", async () => {
    const kinds = ["combat", "journey", "bond", "other"] as const;
    for (const kind of kinds) {
      await client.callTool({
        name: "create_progress_track",
        arguments: { name: `Track ${kind}`, rank: "troublesome", kind },
      });
    }
    const threads = await loadThreads(campaignDir);
    // None of the auto-created threads should be for the non-vow tracks
    const autoTitles = threads.map((t) => t.title.toLowerCase());
    expect(autoTitles).not.toContain("track combat");
    expect(autoTitles).not.toContain("track journey");
    expect(autoTitles).not.toContain("track bond");
    expect(autoTitles).not.toContain("track other");
  });

  it("is a no-op on the thread side when a matching thread already exists", async () => {
    // First creation
    await client.callTool({
      name: "create_progress_track",
      arguments: { name: "Find the Oracle", rank: "dangerous", kind: "vow" },
    });
    const beforeCount = (await loadThreads(campaignDir)).length;

    // Second creation with same name — should not duplicate thread
    await client.callTool({
      name: "create_progress_track",
      arguments: { name: "Find the Oracle", rank: "formidable", kind: "vow" },
    });
    const afterCount = (await loadThreads(campaignDir)).length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe("fulfill_progress — vow auto-closes matching thread", () => {
  it("closes the matching thread on strong_hit with resolution", async () => {
    // Seed a thread
    const threadsDir = campaignDir;
    const { openThread } = await import("../state/threads.js");
    await openThread(threadsDir, "Remove Caldren from Holtfen", "vow");

    const result = await client.callTool({
      name: "fulfill_progress",
      arguments: {
        track_name: "Remove Caldren from Holtfen",
        outcome: "strong_hit",
        resolution: "Caldren was driven out.",
      },
    });
    expect(result.isError).not.toBe(true);

    const threads = await loadThreads(campaignDir);
    const thread = threads.find(
      (t) => t.title.toLowerCase() === "remove caldren from holtfen",
    );
    expect(thread).toBeDefined();
    expect(thread!.status).toBe("closed");
    expect(thread!.resolution).toBe("Caldren was driven out.");
  });

  it("succeeds even when no matching thread exists", async () => {
    const result = await client.callTool({
      name: "fulfill_progress",
      arguments: {
        track_name: "Remove Caldren from Holtfen",
        outcome: "weak_hit",
      },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
  });

  it("does NOT close a thread when fulfilling a non-vow track", async () => {
    // Seed a thread with the same name as the journey track — should remain open
    const { openThread } = await import("../state/threads.js");
    await openThread(campaignDir, "Explore the Caverns", "other");

    const result = await client.callTool({
      name: "fulfill_progress",
      arguments: {
        track_name: "Explore the Caverns",
        outcome: "strong_hit",
      },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.threadClosed).toBe(false);

    // Thread must still be open
    const threads = await loadThreads(campaignDir);
    const thread = threads.find((t) => t.title.toLowerCase() === "explore the caverns");
    expect(thread?.status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// issue #60: reach_milestone (vow-only)
// ---------------------------------------------------------------------------

describe("reach_milestone", () => {
  it("applies rank-correct ticks for count=1 — troublesome (12 ticks)", async () => {
    await client.callTool({
      name: "create_progress_track",
      arguments: { name: "T-Vow", rank: "troublesome", kind: "vow" },
    });
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "T-Vow" },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.ticks).toBe(12);
    expect(parsed.applied.milestones_applied).toBe(1);
    expect(parsed.applied.ticks_added).toBe(12);
    expect(parsed.applied.prior_ticks).toBe(0);
    expect(parsed.applied.clamped).toBe(false);
  });

  it("applies rank-correct ticks — dangerous (8), formidable (4), extreme (2), epic (1)", async () => {
    for (const [rank, ticks] of [
      ["dangerous", 8],
      ["formidable", 4],
      ["extreme", 2],
      ["epic", 1],
    ] as const) {
      const trackName = `${rank}-Vow`;
      await client.callTool({
        name: "create_progress_track",
        arguments: { name: trackName, rank, kind: "vow" },
      });
      const result = await client.callTool({
        name: "reach_milestone",
        arguments: { track_name: trackName },
      });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.track.ticks).toBe(ticks);
    }
  });

  it("applies count=2 correctly (dangerous = 16 ticks)", async () => {
    // "Remove Caldren from Holtfen" is a dangerous vow at ticks=0 in the fixture
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "Remove Caldren from Holtfen", count: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.track.ticks).toBe(16);
    expect(parsed.applied.milestones_applied).toBe(2);
    expect(parsed.applied.ticks_added).toBe(16);
  });

  it("rejects non-vow tracks", async () => {
    // "Explore the Caverns" is a journey track in the fixture
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "Explore the Caverns" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/vow tracks only/);
    expect(text).toMatch(/tick_progress/);
  });

  it("rejects non-active tracks", async () => {
    // Fulfill "Remove Caldren from Holtfen" first, then try reach_milestone on it
    await client.callTool({
      name: "fulfill_progress",
      arguments: { track_name: "Remove Caldren from Holtfen", outcome: "strong_hit" },
    });
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "Remove Caldren from Holtfen" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/not active/);
  });

  it("clamps at 40 with warning", async () => {
    // "Almost Full" is a formidable vow at ticks=36 (4 from max). One milestone = 4 ticks → exactly fills.
    // Apply count=2 → requested 8 ticks, only 4 fit, clamp.
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "Almost Full", count: 2 },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.track.ticks).toBe(40);
    expect(parsed.applied.prior_ticks).toBe(36);
    expect(parsed.applied.ticks_added).toBe(4);
    expect(parsed.applied.clamped).toBe(true);
    expect(parsed.warnings).toBeDefined();
    expect(parsed.warnings).toHaveLength(1);
  });

  it("rejects unknown track", async () => {
    const result = await client.callTool({
      name: "reach_milestone",
      arguments: { track_name: "Nope" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/not found/);
  });
});
