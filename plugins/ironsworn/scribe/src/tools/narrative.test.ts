import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSceneWarnings } from "./narrative.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { upsertLore, getLore } from "../rag/lore.js";

let _ollamaReady: boolean | null = null;
async function ollamaAvailable(): Promise<boolean> {
  if (_ollamaReady !== null) return _ollamaReady;
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    _ollamaReady = res.ok;
  } catch {
    _ollamaReady = false;
  }
  return _ollamaReady;
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-narrative-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("buildSceneWarnings", () => {
  it("returns generic reminder when no params provided", async () => {
    const result = await buildSceneWarnings(campaignDir, undefined, undefined);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Reminder:");
    expect(result.warnings[0]).toContain("upsert_npc");
    expect(result.warnings[0]).toContain("upsert_lore");
    expect(result.stubbed.npcs).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("returns no warnings when all NPCs are found", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const result = await buildSceneWarnings(campaignDir, ["Kira"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toHaveLength(0);
  });

  it("auto-stubs missing NPC and returns stubbed list instead of warning", async () => {
    const result = await buildSceneWarnings(campaignDir, ["Saelin"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Saelin"]);
    // Verify the stub was actually created
    const npc = await getNpc(campaignDir, "Saelin");
    expect(npc).not.toBeNull();
  });

  it("stubs only missing NPCs; already-registered NPCs pass through silently", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const result = await buildSceneWarnings(campaignDir, ["Kira", "Ghost"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    // Kira's record is untouched (still has description)
    const kira = await getNpc(campaignDir, "Kira");
    expect(kira).toContain("A fierce warrior.");
    // Ghost stub was created
    const ghost = await getNpc(campaignDir, "Ghost");
    expect(ghost).not.toBeNull();
  });

  it("stubs multiple missing NPCs in one call", async () => {
    const result = await buildSceneWarnings(campaignDir, ["Saelin", "Mara", "Thord"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Saelin", "Mara", "Thord"]);
    for (const name of ["Saelin", "Mara", "Thord"]) {
      const npc = await getNpc(campaignDir, name);
      expect(npc).not.toBeNull();
    }
  });

  it("auto-stubs missing lore entity when Ollama is available", async () => {
    if (!(await ollamaAvailable())) return;
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.lore).toEqual(["lost-vale"]);
    // Verify stub exists in the lore db
    const entity = await getLore(campaignDir, "lost-vale");
    expect(entity).not.toBeNull();
    expect(entity!.canonical).toBe("lost-vale");
  });

  it("falls back to warning for missing lore when Ollama is unavailable", async () => {
    if (await ollamaAvailable()) return; // skip if Ollama is running
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.stubbed.lore).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("lost-vale");
    expect(result.warnings[0]).toContain("upsert_lore");
  });

  it("returns no warnings for present lore entity", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Lost Vale",
      type: "place",
      summary: "A hidden valley shrouded in mist.",
    });
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("stubs both missing NPC and missing lore when Ollama is available", async () => {
    if (!(await ollamaAvailable())) return;
    const result = await buildSceneWarnings(campaignDir, ["Ghost"], ["unknown-place"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    expect(result.stubbed.lore).toEqual(["unknown-place"]);
  });

  it("falls back to warning for missing lore but stubs NPC when Ollama is unavailable", async () => {
    if (await ollamaAvailable()) return; // skip if Ollama is running
    const result = await buildSceneWarnings(campaignDir, ["Ghost"], ["unknown-place"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown-place");
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("empty arrays produce no warnings and no stubs", async () => {
    const result = await buildSceneWarnings(campaignDir, [], []);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });
});
