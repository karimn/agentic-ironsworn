import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("moves.ts — SCRIBE_PLUGIN_ROOT resolution", () => {
  let tmpRoot: string;
  const originalEnv = process.env.SCRIBE_PLUGIN_ROOT;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scribe-plugin-root-"));
    mkdirSync(join(tmpRoot, "data", "ironsworn"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "data", "ironsworn", "moves.yaml"),
      "- name: Test Move\n  trigger: test\n  stat_options: [edge]\n  stat_hint: ''\n  roll_type: action\n  outcomes:\n    strong_hit: s\n    weak_hit: w\n    miss: m\n",
    );
    process.env.SCRIBE_PLUGIN_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads moves from SCRIBE_PLUGIN_ROOT/data/ironsworn/moves.yaml when env var is set", async () => {
    // Dynamic import AFTER env var is set so the module-level path resolution picks it up.
    // Using a query param defeats Bun's module cache so each test gets a fresh load.
    const mod = await import("./moves.ts?t=" + Date.now());
    const moves = mod.getMoves();
    expect(Array.isArray(moves)).toBe(true);
    const move = moves.find((m) => m.name === "Test Move");
    expect(move).toBeDefined();
    expect(move?.name).toBe("Test Move");
  });
});
