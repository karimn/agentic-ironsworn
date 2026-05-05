import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordScene, searchScenes, getRecentComplications } from "./scenes.js";

// Check if Ollama is running
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
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-scenes-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true });
});

describe("recordScene + searchScenes", () => {
  it("stores and retrieves a scene", async () => {
    if (!(await ollamaAvailable())) return; // skip gracefully
    await recordScene(campaignDir, "The iron gate creaks open revealing a dark passage.");
    const results = await searchScenes(campaignDir, "gate passage", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("iron gate");
  });

  it("returns empty array when no scenes recorded", async () => {
    if (!(await ollamaAvailable())) return;
    const results = await searchScenes(campaignDir, "anything", 3);
    expect(results).toEqual([]);
  });
});

describe("getRecentComplications", () => {
  it("returns only scenes with complication_theme set", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Wolves attacked at the river ford.", "exploration", "beasts");
    await recordScene(campaignDir, "The village elder greeted them warmly.", "social");
    await recordScene(campaignDir, "A blizzard rolled in without warning.", "exploration", "weather");
    const results = await getRecentComplications(campaignDir, 5);
    expect(results).toHaveLength(2);
    expect(results[0].complication_theme).toBe("weather");
    expect(results[1].complication_theme).toBe("beasts");
  });

  it("returns empty array when no complications recorded", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "A quiet day of travel.", "exploration");
    const results = await getRecentComplications(campaignDir, 5);
    expect(results).toEqual([]);
  });

  it("respects the k limit", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Wolves attacked.", "exploration", "beasts");
    await recordScene(campaignDir, "Bridge collapsed.", "exploration", "physical-hazard");
    await recordScene(campaignDir, "Blizzard hit.", "exploration", "weather");
    const results = await getRecentComplications(campaignDir, 2);
    expect(results).toHaveLength(2);
  });
});
