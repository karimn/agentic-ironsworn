import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordBeatCanon } from "./beat-canon.js";
import { upsertLore, getLore, exportLore } from "./lore.js";
import { recordScene } from "./scenes.js";

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

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "beat-canon-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("recordBeatCanon — entities", () => {
  it("reuses an existing entity by exact canonical match (no duplicate)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Lona", type: "person", summary: "A healer in Caldren." });
    const sceneId = await recordScene(dir, "Lona tends the sick.");

    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Lona", type: "person", summary: "A healer." }], []);

    expect(r.entities_reused).toBe(1);
    expect(r.entities_created).toBe(0);
    const { entities } = await exportLore(dir);
    expect(entities.filter((e) => e.canonical.toLowerCase() === "lona").length).toBe(1);
  });

  it("creates a new campaign-scoped entity when not found", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Vera guards the gate of Stonehaven.");

    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Stonehaven", type: "place", summary: "A fortified settlement." }], []);

    expect(r.entities_created).toBe(1);
    expect(await getLore(dir, "Stonehaven")).not.toBeNull();
  });

  it("skips an entity with an invalid type", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Something happens.");
    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Bogus", type: "notatype" as never, summary: "x" }], []);
    expect(r.entities_created).toBe(0);
    expect(r.skipped.length).toBe(1);
  });
});

describe("recordBeatCanon — relations", () => {
  it("links a relation when both endpoints already exist", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Vera", type: "person", summary: "A guard." });
    await upsertLore(dir, { canonical: "Stonehaven", type: "place", summary: "A settlement." });
    const sceneId = await recordScene(dir, "Vera guards Stonehaven.");

    const r = await recordBeatCanon(dir, sceneId, [],
      [{ from: "Vera", to: "Stonehaven", label: "GUARDS" }]);

    expect(r.relations_linked).toBe(1);
    const { relations } = await exportLore(dir);
    expect(relations.some((x) => x.relation === "GUARDS")).toBe(true);
  });

  it("resolves an endpoint created in the same call (entities then relations)", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Lona serves the Thornwood.");
    const r = await recordBeatCanon(dir, sceneId,
      [
        { canonical: "Lona", type: "person", summary: "A healer." },
        { canonical: "Thornwood", type: "faction", summary: "A faction." },
      ],
      [{ from: "Lona", to: "Thornwood", label: "MEMBER_OF" }]);
    expect(r.entities_created).toBe(2);
    expect(r.relations_linked).toBe(1);
  });

  it("skips a relation with an unresolved endpoint and reports it", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Oracle", type: "person", summary: "A seer." });
    const sceneId = await recordScene(dir, "The oracle serves the hidden god.");

    const r = await recordBeatCanon(dir, sceneId, [],
      [{ from: "Oracle", to: "Hidden God", label: "SERVES" }]);

    expect(r.relations_linked).toBe(0);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0]).toContain("Hidden God");
  });

  it("invalidates a prior relation when supersedes is true", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Caldren", type: "person", summary: "A warden." });
    await upsertLore(dir, { canonical: "Holtfen", type: "place", summary: "A village." });
    const scene1 = await recordScene(dir, "Caldren leads Holtfen.");
    await recordBeatCanon(dir, scene1, [], [{ from: "Caldren", to: "Holtfen", label: "HOLDS_TITLE" }]);
    const scene2 = await recordScene(dir, "Caldren is banished from Holtfen.");

    await recordBeatCanon(dir, scene2, [],
      [{ from: "Caldren", to: "Holtfen", label: "BANISHED_FROM", supersedes: true }]);

    const { relations } = await exportLore(dir);
    const prior = relations.find((x) => x.relation === "HOLDS_TITLE");
    expect(prior!.invalid_at).not.toBeNull();
  });

  it("is idempotent — re-recording the same canon adds no duplicates", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Vera guards Stonehaven.");
    const beatEntities = [
      { canonical: "Vera", type: "person" as const, summary: "A guard." },
      { canonical: "Stonehaven", type: "place" as const, summary: "A settlement." },
    ];
    const beatRels = [{ from: "Vera", to: "Stonehaven", label: "GUARDS" }];
    await recordBeatCanon(dir, sceneId, beatEntities, beatRels);
    const r2 = await recordBeatCanon(dir, sceneId, beatEntities, beatRels);

    expect(r2.entities_created).toBe(0);
    expect(r2.entities_reused).toBe(2);
    const { entities, relations } = await exportLore(dir);
    expect(entities.filter((e) => e.canonical === "Vera").length).toBe(1);
    expect(relations.filter((x) => x.relation === "GUARDS").length).toBe(1);
  });
});
