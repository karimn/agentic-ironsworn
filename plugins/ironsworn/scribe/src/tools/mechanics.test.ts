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

describe("resolve_move burn_momentum", () => {
  it("applies momentum as the action score against the original challenge dice when burn_momentum=true and burnOffered", async () => {
    // Use challenge dice [9, 8] and momentum=9.
    // Max possible action score = min(6 + 2, 10) = 8 (edge=2, die max=6).
    // 8 ties 8 (does not beat) and doesn't beat 9 → always a miss.
    // momentum=9 > minChallenge(8) → burnOffered=true.
    // After burn: actionScore=9, vs [9,8]: 9 ties 9 (no) but 9 > 8 → weak_hit.
    const highMomentumChar = { ...CHARACTER, momentum: 9 };
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(highMomentumChar));

    const result = await client.callTool({
      name: "resolve_move",
      arguments: {
        move_name: "Face Danger",
        stat: "edge",
        adds: 0,
        burn_momentum: true,
        challenge_die_1: 9,
        challenge_die_2: 8,
      },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    // After burn: momentum=9 replaces action score → weak_hit (9 > 8 but not > 9)
    expect(parsed.momentumBurned).toBe(true);
    expect(parsed.actionScore).toBe(9);
    expect(parsed.band).toBe("weak_hit");
    expect(parsed.challengeDice).toEqual([9, 8]);
    expect(parsed.burnOffered).toBe(false);
  });

  it("skips burn and returns normal outcome when burn_momentum=true but burnOffered=false", async () => {
    // momentum=2 (CHARACTER default), any roll — burnOffered will be false for most results
    // Use challenge_die_1=1, challenge_die_2=1 so action score easily beats both
    // and burnOffered=false (strong hit → no burn needed)
    const result = await client.callTool({
      name: "resolve_move",
      arguments: {
        move_name: "Face Danger",
        stat: "edge",
        adds: 0,
        burn_momentum: true,
        challenge_die_1: 1,
        challenge_die_2: 1,
      },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    // No burn was needed (already a strong hit with momentum=2 vs [1,1])
    // momentumBurned should be false
    expect(parsed.momentumBurned).toBe(false);
    expect(parsed.challengeDice).toEqual([1, 1]);
  });

  it("does not roll new dice when challenge_die_1 and challenge_die_2 are supplied", async () => {
    // Run 20 times — challenge dice must always equal the supplied values
    for (let i = 0; i < 20; i++) {
      const result = await client.callTool({
        name: "resolve_move",
        arguments: { move_name: "Face Danger", stat: "edge", adds: 0, challenge_die_1: 7, challenge_die_2: 8 },
      });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(parsed.challengeDice).toEqual([7, 8]);
    }
  });
});

describe("roll_epilogue", () => {
  it("returns outcome, bonds, challengeDice, and match fields", async () => {
    const result = await client.callTool({ name: "roll_epilogue", arguments: {} });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(["strong", "weak", "miss"]).toContain(parsed.outcome);
    expect(parsed.bonds).toBe(0);
    expect(Array.isArray(parsed.challengeDice)).toBe(true);
    expect(parsed.challengeDice).toHaveLength(2);
    expect(typeof parsed.match).toBe("boolean");
  });

  it("reads bonds from character.json", async () => {
    const bondsChar = { ...CHARACTER, bonds: 7 };
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(bondsChar));
    const result = await client.callTool({ name: "roll_epilogue", arguments: {} });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.bonds).toBe(7);
    expect(parsed.progressScore).toBe(7);
  });

  it("caps bonds at 10 for progress score", async () => {
    const bondsChar = { ...CHARACTER, bonds: 15 };
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(bondsChar));
    const result = await client.callTool({ name: "roll_epilogue", arguments: {} });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.bonds).toBe(15);
    expect(parsed.progressScore).toBe(10);
  });

  it("includes oraclePrompt on weak hit or miss, null on strong hit", async () => {
    // Run many times to cover outcomes; at least verify the field is present and correct type
    for (let i = 0; i < 30; i++) {
      const result = await client.callTool({ name: "roll_epilogue", arguments: {} });
      const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      if (parsed.outcome === "strong") {
        expect(parsed.oraclePrompt).toBeNull();
      } else {
        expect(typeof parsed.oraclePrompt).toBe("string");
        expect(parsed.oraclePrompt.length).toBeGreaterThan(0);
      }
    }
  });

  it("writes a writeEpilogue entry to the journal", async () => {
    const { readFile } = await import("node:fs/promises");
    await client.callTool({ name: "roll_epilogue", arguments: {} });
    const journal = await readFile(join(campaignDir, "state-journal.jsonl"), "utf-8");
    const entries = journal.trim().split("\n").map((l) => JSON.parse(l));
    const epilogueEntry = entries.find((e) => e.kind === "writeEpilogue");
    expect(epilogueEntry).toBeDefined();
    expect(epilogueEntry.kind).toBe("writeEpilogue");
  });
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
