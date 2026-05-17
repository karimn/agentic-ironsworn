import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rollOracle, rollYesNo, getOracleTables } from "./oracles.js";

const ORACLES_YAML_EXISTS = existsSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "data", "oracles.yaml"),
);

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

  it("returns a valid result for the Action table", () => {
    if (!ORACLES_YAML_EXISTS) return;
    const result = rollOracle("Action");
    expect(result.tableName).toBe("Action");
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(100);
    expect(typeof result.outcome).toBe("string");
    expect(result.outcome.length).toBeGreaterThan(0);
  });

  it("roll is always within the valid range for the table dice", () => {
    if (!ORACLES_YAML_EXISTS) return;
    // Action uses d100; run many times to confirm bounds
    for (let i = 0; i < 100; i++) {
      const r = rollOracle("Action");
      expect(r.roll).toBeGreaterThanOrEqual(1);
      expect(r.roll).toBeLessThanOrEqual(100);
    }
  });

  it("resolves a table by alias", () => {
    if (!ORACLES_YAML_EXISTS) return;
    // "Table A" has alias "Ironlander Name"
    const result = rollOracle("Ironlander Name");
    expect(result.tableName).toBe("Table A");
    expect(typeof result.outcome).toBe("string");
    expect(result.outcome.length).toBeGreaterThan(0);
  });

  it("alias lookup is case-insensitive", () => {
    if (!ORACLES_YAML_EXISTS) return;
    const result = rollOracle("ironlander name");
    expect(result.tableName).toBe("Table A");
  });

  it("table name lookup is case-insensitive", () => {
    if (!ORACLES_YAML_EXISTS) return;
    const result = rollOracle("action");
    expect(result.tableName).toBe("Action");
  });

  it("outcome covers the full roll range — no gaps in Action table entries", () => {
    if (!ORACLES_YAML_EXISTS) return;
    // Run 500 times; if any gap existed an error would be thrown.
    for (let i = 0; i < 500; i++) {
      expect(() => rollOracle("Action")).not.toThrow();
    }
  });
});

describe("getOracleTables", () => {
  it("returns a non-empty array when oracles.yaml exists", () => {
    if (!ORACLES_YAML_EXISTS) return;
    const tables = getOracleTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("each table has name, dice, and rolls fields", () => {
    if (!ORACLES_YAML_EXISTS) return;
    for (const table of getOracleTables()) {
      expect(typeof table.name).toBe("string");
      expect(["d6", "d10", "d100", "1d100", "1d10", "1d6"]).toContain(table.dice);
      expect(Array.isArray(table.rolls)).toBe(true);
      expect(table.rolls.length).toBeGreaterThan(0);
    }
  });

  it("known tables are present (Action, Theme, Pay the Price)", () => {
    if (!ORACLES_YAML_EXISTS) return;
    const names = getOracleTables().map((t) => t.name);
    expect(names).toContain("Action");
    expect(names).toContain("Theme");
    expect(names).toContain("Pay the Price");
  });
});
