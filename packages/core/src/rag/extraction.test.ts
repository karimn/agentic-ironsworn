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
  it("updates an existing entity by exact canonical match instead of creating a duplicate", async () => {
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

describe("extractLoreFromScene — idempotency", () => {
  it("re-running extraction on the same scene produces no extra entities or relations", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    await recordScene(campaignDir, "Vera guards the gate of Stonehaven.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Vera",
          type: "creature",
          summary: "A guard at the gate of Stonehaven.",
          aliases: [],
          excerpt: "Vera guards the gate",
          confidence: 0.9,
        },
        {
          canonical: "Stonehaven",
          type: "place",
          summary: "A fortified settlement with a guarded gate.",
          aliases: [],
          excerpt: "gate of Stonehaven",
          confidence: 0.95,
        },
      ],
      relations: [
        {
          from: "Vera",
          to: "Stonehaven",
          relation: "guards",
          excerpt: "Vera guards the gate of Stonehaven.",
          confidence: 0.9,
        },
      ],
    };

    const report1 = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });
    const report2 = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    // First run: verify entities were created as expected
    expect(report1.entities_created).toBe(2);

    // Second run: Vera and Stonehaven are now existing entities → updated not created
    expect(report2.entities_created).toBe(0);
    expect(report2.entities_updated).toBe(2);
    // relation is idempotent (linkLore uses ON CONFLICT)
    expect(report2.relations_created).toBe(1);

    const { exportLore } = await import("./lore.js");
    const { entities } = await exportLore(campaignDir);
    expect(entities.filter((e) => e.canonical === "Vera").length).toBe(1);
    expect(entities.filter((e) => e.canonical === "Stonehaven").length).toBe(1);
  });
});

describe("extractLoreFromScene — confidence threshold", () => {
  it("drops a low-confidence entity instead of inserting it", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    await recordScene(campaignDir, "A shadowy figure was seen near the ruins.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Shadowy Figure",
          type: "creature",
          summary: "An unidentified figure seen near ruins.",
          aliases: [],
          excerpt: "A shadowy figure was seen near the ruins.",
          confidence: 0.4, // below default threshold of 0.6
        },
      ],
      relations: [],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    // Entity is dropped, not created or flagged.
    expect(report.entities_created).toBe(0);
    expect(report.skipped).toBe(1);
    expect(await getLore(campaignDir, "Shadowy Figure")).toBeNull();
  });

  it("low-confidence relation is skipped entirely", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    await recordScene(campaignDir, "Perhaps the merchant knows the thane.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "The Merchant",
          type: "creature",
          summary: "A traveling merchant.",
          aliases: [],
          excerpt: "the merchant",
          confidence: 0.85,
        },
        {
          canonical: "The Thane",
          type: "creature",
          summary: "A local leader.",
          aliases: [],
          excerpt: "the thane",
          confidence: 0.85,
        },
      ],
      relations: [
        {
          from: "The Merchant",
          to: "The Thane",
          relation: "allied_with",
          excerpt: "Perhaps the merchant knows the thane.",
          confidence: 0.3, // below threshold
        },
      ],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    expect(report.relations_created).toBe(0);
    expect(report.skipped).toBe(1);
  });
});

describe("extractLoreFromScene — unresolvable relation endpoint", () => {
  it("skips a relation when either endpoint entity does not exist in the graph", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    await recordScene(campaignDir, "The oracle serves the hidden god.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Oracle",
          type: "creature",
          summary: "A seer.",
          aliases: [],
          excerpt: "The oracle",
          confidence: 0.9,
        },
        // "Hidden God" entity is NOT in the entities list so won't be in the graph
      ],
      relations: [
        {
          from: "Oracle",
          to: "Hidden God", // not created → unresolvable
          relation: "sworn_on",
          excerpt: "The oracle serves the hidden god.",
          confidence: 0.8,
        },
      ],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    expect(report.relations_created).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.entities_created).toBe(1);
  });
});

describe("extractUnprocessedScenes — batch skipping", () => {
  it("skips already-logged scenes and processes only new ones", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene } = await import("./scenes.js");

    // Record two scenes
    await recordScene(campaignDir, "Scene one: the wolf howls.");
    await recordScene(campaignDir, "Scene two: the fire burns low.");

    const { exportScenes } = await import("./scenes.js");
    const scenes = await exportScenes(campaignDir);
    expect(scenes.length).toBe(2);
    const [scene1, scene2] = scenes as [typeof scenes[0], typeof scenes[0]];
    // silence unused-variable warning from tsc; scene2 is implicitly the unprocessed one
    void scene2;

    const emptyResult: ExtractionResult = { entities: [], relations: [] };
    const stubExtractor = makeStubExtractor(emptyResult);

    // Extract scene1 first
    await extractLoreFromScene(campaignDir, scene1.id, { extractor: stubExtractor });

    // Now run batch — should skip scene1, process scene2 only
    const batchReport = await extractUnprocessedScenes(campaignDir, {
      extractor: stubExtractor,
    });

    expect(batchReport.scenes_processed).toBe(1);
    expect(batchReport.scenes_skipped).toBe(1);
  });
});

