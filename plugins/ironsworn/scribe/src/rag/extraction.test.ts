import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractLoreFromScene,
  extractUnprocessedScenes,
  _makeDefaultExtractor,
  type Extractor,
  type ExtractionResult,
  type ExtractionReport,
  type BatchReport,
} from "./extraction.js";
import { upsertLore, getLore } from "./lore.js";
import { LORE_TYPES } from "./lore.js";

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
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-extraction-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// Stub extractor — returns a fixed result, no LLM needed
function makeStubExtractor(result: ExtractionResult): Extractor {
  return async (_sceneText, _existingEntities) => result;
}

describe("_makeDefaultExtractor", () => {
  it("is a function", () => {
    expect(typeof _makeDefaultExtractor).toBe("function");
  });
});

describe("extractLoreFromScene — basic extraction", () => {
  it("creates entities and relations from a synthetic scene", async () => {
    if (!(await ollamaAvailable())) return;

    // We need a real scene in scenes.duckdb — import the scenes module directly
    // to record a scene without going through the MCP tool layer.
    const { recordScene } = await import("./scenes.js");
    const sceneId = await recordScene(
      campaignDir,
      "Lona the healer tends to wounds in the village of Caldren. She serves the Thornwood faction.",
    );

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Lona",
          type: "creature",
          summary: "A healer who tends wounds in Caldren.",
          aliases: ["the healer Lona"],
          excerpt: "Lona the healer tends to wounds",
          confidence: 0.9,
        },
        {
          canonical: "Caldren",
          type: "place",
          summary: "A village where Lona practices healing.",
          aliases: [],
          excerpt: "the village of Caldren",
          confidence: 0.95,
        },
        {
          canonical: "Thornwood",
          type: "faction",
          summary: "A faction that Lona serves.",
          aliases: [],
          excerpt: "She serves the Thornwood faction.",
          confidence: 0.85,
        },
      ],
      relations: [
        {
          from: "Lona",
          to: "Caldren",
          relation: "located_in",
          notes: "practices healing here",
          excerpt: "Lona the healer tends to wounds in the village of Caldren",
          confidence: 0.9,
        },
        {
          from: "Lona",
          to: "Thornwood",
          relation: "member_of",
          excerpt: "She serves the Thornwood faction.",
          confidence: 0.85,
        },
      ],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    expect(report.scene_id).toBe(sceneId);
    expect(report.entities_created).toBe(3);
    expect(report.entities_updated).toBe(0);
    expect(report.relations_created).toBe(2);
    expect(report.skipped).toBe(0);

    // Verify entities are in the graph
    const lona = await getLore(campaignDir, "Lona");
    expect(lona).not.toBeNull();
    expect(lona!.type).toBe("creature");

    const caldren = await getLore(campaignDir, "Caldren");
    expect(caldren).not.toBeNull();
    expect(caldren!.type).toBe("place");
  });
});

describe("extractLoreFromScene — dedup", () => {
  it("updates an existing entity when cosine similarity >= 0.92 instead of creating a duplicate", async () => {
    if (!(await ollamaAvailable())) return;

    // Pre-seed an entity for "Lona"
    await upsertLore(campaignDir, {
      canonical: "Lona",
      type: "creature",
      summary: "A healer in Caldren.",
    });

    const { recordScene } = await import("./scenes.js");
    await recordScene(campaignDir, "Lona tends the sick.");
    const { exportScenes } = await import("./scenes.js");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Lona",
          type: "creature",
          summary: "Lona, the healer of Caldren, known for her skill.",
          aliases: ["the healer Lona"],
          excerpt: "Lona tends the sick.",
          confidence: 0.9,
        },
      ],
      relations: [],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    expect(report.entities_created).toBe(0);
    expect(report.entities_updated).toBe(1);

    // Only one "lona" entity should exist
    const { exportLore } = await import("./lore.js");
    const { entities } = await exportLore(campaignDir);
    const lonaEntities = entities.filter(
      (e) => e.canonical.toLowerCase() === "lona",
    );
    expect(lonaEntities.length).toBe(1);
  });
});
