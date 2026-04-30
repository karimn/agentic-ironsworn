import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("oracles.ts — SCRIBE_PLUGIN_ROOT resolution", () => {
  let tmpRoot: string;
  const originalEnv = process.env.SCRIBE_PLUGIN_ROOT;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scribe-plugin-root-"));
    mkdirSync(join(tmpRoot, "data"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "data", "oracles.yaml"),
      "- name: Test Oracle\n  dice: d10\n  rolls:\n  - min: 1\n    max: 10\n    outcome: anything\n",
    );
    process.env.SCRIBE_PLUGIN_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads oracles from SCRIBE_PLUGIN_ROOT/data/oracles.yaml when env var is set", async () => {
    // Dynamic import AFTER env var is set so the module-level path resolution picks it up.
    // Using a query param defeats Bun's module cache so each test gets a fresh load.
    const mod = await import("./oracles.ts?t=" + Date.now());
    const tables = mod.getOracleTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.find((t: any) => t.name === "Test Oracle")).toBeDefined();
  });
});
