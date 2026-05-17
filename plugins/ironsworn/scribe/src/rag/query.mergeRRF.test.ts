import { describe, it, expect } from "bun:test";
import { mergeRRF, type ScoredRow } from "./query.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(id: string, overrides: Partial<ScoredRow> = {}): ScoredRow {
  return {
    id,
    text: `text for ${id}`,
    headingPath: [],
    contentType: "rule",
    moveTrigger: "",
    page: "1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mergeRRF — Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

describe("mergeRRF", () => {
  it("returns an empty array when both input lists are empty", () => {
    expect(mergeRRF([], [], 5)).toEqual([]);
  });

  it("limits results to k", () => {
    const rows = ["a", "b", "c", "d", "e"].map(row);
    const result = mergeRRF(rows, [], 3);
    expect(result).toHaveLength(3);
  });

  it("returns all results when total unique rows < k", () => {
    const result = mergeRRF([row("a"), row("b")], [], 10);
    expect(result).toHaveLength(2);
  });

  it("deduplicates rows that appear in both lists", () => {
    const a = row("shared");
    const result = mergeRRF([a], [a], 10);
    // "shared" should appear only once
    const ids = result.map((r) => r.id);
    expect(ids.filter((id) => id === "shared")).toHaveLength(1);
  });

  it("a row appearing in both lists has a higher score than one appearing in only one", () => {
    // "both" is at rank 0 in vector and rank 0 in bm25 → highest combined RRF score.
    // "vector-only" is at rank 1 in vector only → lower score.
    const vectorRows = [row("both"), row("vector-only")];
    const bm25Rows = [row("both"), row("bm25-only")];
    const result = mergeRRF(vectorRows, bm25Rows, 10);

    const bothResult = result.find((r) => r.id === "both");
    const vectorOnly = result.find((r) => r.id === "vector-only");
    const bm25Only = result.find((r) => r.id === "bm25-only");

    expect(bothResult).toBeDefined();
    expect(vectorOnly).toBeDefined();
    expect(bm25Only).toBeDefined();
    expect(bothResult!.score).toBeGreaterThan(vectorOnly!.score);
    expect(bothResult!.score).toBeGreaterThan(bm25Only!.score);
  });

  it("results are sorted by descending score", () => {
    // Rank 0 in vector wins over rank 1, wins over rank 2, etc.
    const vectorRows = ["a", "b", "c", "d"].map(row);
    const result = mergeRRF(vectorRows, [], 4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it("all returned rows carry a positive score", () => {
    const vectorRows = ["x", "y"].map(row);
    const bm25Rows = ["y", "z"].map(row);
    const result = mergeRRF(vectorRows, bm25Rows, 10);
    for (const r of result) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("preserves row metadata from the first-seen occurrence", () => {
    const vectorRow = row("doc", { text: "from-vector", page: "42" });
    const bm25Row = row("doc", { text: "from-bm25", page: "99" });
    const result = mergeRRF([vectorRow], [bm25Row], 10);
    const found = result.find((r) => r.id === "doc");
    // Vector appears first, so its metadata wins
    expect(found!.text).toBe("from-vector");
    expect(found!.page).toBe("42");
  });

  it("handles a large number of rows without error", () => {
    const N = 200;
    const vectorRows = Array.from({ length: N }, (_, i) => row(`v${i}`));
    const bm25Rows = Array.from({ length: N }, (_, i) => row(`b${i}`));
    const result = mergeRRF(vectorRows, bm25Rows, 10);
    expect(result).toHaveLength(10);
  });

  it("uses RRF_K=60 — rank 0 score is 1/(60+1)", () => {
    const result = mergeRRF([row("only")], [], 1);
    // rank 0 in vector, absent in bm25 → score = 1 / (60 + 0 + 1) = 1/61
    expect(result[0]!.score).toBeCloseTo(1 / 61, 6);
  });

  it("two results at the same rank from different lists share equal scores", () => {
    // "a" rank 0 in vector, "b" rank 0 in bm25 → both get 1/61
    const result = mergeRRF([row("a")], [row("b")], 2);
    expect(result[0]!.score).toBeCloseTo(result[1]!.score, 10);
  });
});
