import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { searchRules, lookupMove } from "./query.js";

const DB_EXISTS = existsSync(
  new URL("../../../data/ironsworn.duckdb", import.meta.url)
    .pathname,
);

let _ftsAvailable: boolean | null = null;
async function ftsAvailable(): Promise<boolean> {
  if (_ftsAvailable !== null) return _ftsAvailable;
  // Use LOAD only (no INSTALL) so this check never triggers a network download
  // and returns quickly regardless of CDN reachability. fts tests run only when
  // the extension is already in the local DuckDB extension cache.
  try {
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    await conn.run("LOAD fts;");
    conn.closeSync();
    _ftsAvailable = true;
  } catch {
    _ftsAvailable = false;
  }
  return _ftsAvailable;
}

let _nomicReady: boolean | null = null;
async function nomicAvailable(): Promise<boolean> {
  if (_nomicReady !== null) return _nomicReady;
  try {
    const apiKey = process.env["NOMIC_API_KEY"] ?? "";
    if (!apiKey) { _nomicReady = false; return false; }
    const res = await fetch("https://api-atlas.nomic.ai/v1/embedding/text", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "nomic-embed-text-v1.5", texts: ["t"] }),
    });
    _nomicReady = res.ok;
  } catch {
    _nomicReady = false;
  }
  return _nomicReady;
}

describe("searchRules", () => {
  it("returns results for a rules query", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    if (!(await nomicAvailable())) return; // skip when Nomic Atlas not available
    if (!(await ftsAvailable())) return; // skip when fts extension unavailable
    const results = await searchRules("face danger move", { k: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.text.length).toBeGreaterThan(0);
  });
});

describe("lookupMove", () => {
  it("finds Face Danger by name", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    if (!(await ftsAvailable())) return; // skip when fts extension unavailable
    const result = await lookupMove("Face Danger");
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("move");
  });

  it("returns null for unknown move", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    if (!(await ftsAvailable())) return; // skip when fts extension unavailable
    const result = await lookupMove("zzz-nonexistent-move-zzz");
    expect(result).toBeNull();
  });

  it("returns the Compel move — not a semantic near-match — when queried by exact name", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    if (!(await ftsAvailable())) return; // skip when fts extension unavailable
    const result = await lookupMove("Compel");
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("move");
    // The returned move must be the Compel move (trigger about persuasion),
    // not Face Desolation (trigger about desolation) which contains "compelling"
    // in its body text and incorrectly wins in a BM25 search for "Compel".
    expect(result?.moveTrigger).toMatch(/persuade/i);
  });
});
