import { describe, it, expect } from "bun:test";
import {
  matchEntities,
  cosine,
  canonLabel,
  scoreExtraction,
  type ActualEntity,
  type GoldenEntity,
  type Embedder,
  type ActualState,
  type GoldenSet,
} from "./score.js";

// Deterministic stub embedder: maps known names to fixed vectors so we can
// drive the embedding-fallback branch without Ollama.
function stubEmbedder(table: Record<string, number[]>): Embedder {
  return async (text: string) => table[text.toLowerCase().trim()] ?? [0, 0, 0];
}

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
});

describe("canonLabel", () => {
  it("uppercases, underscores spaces, and applies the synonym map", () => {
    expect(canonLabel("member of")).toBe("MEMBER_OF");
    expect(canonLabel("serves")).toBe("MEMBER_OF");
    expect(canonLabel("LEADS")).toBe("LEADS");
  });
});

describe("matchEntities", () => {
  const embedder = stubEmbedder({});

  it("matches by canonical name (case-insensitive)", async () => {
    const actual: ActualEntity[] = [{ canonical: "Lona", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(1);
    expect(m.falsePositives.length).toBe(0);
    expect(m.unmatchedGolden.length).toBe(0);
  });

  it("matches via alias overlap", async () => {
    const actual: ActualEntity[] = [{ canonical: "the healer Lona", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature", aliases: ["the healer Lona"] }];
    const m = await matchEntities(actual, golden, embedder);
    // Must match via the name/alias pass — the stub embedder returns [0,0,0] for unknowns, so an embedding match is impossible here.
    expect(m.pairs.length).toBe(1);
  });

  it("flags an unmatched actual as a false positive", async () => {
    const actual: ActualEntity[] = [{ canonical: "Goblin", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(0);
    expect(m.falsePositives.length).toBe(1);
    expect(m.unmatchedGolden.length).toBe(1);
  });

  it("flags a second actual for the same golden as a near-duplicate", async () => {
    const actual: ActualEntity[] = [
      { canonical: "Lona", type: "creature", aliases: [] },
      { canonical: "Lona", type: "creature", aliases: [] },
    ];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(1);
    expect(m.nearDuplicates.length).toBe(1);
  });

  it("matches via embedding fallback when names differ but are close", async () => {
    const emb = stubEmbedder({
      "ashfen market quarter": [1, 0, 0],
      "the ashfen market": [0.99, 0.01, 0],
    });
    const actual: ActualEntity[] = [{ canonical: "the Ashfen market", type: "place", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Ashfen Market Quarter", type: "place" }];
    const m = await matchEntities(actual, golden, emb, 0.85);
    expect(m.pairs.length).toBe(1);
    expect(m.falsePositives.length).toBe(0);
  });

  it("embedding fallback: claimed golden → near-duplicate, not false positive", async () => {
    const emb = stubEmbedder({
      "lona": [1, 0, 0],
      "healer lona": [0.99, 0, 0],
    });
    const actual: ActualEntity[] = [
      { canonical: "Lona", type: "creature", aliases: [] },
      { canonical: "healer Lona", type: "creature", aliases: [] },
    ];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature" }];
    const m = await matchEntities(actual, golden, emb, 0.85);
    expect(m.pairs.length).toBe(1);
    expect(m.nearDuplicates.length).toBe(1);
    expect(m.falsePositives.length).toBe(0);
  });
});

describe("scoreExtraction", () => {
  const embedder: Embedder = async () => [1, 0, 0];

  const golden: GoldenSet = {
    entities: [
      { canonical: "Lona", type: "creature", aliases: ["the healer Lona"] },
      { canonical: "Caldren", type: "place" },
      { canonical: "Thornwood", type: "faction" },
    ],
    relations: [
      { from: "Lona", to: "Caldren", label: "LOCATED_IN" },
      { from: "Lona", to: "Thornwood", label: "MEMBER_OF" },
    ],
  };

  it("scores a perfect match as 1.0 across entity and relation F1", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [
        { from: "Lona", to: "Caldren", label: "LOCATED_IN", invalidated: false },
        { from: "Lona", to: "Thornwood", label: "SERVES", invalidated: false }, // synonym
      ],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.f1).toBeCloseTo(1, 6);
    expect(s.entity.typeAccuracy).toBeCloseTo(1, 6);
    expect(s.relation.f1).toBeCloseTo(1, 6); // both endpoint-pairs reproduced
    expect(s.relation.labelAccuracy).toBeCloseTo(1, 6); // LOCATED_IN exact, SERVES≈MEMBER_OF
    expect(s.dedup.score).toBeCloseTo(1, 6);
  });

  it("counts a right-endpoint wrong-label relation as a hit but drops labelAccuracy", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [
        // correct endpoints, correct label
        { from: "Lona", to: "Caldren", label: "LOCATED_IN", invalidated: false },
        // correct endpoints, UNRELATED label (not a synonym of MEMBER_OF)
        { from: "Lona", to: "Thornwood", label: "BANISHED_TO", invalidated: false },
      ],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    // both endpoint-pairs present → endpoint precision/recall/f1 are perfect
    expect(s.relation.precision).toBeCloseTo(1, 6);
    expect(s.relation.recall).toBeCloseTo(1, 6);
    expect(s.relation.f1).toBeCloseTo(1, 6);
    // ...but only 1 of 2 matched pairs has an agreeing label
    expect(s.relation.labelAccuracy).toBeCloseTo(1 / 2, 6);
  });

  it("drops entity recall on a missed golden entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.recall).toBeCloseTo(2 / 3, 6);
    expect(s.entity.precision).toBeCloseTo(1, 6);
  });

  it("drops entity precision on a hallucinated entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
        { canonical: "Dragon", type: "creature", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.precision).toBeCloseTo(3 / 4, 6);
    expect(s.entity.recall).toBeCloseTo(1, 6);
  });

  it("drops type accuracy on a mistyped match", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "place", aliases: [] }, // wrong type
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.f1).toBeCloseTo(1, 6);
    expect(s.entity.typeAccuracy).toBeCloseTo(2 / 3, 6);
  });

  it("drops dedup score on a near-duplicate entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "the healer Lona", type: "creature", aliases: [] }, // dup of Lona via alias
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    // 1 near-dup over 3 matched golden → 1 - 1/3
    expect(s.dedup.score).toBeCloseTo(1 - 1 / 3, 6);
  });

  it("reports temporal correctness for invalidated relations", async () => {
    const goldenT: GoldenSet = {
      entities: [
        { canonical: "Veil", type: "creature" },
        { canonical: "Ashfen", type: "place" },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
      ],
    };
    const actualGood: ActualState = {
      entities: [
        { canonical: "Veil", type: "creature", aliases: [] },
        { canonical: "Ashfen", type: "place", aliases: [] },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
      ],
    };
    const actualBad: ActualState = {
      entities: actualGood.entities,
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: false },
      ],
    };
    expect((await scoreExtraction(actualGood, goldenT, embedder)).temporal).toEqual({ correct: 1, total: 1 });
    expect((await scoreExtraction(actualBad, goldenT, embedder)).temporal).toEqual({ correct: 0, total: 1 });
  });

  it("drops relation recall on a missed golden relation", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [
        { from: "Lona", to: "Caldren", label: "LOCATED_IN", invalidated: false },
        // missing Lona→Thornwood
      ],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.relation.recall).toBeCloseTo(1 / 2, 6);
    expect(s.relation.precision).toBeCloseTo(1, 6);
  });

  it("drops relation precision on a hallucinated relation", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [
        { from: "Lona", to: "Caldren", label: "LOCATED_IN", invalidated: false },
        { from: "Lona", to: "Thornwood", label: "MEMBER_OF", invalidated: false },
        // hallucinated relation between two matched entities, absent from golden
        { from: "Caldren", to: "Thornwood", label: "LOCATED_IN", invalidated: false },
      ],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.relation.precision).toBeCloseTo(2 / 3, 6);
    expect(s.relation.recall).toBeCloseTo(1, 6);
  });

  it("counts only invalidated golden relations in temporal.total", async () => {
    const goldenMix: GoldenSet = {
      entities: [
        { canonical: "Veil", type: "creature" },
        { canonical: "Ashfen", type: "place" },
        { canonical: "Caldren", type: "place" },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
        { from: "Veil", to: "Caldren", label: "LOCATED_IN" }, // not invalidated
      ],
    };
    const actual: ActualState = {
      entities: [
        { canonical: "Veil", type: "creature", aliases: [] },
        { canonical: "Ashfen", type: "place", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
        { from: "Veil", to: "Caldren", label: "LOCATED_IN", invalidated: false },
      ],
    };
    const s = await scoreExtraction(actual, goldenMix, embedder);
    expect(s.temporal).toEqual({ correct: 1, total: 1 });
  });
});
