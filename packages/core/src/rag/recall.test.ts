import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recall } from "./recall.js";
import { upsertLore } from "./lore.js";
import { recordScene, setSceneEntityRefs } from "./scenes.js";

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
  } catch { _ollamaReady = false; }
  return _ollamaReady;
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-recall-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("recall", () => {
  it("returns a RecallResult with query, entities, and communities fields", async () => {
    if (!(await ollamaAvailable())) return;

    const result = await recall(campaignDir, "ancient forge");
    expect(result.query).toBe("ancient forge");
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.communities)).toBe(true);
  });

  it("returns entities matching the query", async () => {
    if (!(await ollamaAvailable())) return;

    const { id } = await upsertLore(campaignDir, {
      canonical: "The Sunken Forge",
      type: "place",
      summary: "An ancient forge submerged beneath the Caldren fen.",
    });

    const result = await recall(campaignDir, "ancient forge");
    const match = result.entities.find((e) => e.id === id);
    expect(match).toBeDefined();
    expect(match!.canonical).toBe("The Sunken Forge");
    expect(match!.scenes).toBeDefined();
    expect(Array.isArray(match!.scenes)).toBe(true);
  });

  it("hydrates scenes for returned entities via scene_entity_refs", async () => {
    if (!(await ollamaAvailable())) return;

    const { id: entityId } = await upsertLore(campaignDir, {
      canonical: "Lona the Healer",
      type: "person",
      summary: "A healer in Caldren who owes Zura a debt.",
    });
    const sceneId = await recordScene(campaignDir, "Lona tended the wound without looking up.", "scene");
    await setSceneEntityRefs(campaignDir, sceneId, [{ entity_id: entityId, role: "present" }]);

    const result = await recall(campaignDir, "healer Lona");
    const entity = result.entities.find((e) => e.id === entityId);
    expect(entity).toBeDefined();
    expect(entity!.scenes.length).toBeGreaterThan(0);
    expect(entity!.scenes[0]!.id).toBe(sceneId);
  });

  it("caps scenes per entity at scenes_per_entity (default 2)", async () => {
    if (!(await ollamaAvailable())) return;

    const { id: entityId } = await upsertLore(campaignDir, {
      canonical: "The Iron Gate",
      type: "place",
      summary: "A crumbling iron gate at the edge of the Hinterlands.",
    });

    // Record 4 scenes referencing this entity
    for (let i = 0; i < 4; i++) {
      const sceneId = await recordScene(campaignDir, `Scene ${i} at the Iron Gate`, "scene");
      await setSceneEntityRefs(campaignDir, sceneId, [{ entity_id: entityId, role: "present" }]);
    }

    const result = await recall(campaignDir, "iron gate");
    const entity = result.entities.find((e) => e.id === entityId);
    expect(entity).toBeDefined();
    expect(entity!.scenes.length).toBeLessThanOrEqual(2);
  });

  it("respects the limit option", async () => {
    if (!(await ollamaAvailable())) return;

    for (let i = 0; i < 5; i++) {
      await upsertLore(campaignDir, {
        canonical: `Entity ${i}`,
        type: "concept",
        summary: "A concept related to iron and forge craft.",
      });
    }

    const result = await recall(campaignDir, "iron forge craft", { limit: 2 });
    expect(result.entities.length).toBeLessThanOrEqual(2);
  });

  it("near.entity restricts results to graph neighbors of anchor", async () => {
    if (!(await ollamaAvailable())) return;
    const { linkLore } = await import("./lore.js");

    const { id: anchorId } = await upsertLore(campaignDir, {
      canonical: "Caldren Village",
      type: "place",
      summary: "A settlement in the Hinterlands.",
    });
    const { id: neighborId } = await upsertLore(campaignDir, {
      canonical: "Elder Marn",
      type: "person",
      summary: "The elder of Caldren, keeper of the village record.",
    });
    const { id: unrelatedId } = await upsertLore(campaignDir, {
      canonical: "The Sunken Forge",
      type: "place",
      summary: "An ancient forge far to the south, no ties to Caldren.",
    });
    await linkLore(campaignDir, {
      from: anchorId,
      to: neighborId,
      relation: "governed-by",
    });

    const result = await recall(campaignDir, "elder keeper village settlement", {
      near: { entity: anchorId },
      limit: 10,
    });

    const ids = result.entities.map((e) => e.id);
    // Neighbor must appear; unrelated entity must not
    expect(ids).toContain(neighborId);
    expect(ids).not.toContain(unrelatedId);
  });
});
