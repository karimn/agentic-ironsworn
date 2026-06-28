import { describe, it, expect } from "bun:test";
import { fragmentationClusters, relationCoverage } from "./graph-health.js";

describe("fragmentationClusters", () => {
  it("groups same-type entities whose names are in a subset relation", () => {
    const clusters = fragmentationClusters([
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "Lago", type: "person", aliases: [] },
      { canonical: "Ashfen Settlement", type: "place", aliases: [] },
      { canonical: "Ashfen", type: "place", aliases: [] },
      { canonical: "Caldren", type: "person", aliases: [] },
    ]);
    const flat = clusters.map((c) => c.names.sort());
    expect(flat).toContainEqual(["Lago", "Lago Rhian"]);
    expect(flat).toContainEqual(["Ashfen", "Ashfen Settlement"]);
    expect(flat.flat()).not.toContain("Caldren"); // stands alone
  });

  it("does not cluster distinct same-pattern names (neither is a subset)", () => {
    const clusters = fragmentationClusters([
      { canonical: "Ashfen Harvest Vow", type: "thread", aliases: [] },
      { canonical: "Greyhollow Harvest Vow", type: "thread", aliases: [] },
    ]);
    expect(clusters.length).toBe(0); // each has a unique discriminator token
  });

  it("does not cluster a subset-named entity of a different type", () => {
    // "Caldren" (person) must not merge with "Caldren's Wardenship" (thread).
    const clusters = fragmentationClusters([
      { canonical: "Caldren", type: "person", aliases: [] },
      { canonical: "Caldren Wardenship", type: "thread", aliases: [] },
    ]);
    expect(clusters.length).toBe(0);
  });
});

describe("relationCoverage", () => {
  it("reports the fraction of entities with at least one relation", () => {
    const cov = relationCoverage(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [{ from_id: "a", to_id: "b" }],
    );
    expect(cov.total).toBe(4);
    expect(cov.withRelation).toBe(2); // a and b
    expect(cov.ratio).toBeCloseTo(0.5);
  });
});
