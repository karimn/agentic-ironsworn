import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getNpc, upsertNpc, npcFilePath, findStaleNpcs, getNpcLastUpdated } from "./npcs.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-npcs-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("npcFilePath", () => {
  it("sanitizes name to kebab-case", () => {
    const path = npcFilePath("/campaigns/test", "Iron Matron Sera");
    expect(path).toContain("iron-matron-sera.md");
  });

  it("strips special characters", () => {
    const path = npcFilePath("/campaigns/test", "Kira! The Bold");
    expect(path).toContain("kira-the-bold.md");
  });
});

describe("getNpc", () => {
  it("returns null for nonexistent NPC", async () => {
    const result = await getNpc(campaignDir, "Unknown Person");
    expect(result).toBeNull();
  });
});

describe("upsertNpc", () => {
  it("creates a new NPC file", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const content = await getNpc(campaignDir, "Kira");
    expect(content).not.toBeNull();
    expect(content).toContain("# Kira");
    expect(content).toContain("A fierce warrior.");
    expect(content).toContain("Trustworthy");
  });

  it("appends a new section to existing NPC", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    await upsertNpc(campaignDir, "Kira", "Battle-scarred now.", "Still loyal");
    const content = await getNpc(campaignDir, "Kira");
    expect(content).toContain("A fierce warrior.");
    expect(content).toContain("Battle-scarred now.");
  });

  it("handles missing description/impression gracefully", async () => {
    await upsertNpc(campaignDir, "Stranger");
    const content = await getNpc(campaignDir, "Stranger");
    expect(content).toContain("(none)");
  });
});

// ---------------------------------------------------------------------------
// issue #92: stale NPC detection
// ---------------------------------------------------------------------------

describe("getNpcLastUpdated", () => {
  it("returns the most recent ISO timestamp from the NPC file", async () => {
    await upsertNpc(campaignDir, "Kira", "A warrior");
    const ts = await getNpcLastUpdated(campaignDir, "Kira");
    expect(ts).not.toBeNull();
    // Should be a valid ISO string close to now
    const diff = Date.now() - new Date(ts!).getTime();
    expect(diff).toBeLessThan(5000);
  });

  it("returns null for nonexistent NPC", async () => {
    const ts = await getNpcLastUpdated(campaignDir, "Nobody");
    expect(ts).toBeNull();
  });
});

describe("findStaleNpcs", () => {
  const THRESHOLD = 3;

  it("does not flag a freshly upserted NPC with no scenes since update", async () => {
    await upsertNpc(campaignDir, "Kira", "A warrior");
    const lastUpdated = (await getNpcLastUpdated(campaignDir, "Kira"))!;
    // Zero scenes since upsert
    const results = findStaleNpcs(
      [{ name: "Kira", lastUpdated, scenesSinceUpdate: 0 }],
      THRESHOLD,
    );
    expect(results).toHaveLength(0);
  });

  it("flags an NPC that appears in 3+ scenes since their last upsert", async () => {
    await upsertNpc(campaignDir, "Lago Rhian", "A trainer");
    const lastUpdated = (await getNpcLastUpdated(campaignDir, "Lago Rhian"))!;
    const results = findStaleNpcs(
      [{ name: "Lago Rhian", lastUpdated, scenesSinceUpdate: 5 }],
      THRESHOLD,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Lago Rhian");
    expect(results[0]!.scenes_since_update).toBe(5);
  });

  it("does not flag an NPC with fewer than threshold scenes", async () => {
    await upsertNpc(campaignDir, "Minor NPC", "A passerby");
    const lastUpdated = (await getNpcLastUpdated(campaignDir, "Minor NPC"))!;
    const results = findStaleNpcs(
      [{ name: "Minor NPC", lastUpdated, scenesSinceUpdate: 2 }],
      THRESHOLD,
    );
    expect(results).toHaveLength(0);
  });

  it("sorts results by scenes_since_update descending", async () => {
    await upsertNpc(campaignDir, "Alpha");
    await upsertNpc(campaignDir, "Beta");
    const tsAlpha = (await getNpcLastUpdated(campaignDir, "Alpha"))!;
    const tsBeta = (await getNpcLastUpdated(campaignDir, "Beta"))!;
    const results = findStaleNpcs(
      [
        { name: "Alpha", lastUpdated: tsAlpha, scenesSinceUpdate: 4 },
        { name: "Beta", lastUpdated: tsBeta, scenesSinceUpdate: 7 },
      ],
      THRESHOLD,
    );
    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe("Beta");
    expect(results[1]!.name).toBe("Alpha");
  });

  it("handles an empty NPC list gracefully", () => {
    const results = findStaleNpcs([], THRESHOLD);
    expect(results).toHaveLength(0);
  });
});
