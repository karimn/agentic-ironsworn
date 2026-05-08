import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordScene, searchScenes, getRecentComplications, getScene, updateScene, deleteScene, recordBeats, getBeats, searchBeats, exportScenes, importScene } from "./scenes.js";

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

describe("scene beats — round-trip", () => {
  it("records beats alongside a scene and retrieves them", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "Lona reveals ward-stone secrets.", "social", undefined, [
      { kind: "narration", text: "The fire crackles between you and Lona." },
      { kind: "dialogue", speaker: "Lona", text: "The ward-stones have held for three generations." },
      { kind: "move", text: "You face danger to keep her trust.", metadata: { move: "Face Danger", stat: "heart", outcome: "weak_hit" } },
    ]);

    const beats = await getBeats(campaignDir, id);
    expect(beats).toHaveLength(3);
    expect(beats[0]!.kind).toBe("narration");
    expect(beats[0]!.beat_index).toBe(0);
    expect(beats[1]!.kind).toBe("dialogue");
    expect(beats[1]!.speaker).toBe("Lona");
    expect(beats[2]!.kind).toBe("move");
    expect(beats[2]!.metadata).toEqual({ move: "Face Danger", stat: "heart", outcome: "weak_hit" });
  });

  it("recordScene without beats remains backward-compatible", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "A quiet arrival at the village gates.", "exploration");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const beats = await getBeats(campaignDir, id);
    expect(beats).toHaveLength(0);

    const scene = await getScene(campaignDir, id);
    expect(scene).not.toBeNull();
    expect(scene!.text).toContain("village gates");
    // beats not requested — should be absent
    expect(scene!.beats).toBeUndefined();
  });

  it("getScene with include_beats returns beats", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "A tense negotiation.", "social", undefined, [
      { kind: "dialogue", speaker: "Jarl", text: "You dare bring this oath to me?" },
    ]);

    const scene = await getScene(campaignDir, id, { include_beats: true });
    expect(scene).not.toBeNull();
    expect(scene!.beats).toHaveLength(1);
    expect(scene!.beats![0]!.speaker).toBe("Jarl");
  });

  it("recordBeats appends to existing scene beats with sequential indices", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "A two-part scene.", "social", undefined, [
      { kind: "narration", text: "The hall falls silent." },
    ]);

    await recordBeats(campaignDir, id, [
      { kind: "dialogue", speaker: "Elder", text: "Speak your vow." },
    ]);

    const beats = await getBeats(campaignDir, id);
    expect(beats).toHaveLength(2);
    expect(beats[0]!.beat_index).toBe(0);
    expect(beats[1]!.beat_index).toBe(1);
    expect(beats[1]!.kind).toBe("dialogue");
  });

  it("deleteScene also removes its beats", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "Scene with beats.", "combat", undefined, [
      { kind: "move", text: "You strike with iron resolve.", metadata: { move: "Strike", stat: "iron", outcome: "strong_hit" } },
    ]);

    await deleteScene(campaignDir, id);

    const beats = await getBeats(campaignDir, id);
    expect(beats).toHaveLength(0);
  });
});

describe("searchBeats", () => {
  it("finds the most relevant beat by semantic similarity", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "A forest encounter.", "exploration", undefined, [
      { kind: "narration", text: "Ravens circle overhead in the grey morning sky." },
      { kind: "dialogue", speaker: "Stranger", text: "The iron bridge collapsed last winter." },
      { kind: "move", text: "You track the beast through deep snow.", metadata: { move: "Face Danger", stat: "wits", outcome: "strong_hit" } },
    ]);

    expect(id).toBeTruthy();

    const results = await searchBeats(campaignDir, "birds in the sky", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text).toContain("Ravens");
  });

  it("filters by kind", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "A mixed scene.", "social", undefined, [
      { kind: "narration", text: "The longhouse smells of pine smoke." },
      { kind: "dialogue", speaker: "NPC", text: "Welcome to Thornhaven." },
    ]);

    const dialogueOnly = await searchBeats(campaignDir, "greeting welcome", 5, { kind: "dialogue" });
    expect(dialogueOnly.every((b) => b.kind === "dialogue")).toBe(true);
  });

  it("filters by scene_id", async () => {
    if (!(await ollamaAvailable())) return;
    const id1 = await recordScene(campaignDir, "Scene one.", "combat", undefined, [
      { kind: "narration", text: "Blood on the snow." },
    ]);
    await recordScene(campaignDir, "Scene two.", "exploration", undefined, [
      { kind: "narration", text: "A quiet morning." },
    ]);

    const results = await searchBeats(campaignDir, "snow blood", 5, { scene_id: id1 });
    expect(results.every((b) => b.scene_id === id1)).toBe(true);
  });

  it("returns empty array when no beats recorded", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "A summary-only scene.");
    const results = await searchBeats(campaignDir, "anything", 5);
    expect(results).toEqual([]);
  });
});

