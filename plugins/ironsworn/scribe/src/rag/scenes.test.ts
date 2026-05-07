import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordScene, searchScenes, getRecentComplications, getScene, updateScene, deleteScene } from "./scenes.js";

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

describe("getScene", () => {
  it("returns null for non-existent scene", async () => {
    if (!(await ollamaAvailable())) return;
    // Record a scene to initialize the DB
    await recordScene(campaignDir, "A placeholder scene.");
    const result = await getScene(campaignDir, "non-existent-id");
    expect(result).toBeNull();
  });

  it("returns scene by ID after recording", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "The hero enters the dark cave.", "exploration");
    const scenes = await searchScenes(campaignDir, "dark cave", 1);
    expect(scenes.length).toBeGreaterThan(0);
    const scene = await getScene(campaignDir, scenes[0].id);
    expect(scene).not.toBeNull();
    expect(scene!.text).toContain("dark cave");
    expect(scene!.kind).toBe("exploration");
  });
});

describe("updateScene", () => {
  it("updates the summary text of an existing scene", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Original scene text.", "combat");
    const scenes = await searchScenes(campaignDir, "Original scene", 1);
    const id = scenes[0].id;

    await updateScene(campaignDir, id, { summary: "Updated scene text." });

    const updated = await getScene(campaignDir, id);
    expect(updated).not.toBeNull();
    expect(updated!.text).toBe("Updated scene text.");
  });

  it("updates the kind of an existing scene", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "A quiet campfire.", "exploration");
    const scenes = await searchScenes(campaignDir, "campfire", 1);
    const id = scenes[0].id;

    await updateScene(campaignDir, id, { kind: "social" });

    const updated = await getScene(campaignDir, id);
    expect(updated).not.toBeNull();
    expect(updated!.kind).toBe("social");
    // text unchanged
    expect(updated!.text).toContain("campfire");
  });

  it("does nothing when no fields are provided", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Unchanged scene.", "combat");
    const scenes = await searchScenes(campaignDir, "Unchanged scene", 1);
    const id = scenes[0].id;

    await updateScene(campaignDir, id, {});

    const unchanged = await getScene(campaignDir, id);
    expect(unchanged).not.toBeNull();
    expect(unchanged!.text).toBe("Unchanged scene.");
  });
});

describe("deleteScene", () => {
  it("removes a scene by ID", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Scene to delete.", "exploration");
    const scenes = await searchScenes(campaignDir, "Scene to delete", 1);
    const id = scenes[0].id;

    await deleteScene(campaignDir, id);

    const deleted = await getScene(campaignDir, id);
    expect(deleted).toBeNull();
  });

  it("does not fail when deleting non-existent ID", async () => {
    if (!(await ollamaAvailable())) return;
    // Initialize DB with a scene
    await recordScene(campaignDir, "A scene.");
    // deleteScene on non-existent ID should not throw
    await deleteScene(campaignDir, "non-existent-id");
  });
});
