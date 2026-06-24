import { describe, it, expect } from "bun:test";
import { median, aggregateScorecards } from "./aggregate.js";
import type { Scorecard } from "./score.js";

function card(opts: {
  eP?: number; eR?: number; eF1?: number; eTA?: number;
  rP?: number; rR?: number; rF1?: number; rLA?: number;
  dedup?: number; tCorrect?: number; tTotal?: number;
}): Scorecard {
  return {
    entity: { precision: opts.eP ?? 0, recall: opts.eR ?? 0, f1: opts.eF1 ?? 0, typeAccuracy: opts.eTA ?? 0 },
    relation: { precision: opts.rP ?? 0, recall: opts.rR ?? 0, f1: opts.rF1 ?? 0, labelAccuracy: opts.rLA ?? 0 },
    dedup: { score: opts.dedup ?? 0 },
    temporal: { correct: opts.tCorrect ?? 0, total: opts.tTotal ?? 2 },
  };
}

describe("median", () => {
  it("returns the middle of an odd-length sorted set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middles of an even-length set", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("returns 0 for an empty set", () => {
    expect(median([])).toBe(0);
  });
});

describe("aggregateScorecards", () => {
  it("computes median/min/max per metric and temporal passRate/meanCorrect", () => {
    const cards = [
      card({ dedup: 0.35, eP: 0.6, tCorrect: 0, tTotal: 2 }),
      card({ dedup: 0.61, eP: 0.7, tCorrect: 2, tTotal: 2 }),
      card({ dedup: 0.5, eP: 0.65, tCorrect: 0, tTotal: 2 }),
    ];
    const agg = aggregateScorecards(cards);
    expect(agg.runs).toBe(3);
    expect(agg.dedup.score.median).toBeCloseTo(0.5, 10);
    expect(agg.dedup.score.min).toBeCloseTo(0.35, 10);
    expect(agg.dedup.score.max).toBeCloseTo(0.61, 10);
    expect(agg.entity.precision.median).toBeCloseTo(0.65, 10);
    expect(agg.temporal.total).toBe(2);
    // 1 of 3 runs reached correct===total
    expect(agg.temporal.passRate).toBeCloseTo(1 / 3, 10);
    // meanCorrect = (0 + 2 + 0) / 3
    expect(agg.temporal.meanCorrect).toBeCloseTo(2 / 3, 10);
  });

  it("throws on an empty input", () => {
    expect(() => aggregateScorecards([])).toThrow();
  });
});
