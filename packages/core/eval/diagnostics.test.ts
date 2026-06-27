import { describe, it, expect } from "bun:test";
import {
  classifyRelationDrops,
  aggregateRelationDrops,
  type RelationDropBreakdown,
} from "./diagnostics.js";

const THRESHOLD = 0.6;

describe("classifyRelationDrops", () => {
  it("counts a fully resolvable, confident relation as survived", () => {
    const b = classifyRelationDrops(
      [{ from: "Lona", to: "Caldren", relation: "LOCATED_IN", confidence: 0.9 }],
      ["Lona", "Caldren"],
      THRESHOLD,
    );
    expect(b.emitted).toBe(1);
    expect(b.survived).toBe(1);
    expect(b.droppedLowConfidence).toBe(0);
    expect(b.droppedEndpointUnresolved).toBe(0);
    expect(b.unresolvedEndpoints).toEqual([]);
  });

  it("classifies a sub-threshold relation as droppedLowConfidence", () => {
    const b = classifyRelationDrops(
      [{ from: "Lona", to: "Caldren", relation: "LOCATED_IN", confidence: 0.3 }],
      ["Lona", "Caldren"],
      THRESHOLD,
    );
    expect(b.droppedLowConfidence).toBe(1);
    expect(b.droppedEndpointUnresolved).toBe(0);
    expect(b.survived).toBe(0);
  });

  it("does NOT endpoint-check a low-confidence relation (mirrors production order)", () => {
    // confidence gate short-circuits before endpoint resolution in extraction.ts,
    // so an unresolved endpoint on a dropped-for-confidence relation is not tallied.
    const b = classifyRelationDrops(
      [{ from: "X", to: "Y", relation: "KNOWS", confidence: 0.3 }],
      [],
      THRESHOLD,
    );
    expect(b.droppedLowConfidence).toBe(1);
    expect(b.droppedEndpointUnresolved).toBe(0);
    expect(b.unresolvedEndpoints).toEqual([]);
  });

  it("classifies an unresolved endpoint and records the offending name", () => {
    const b = classifyRelationDrops(
      [{ from: "Oracle", to: "Hidden God", relation: "SERVES", confidence: 0.8 }],
      ["Oracle"],
      THRESHOLD,
    );
    expect(b.survived).toBe(0);
    expect(b.droppedEndpointUnresolved).toBe(1);
    expect(b.unresolvedEndpoints).toEqual([{ name: "Hidden God", count: 1 }]);
  });

  it("resolves endpoints case-insensitively against the persisted name set", () => {
    const b = classifyRelationDrops(
      [{ from: "LONA", to: "caldren", relation: "LOCATED_IN", confidence: 0.9 }],
      ["Lona", "Caldren"],
      THRESHOLD,
    );
    expect(b.survived).toBe(1);
    expect(b.droppedEndpointUnresolved).toBe(0);
  });

  it("counts a relation once when both endpoints fail but tallies both names", () => {
    const b = classifyRelationDrops(
      [{ from: "the market", to: "the road", relation: "NEAR", confidence: 0.8 }],
      ["Caldren"],
      THRESHOLD,
    );
    expect(b.droppedEndpointUnresolved).toBe(1);
    expect(b.unresolvedEndpoints).toEqual([
      { name: "the market", count: 1 },
      { name: "the road", count: 1 },
    ]);
  });

  it("tallies repeated unresolved endpoint names and sorts by count descending", () => {
    const b = classifyRelationDrops(
      [
        { from: "Lona", to: "the market", relation: "AT", confidence: 0.8 },
        { from: "Fen", to: "the market", relation: "AT", confidence: 0.8 },
        { from: "Arda", to: "the market", relation: "AT", confidence: 0.8 },
        { from: "Lona", to: "the road", relation: "ON", confidence: 0.8 },
      ],
      ["Lona", "Fen", "Arda"],
      THRESHOLD,
    );
    expect(b.droppedEndpointUnresolved).toBe(4);
    expect(b.unresolvedEndpoints).toEqual([
      { name: "the market", count: 3 },
      { name: "the road", count: 1 },
    ]);
  });

  it("treats an entity alias as resolvable (alias names are part of the set)", () => {
    // The harness builds the name set from canonical + aliases, so a relation
    // endpoint that used an alias must resolve.
    const b = classifyRelationDrops(
      [{ from: "the healer Lona", to: "Caldren", relation: "LOCATED_IN", confidence: 0.9 }],
      ["Lona", "the healer Lona", "Caldren"],
      THRESHOLD,
    );
    expect(b.survived).toBe(1);
    expect(b.droppedEndpointUnresolved).toBe(0);
  });
});

describe("aggregateRelationDrops", () => {
  it("sums numeric fields across runs", () => {
    const runs: RelationDropBreakdown[] = [
      { emitted: 3, survived: 1, droppedLowConfidence: 1, droppedEndpointUnresolved: 1, unresolvedEndpoints: [{ name: "the market", count: 1 }] },
      { emitted: 2, survived: 2, droppedLowConfidence: 0, droppedEndpointUnresolved: 0, unresolvedEndpoints: [] },
    ];
    const a = aggregateRelationDrops(runs);
    expect(a.emitted).toBe(5);
    expect(a.survived).toBe(3);
    expect(a.droppedLowConfidence).toBe(1);
    expect(a.droppedEndpointUnresolved).toBe(1);
  });

  it("merges and re-sorts unresolved endpoint tallies across runs", () => {
    const runs: RelationDropBreakdown[] = [
      { emitted: 0, survived: 0, droppedLowConfidence: 0, droppedEndpointUnresolved: 0, unresolvedEndpoints: [{ name: "the market", count: 2 }, { name: "the road", count: 1 }] },
      { emitted: 0, survived: 0, droppedLowConfidence: 0, droppedEndpointUnresolved: 0, unresolvedEndpoints: [{ name: "the road", count: 3 }] },
    ];
    const a = aggregateRelationDrops(runs);
    expect(a.unresolvedEndpoints).toEqual([
      { name: "the road", count: 4 },
      { name: "the market", count: 2 },
    ]);
  });

  it("returns an all-zero breakdown for an empty run list", () => {
    const a = aggregateRelationDrops([]);
    expect(a.emitted).toBe(0);
    expect(a.unresolvedEndpoints).toEqual([]);
  });
});
