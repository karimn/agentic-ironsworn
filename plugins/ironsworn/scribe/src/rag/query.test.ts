import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { searchRules, lookupMove } from "./query.js";

const DB_EXISTS = existsSync(
  new URL("../../../data/ironsworn.duckdb", import.meta.url)
    .pathname,
);

describe("searchRules", () => {
  it("returns results for a rules query", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    const results = await searchRules("face danger move", { k: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text.length).toBeGreaterThan(0);
  });
});

describe("lookupMove", () => {
  it("finds Face Danger by name", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    const result = await lookupMove("Face Danger");
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("move");
  });

  it("returns null for unknown move", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    const result = await lookupMove("zzz-nonexistent-move-zzz");
    expect(result).toBeNull();
  });
});
