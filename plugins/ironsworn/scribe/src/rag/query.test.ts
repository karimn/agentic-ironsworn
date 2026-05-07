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

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/tags`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

describe("searchRules", () => {
  it("returns results for a rules query", async () => {
    if (!DB_EXISTS) return; // skip gracefully
    if (!(await ollamaAvailable())) return; // skip when Ollama not running
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
});
