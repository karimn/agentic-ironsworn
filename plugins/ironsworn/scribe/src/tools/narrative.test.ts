import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSceneWarnings } from "./narrative.js";
import { upsertNpc } from "../state/npcs.js";
import { upsertLore } from "../rag/lore.js";

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/tags`,
    );
    return res.ok;
  } catch {
    return false;
  }
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
    const warnings = await buildSceneWarnings(campaignDir, undefined, undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Reminder:");
    expect(warnings[0]).toContain("upsert_npc");
    expect(warnings[0]).toContain("upsert_lore");
  });

  it("returns no warnings when all NPCs are found", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const warnings = await buildSceneWarnings(campaignDir, ["Kira"], undefined);
    expect(warnings).toHaveLength(0);
  });

  it("returns warning for missing NPC", async () => {
    const warnings = await buildSceneWarnings(campaignDir, ["Unknown NPC"], undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Unknown NPC");
    expect(warnings[0]).toContain("upsert_npc");
  });

  it("returns warnings only for missing NPCs when some are recorded", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const warnings = await buildSceneWarnings(campaignDir, ["Kira", "Ghost"], undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Ghost");
  });

  it("returns warning for missing lore entity (no Ollama needed for empty DB)", async () => {
    const warnings = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("lost-vale");
    expect(warnings[0]).toContain("upsert_lore");
  });

  it("returns no warnings for present lore entity", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Lost Vale",
      type: "place",
      summary: "A hidden valley shrouded in mist.",
    });
    const warnings = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(warnings).toHaveLength(0);
  });

  it("returns warnings for both missing NPC and missing lore", async () => {
    const warnings = await buildSceneWarnings(campaignDir, ["Ghost"], ["unknown-place"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes("Ghost"))).toBe(true);
    expect(warnings.some((w) => w.includes("unknown-place"))).toBe(true);
  });

  it("empty arrays produce no warnings (no generic reminder)", async () => {
    const warnings = await buildSceneWarnings(campaignDir, [], []);
    expect(warnings).toHaveLength(0);
  });
});
