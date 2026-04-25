import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getNpc, upsertNpc, npcFilePath } from "./npcs.js";

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
