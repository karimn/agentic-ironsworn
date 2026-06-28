import { describe, it, expect } from "bun:test";
import { backfillGuard } from "./backfill.js";

// The backfill guard models the v1 reframe: point-of-entry recording is the
// primary path, extraction is backfill. We seed the graph with recorded canon,
// run extraction on top, and the guard asks: did backfill FRAGMENT a recorded
// entity (split it into a name variant) or pollute the graph with spurious
// nodes? `fragmentedSeeds` is the regression signal — it should be empty when
// backfill correctly dedups against recorded canon.

describe("backfillGuard", () => {
  it("counts seeded, final, and net-new entities", () => {
    const seed = ["Caldren", "Lago Rhian"];
    const final = [
      { canonical: "Caldren", type: "place", aliases: [] },
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "The Deep Bog", type: "place", aliases: [] },
    ];
    const report = backfillGuard(seed, final, []);
    expect(report.seeded).toBe(2);
    expect(report.finalEntities).toBe(3);
    expect(report.netNewEntities).toBe(1);
  });

  it("flags a cluster that splits a seeded entity as a fragmented seed", () => {
    const seed = ["Lago Rhian", "Caldren"];
    const final = [
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "Lago", type: "person", aliases: [] }, // backfill fragment
      { canonical: "Caldren", type: "place", aliases: [] },
    ];
    const clusters = [{ type: "person", names: ["Lago Rhian", "Lago"] }];
    const report = backfillGuard(seed, final, clusters);
    expect(report.fragmentedSeeds).toEqual([
      { type: "person", names: ["Lago Rhian", "Lago"] },
    ]);
  });

  it("does not flag a clean backfill (no clusters)", () => {
    const seed = ["Caldren"];
    const final = [
      { canonical: "Caldren", type: "place", aliases: [] },
      { canonical: "The Deep Bog", type: "place", aliases: [] },
    ];
    const report = backfillGuard(seed, final, []);
    expect(report.fragmentedSeeds).toEqual([]);
    expect(report.netNewEntities).toBe(1);
  });

  it("does not count a cluster among only non-seeded entities as a fragmented seed", () => {
    const seed = ["Caldren"];
    const final = [
      { canonical: "Caldren", type: "place", aliases: [] },
      { canonical: "The Bog", type: "place", aliases: [] },
      { canonical: "The Deep Bog", type: "place", aliases: [] },
    ];
    // Both bog nodes are new (not seeded) — backfill-internal noise, not
    // corruption of recorded canon. Reported in clusters, not fragmentedSeeds.
    const clusters = [{ type: "place", names: ["The Bog", "The Deep Bog"] }];
    const report = backfillGuard(seed, final, clusters);
    expect(report.clusters).toEqual(clusters);
    expect(report.fragmentedSeeds).toEqual([]);
  });

  it("does not flag a cluster among only seeded entities (golden baseline, not backfill's fault)", () => {
    // Both "Lago" and "Lago Rhian" are seeded golden canon — the fragmentation
    // detector flags them as a same-type subset cluster, but backfill did not
    // introduce it. Only clusters mixing a seed with a NEW node are corruption.
    const seed = ["Lago", "Lago Rhian", "Caldren"];
    const final = [
      { canonical: "Lago", type: "person", aliases: [] },
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "Caldren", type: "place", aliases: [] },
    ];
    const clusters = [{ type: "person", names: ["Lago", "Lago Rhian"] }];
    const report = backfillGuard(seed, final, clusters);
    expect(report.fragmentedSeeds).toEqual([]);
  });

  it("matches seed names case-insensitively", () => {
    const seed = ["lago rhian"];
    const final = [
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "Lago", type: "person", aliases: [] },
    ];
    const clusters = [{ type: "person", names: ["Lago Rhian", "Lago"] }];
    const report = backfillGuard(seed, final, clusters);
    expect(report.fragmentedSeeds).toEqual([
      { type: "person", names: ["Lago Rhian", "Lago"] },
    ]);
  });
});
