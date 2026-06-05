import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getNpc, upsertNpc, npcFilePath, findStaleNpcs, getNpcLastUpdated, listNpcs, writeNpcRaw } from "./npcs.js";
import { getLore } from "../rag/lore.js";

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

  // issue #162: summary must include the NPC name so search_lore(name) can find the entity
  it("stores the NPC name in the entity summary", async () => {
    await upsertNpc(campaignDir, "Serin", "A shady merchant.", "Useful but untrustworthy");
    const entity = await getLore(campaignDir, "Serin");
    expect(entity).not.toBeNull();
    expect(entity!.summary).toContain("Serin");
  });

  it("uses just the name as summary when no description or impression provided", async () => {
    await upsertNpc(campaignDir, "Anonymous");
    const entity = await getLore(campaignDir, "Anonymous");
    expect(entity).not.toBeNull();
    expect(entity!.summary).toBe("Anonymous");
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

// ---------------------------------------------------------------------------
// Phase 2: entity-backed NPC tests (world.duckdb)
// ---------------------------------------------------------------------------

describe("listNpcs", () => {
  it("returns empty object when no NPCs exist", async () => {
    const npcs = await listNpcs(campaignDir);
    expect(Object.keys(npcs)).toHaveLength(0);
  });

  it("returns all upserted NPCs keyed by slug filename", async () => {
    await upsertNpc(campaignDir, "Iron Matron Sera", "Stern commander.", "Respected");
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const npcs = await listNpcs(campaignDir);
    const keys = Object.keys(npcs);
    expect(keys.some((k) => k.includes("iron-matron-sera"))).toBe(true);
    expect(keys.some((k) => k.includes("kira"))).toBe(true);
    expect(Object.values(npcs).some((v) => v.includes("# Iron Matron Sera"))).toBe(true);
    expect(Object.values(npcs).some((v) => v.includes("# Kira"))).toBe(true);
  });

  it("NPCs scoped to campaign — invisible to sibling campaign dir", async () => {
    await upsertNpc(campaignDir, "Sera", "Campaign A NPC.", "Ally");
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-npcs-sibling-"));
    try {
      const npcsInDir2 = await listNpcs(dir2);
      // Sera was created in campaignDir, should not appear in sibling dir
      const found = Object.values(npcsInDir2).some((v) => v.includes("# Sera"));
      expect(found).toBe(false);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe("writeNpcRaw", () => {
  it("parses heading and writes entity via upsertNpc", async () => {
    const markdown = `# Aldric\n\n## 2024-01-01T00:00:00.000Z\n\n**Description:** A brave knight.\n**Impression:** Loyal\n`;
    await writeNpcRaw(campaignDir, "aldric.md", markdown);
    const content = await getNpc(campaignDir, "Aldric");
    expect(content).not.toBeNull();
    expect(content).toContain("# Aldric");
    expect(content).toContain("A brave knight.");
  });

  it("falls back to filename when no heading present", async () => {
    const markdown = `**Description:** Mysterious.\n**Impression:** Unknown\n`;
    await writeNpcRaw(campaignDir, "unnamed-npc.md", markdown);
    const content = await getNpc(campaignDir, "unnamed-npc");
    expect(content).not.toBeNull();
    expect(content).toContain("Mysterious.");
  });
});
