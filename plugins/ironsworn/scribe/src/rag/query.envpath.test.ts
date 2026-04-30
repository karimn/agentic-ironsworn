import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveDbPath } from "./query.ts";

describe("query.ts — resolveDbPath", () => {
  const originalPluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  const originalDbPath = process.env.DB_PATH;

  beforeEach(() => {
    delete process.env.SCRIBE_PLUGIN_ROOT;
    delete process.env.DB_PATH;
  });

  afterEach(() => {
    if (originalPluginRoot === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalPluginRoot;
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
  });

  it("prefers DB_PATH when set", () => {
    process.env.DB_PATH = "/explicit/path.duckdb";
    expect(resolveDbPath()).toBe("/explicit/path.duckdb");
  });

  it("uses SCRIBE_PLUGIN_ROOT when DB_PATH is not set", () => {
    process.env.SCRIBE_PLUGIN_ROOT = "/my/plugin";
    expect(resolveDbPath()).toBe("/my/plugin/data/ironsworn.duckdb");
  });

  it("falls back to plugin-relative walk when neither env var is set", () => {
    const result = resolveDbPath();
    // Should resolve to .../plugins/ironsworn/data/ironsworn.duckdb
    expect(result).toMatch(/plugins\/ironsworn\/data\/ironsworn\.duckdb$/);
  });
});
