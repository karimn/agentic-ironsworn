import { describe, it, expect } from "bun:test";
import {
  matchEntities,
  cosine,
  canonLabel,
  type ActualEntity,
  type GoldenEntity,
  type Embedder,
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
});
