import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordScene, searchScenes } from "./scenes.js";

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