describe("extractLoreFromScene — beats fallback", () => {
  it("uses scene summary text when no beats are present", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    // recordScene without beats — summary only
    await recordScene(campaignDir, "The ironmaster forges a blade in silence.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    let capturedSceneText = "";
    const capturingExtractor: Extractor = async (sceneText, _existing) => {
      capturedSceneText = sceneText;
      return { entities: [], relations: [] };
    };

    await extractLoreFromScene(campaignDir, sceneId, {
      extractor: capturingExtractor,
    });

    expect(capturedSceneText).toBe("The ironmaster forges a blade in silence.");
  });
});

// ---------------------------------------------------------------------------
// issue #161: _makeDefaultExtractor strips markdown code fences
// ---------------------------------------------------------------------------

describe("_makeDefaultExtractor — fence stripping", () => {
  function makeMockClient(responseText: string): import("./communities.js").AnthropicLike {
    return {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: responseText }],
        }),
      },
    };
  }

  const validResult = { entities: [], relations: [] };
  const validJson = JSON.stringify(validResult);

  it("parses bare JSON without code fence", async () => {
    const extractor = _makeDefaultExtractor(makeMockClient(validJson));
    const result = await extractor("scene text", []);
    expect(result).toEqual(validResult);
  });

  it("strips ```json ... ``` fence and parses", async () => {
    const fenced = "```json\n" + validJson + "\n```";
    const extractor = _makeDefaultExtractor(makeMockClient(fenced));
    const result = await extractor("scene text", []);
    expect(result).toEqual(validResult);
  });

  it("strips plain ``` ... ``` fence and parses", async () => {
    const fenced = "```\n" + validJson + "\n```";
    const extractor = _makeDefaultExtractor(makeMockClient(fenced));
    const result = await extractor("scene text", []);
    expect(result).toEqual(validResult);
  });
});

describe("_makeDefaultExtractor — options", () => {
  it("passes temperature through to the Anthropic client", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const fakeClient = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return {
            content: [
              { type: "text", text: '{"entities":[],"relations":[]}' },
            ],
          };
        },
      },
    };

    const extractor = _makeDefaultExtractor(fakeClient as never, {
      temperature: 0,
    });
    const result = await extractor("Some scene text.", []);

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!["temperature"]).toBe(0);
    expect(result).toEqual({ entities: [], relations: [] });
  });

  it("omits temperature when not provided", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const fakeClient = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return {
            content: [
              { type: "text", text: '{"entities":[],"relations":[]}' },
            ],
          };
        },
      },
    };

    const extractor = _makeDefaultExtractor(fakeClient as never);
    await extractor("Some scene text.", []);

    expect(capturedArgs).toBeDefined();
    expect("temperature" in capturedArgs!).toBe(false);
  });
});

describe("extractLoreFromScene — temporal supersession (endpoint-primary)", () => {
  it("invalidates all prior relations on a from→to pair when a later relation supersedes, regardless of label", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene } = await import("./scenes.js");
    const { exportLore } = await import("./lore.js");

    // Scene 1: establish Caldren's title + location in Holtfen.
    const scene1 = await recordScene(
      campaignDir,
      "Caldren is the warden captain of Holtfen Settlement, where he lives.",
    );
    const setup: ExtractionResult = {
      entities: [
        {
          canonical: "Caldren",
          type: "person",
          summary: "Caldren is the warden captain of Holtfen Settlement.",
          aliases: [],
          excerpt: "Caldren is the warden captain of Holtfen Settlement",
          confidence: 0.95,
        },
        {
          canonical: "Holtfen Settlement",
          type: "place",
          summary: "Holtfen Settlement is a fortified village.",
          aliases: ["Holtfen"],
          excerpt: "Holtfen Settlement",
          confidence: 0.95,
        },
      ],
      relations: [
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "HOLDS_TITLE",
          excerpt: "warden captain of Holtfen Settlement",
          confidence: 0.95,
        },
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "LOCATED_IN",
          excerpt: "where he lives",
          confidence: 0.95,
        },
      ],
    };
    await extractLoreFromScene(campaignDir, scene1, {
      extractor: makeStubExtractor(setup),
    });

    // Scene 2: Caldren banished — a DIFFERENT label that supersedes the prior facts.
    const scene2 = await recordScene(
      campaignDir,
      "The council banished Caldren from Holtfen Settlement.",
    );
    const supersede: ExtractionResult = {
      entities: [],
      relations: [
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "BANISHED_FROM",
          supersedes: true,
          excerpt: "banished Caldren from Holtfen Settlement",
          confidence: 0.95,
        },
      ],
    };
    await extractLoreFromScene(campaignDir, scene2, {
      extractor: makeStubExtractor(supersede),
    });

    const { relations } = await exportLore(campaignDir);
    const isCaldrenHoltfen = (r: (typeof relations)[number]) =>
      r.relation === "HOLDS_TITLE" || r.relation === "LOCATED_IN";
    const prior = relations.filter(isCaldrenHoltfen);
    expect(prior.length).toBe(2);
    // Both prior facts must now be invalidated (non-null invalid_at).
    expect(prior.every((r) => r.invalid_at !== null)).toBe(true);
    // The superseding fact itself stays current.
    const banished = relations.find((r) => r.relation === "BANISHED_FROM");
    expect(banished).toBeDefined();
    expect(banished!.invalid_at).toBeNull();
  });
});