describe("export/import with beats", () => {
  it("round-trips a scene with beats through export/import", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "The ward-stone scene.", "social", undefined, [
      { kind: "narration", text: "Frost gathers on the ancient stone." },
      { kind: "dialogue", speaker: "Lona", text: "Do not touch it." },
    ]);

    const exported = await exportScenes(campaignDir);
    const exportedScene = exported.find((s) => s.id === id);
    expect(exportedScene).toBeDefined();
    expect(exportedScene!.beats).toHaveLength(2);
    expect(exportedScene!.beats![0]!.kind).toBe("narration");
    expect(exportedScene!.beats![1]!.speaker).toBe("Lona");

    // Import into a fresh campaign dir
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-import-test-"));
    try {
      const inserted = await importScene(
        dir2,
        exportedScene!.id,
        exportedScene!.text,
        exportedScene!.timestamp,
        exportedScene!.kind,
        exportedScene!.complication_theme,
        exportedScene!.beats,
      );
      expect(inserted).toBe(true);

      const reimported = await getScene(dir2, id, { include_beats: true });
      expect(reimported).not.toBeNull();
      expect(reimported!.beats).toHaveLength(2);
      expect(reimported!.beats![0]!.text).toBe("Frost gathers on the ancient stone.");
      expect(reimported!.beats![1]!.speaker).toBe("Lona");
    } finally {
      await rm(dir2, { recursive: true });
    }
  });

  it("export/import without beats preserves backward compat", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "A summary-only scene.", "exploration");

    const exported = await exportScenes(campaignDir);
    const exportedScene = exported.find((s) => s.id === id);
    expect(exportedScene).toBeDefined();
    expect(exportedScene!.beats).toBeUndefined();

    const dir2 = await mkdtemp(join(tmpdir(), "scribe-import-nobeats-test-"));
    try {
      const inserted = await importScene(
        dir2,
        exportedScene!.id,
        exportedScene!.text,
        exportedScene!.timestamp,
        exportedScene!.kind,
      );
      expect(inserted).toBe(true);

      const reimported = await getScene(dir2, id, { include_beats: true });
      expect(reimported).not.toBeNull();
      expect(reimported!.beats).toHaveLength(0);
    } finally {
      await rm(dir2, { recursive: true });
    }
  });

  it("re-importing same scene returns false (idempotent)", async () => {
    if (!(await ollamaAvailable())) return;
    const id = await recordScene(campaignDir, "Idempotent test scene.", "social", undefined, [
      { kind: "narration", text: "Once recorded." },
    ]);

    const exported = await exportScenes(campaignDir);
    const exportedScene = exported.find((s) => s.id === id)!;

    // First import to a fresh dir succeeds
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-idempotent-test-"));
    try {
      const first = await importScene(dir2, exportedScene.id, exportedScene.text, exportedScene.timestamp, exportedScene.kind, undefined, exportedScene.beats);
      expect(first).toBe(true);

      // Second import of same scene returns false
      const second = await importScene(dir2, exportedScene.id, exportedScene.text, exportedScene.timestamp, exportedScene.kind, undefined, exportedScene.beats);
      expect(second).toBe(false);
    } finally {
      await rm(dir2, { recursive: true });
    }
  });
});
