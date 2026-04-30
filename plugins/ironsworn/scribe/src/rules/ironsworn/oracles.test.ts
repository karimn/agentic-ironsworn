import { describe, it, expect } from "bun:test";
import { rollOracle, rollYesNo } from "./oracles.js";

describe("rollYesNo", () => {
  it("returns valid structure", () => {
    const result = rollYesNo("50_50");
    expect(typeof result.yes).toBe("boolean");
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(100);
    expect(typeof result.twist).toBe("boolean");
  });

  it("almost_certain produces yes more than 80% of the time", () => {
    const results = Array.from({ length: 1000 }, () => rollYesNo("almost_certain"));
    const yesCount = results.filter(r => r.yes).length;
    expect(yesCount).toBeGreaterThan(800); // 91% threshold, expect > 80% in 1000 rolls
  });

  it("small_chance produces yes less than 20% of the time", () => {
    const results = Array.from({ length: 1000 }, () => rollYesNo("small_chance"));
    const yesCount = results.filter(r => r.yes).length;
    expect(yesCount).toBeLessThan(200); // 11% threshold, expect < 20% in 1000 rolls
  });

  it("detects twist on doubles", () => {
    // Run enough times to catch a double
    let foundTwist = false;
    for (let i = 0; i < 10_000; i++) {
      const r = rollYesNo("50_50");
      if (r.twist) { foundTwist = true; break; }
    }
    expect(foundTwist).toBe(true);
  });

  it("non-double is not a twist", () => {
    // Run many times; verify twist only fires on doubles
    for (let i = 0; i < 1000; i++) {
      const r = rollYesNo("50_50");
      const tens = Math.floor(r.roll / 10) % 10;
      const units = r.roll % 10;
      const isDouble = tens === units;
      expect(r.twist).toBe(isDouble);
    }
  });
});

describe("rollOracle", () => {
  it("throws for unknown table", () => {
    expect(() => rollOracle("zzz-nonexistent-table")).toThrow(/not found/i);
  });

  // Integration tests — only run if oracles.yaml exists
  // (Can't test rollOracle results without the data file)
});
