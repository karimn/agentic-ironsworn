import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STUB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../expansions/stub");

describe("dataSources", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv["SCRIBE_PLUGIN_ROOT"] = process.env["SCRIBE_PLUGIN_ROOT"];
    savedEnv["SCRIBE_EXPANSIONS"] = process.env["SCRIBE_EXPANSIONS"];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns core path when no expansions active", async () => {
    delete process.env["SCRIBE_EXPANSIONS"];
    const { dataSources } = await import(`./sources.ts?t=${Date.now()}`);
    const paths = dataSources("moves");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/moves\.yaml$/);
  });

  it("returns core + expansion paths for active expansions with the dataset", async () => {
    const { dataSourcesFromExpansions } = await import(`./sources.ts?t=${Date.now()}`);
    const fakeExpansion = {
      name: "stub",
      manifest: { name: "stub", version: "1.0.0", contributes: { data: ["moves"] } },
      installPath: STUB_DIR,
    };
    const paths = dataSourcesFromExpansions("moves", [fakeExpansion]);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("stub");
    expect(paths[1]).toMatch(/moves\.yaml$/);
  });
});

describe("expansion override", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scribe-override-"));
    savedEnv["SCRIBE_PLUGIN_ROOT"] = process.env["SCRIBE_PLUGIN_ROOT"];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("expansion move overrides base move with same name", async () => {
    const dirA = join(tmpDir, "core");
    const dirB = join(tmpDir, "expansion");
    await mkdir(join(dirA, "data"), { recursive: true });
    await mkdir(join(dirB, "data"), { recursive: true });

    const baseMoveYaml =
      `- name: Strike\n  trigger: base\n  stat_options: [iron]\n  stat_hint: ''\n  roll_type: action\n  outcomes:\n    strong_hit: base strong\n    weak_hit: base weak\n    miss: base miss\n`;
    const expansionMoveYaml =
      `- name: Strike\n  trigger: expanded\n  stat_options: [iron]\n  stat_hint: ''\n  roll_type: action\n  outcomes:\n    strong_hit: expansion strong\n    weak_hit: expansion weak\n    miss: expansion miss\n`;

    await writeFile(join(dirA, "data", "moves.yaml"), baseMoveYaml);
    await writeFile(join(dirB, "data", "moves.yaml"), expansionMoveYaml);

    process.env["SCRIBE_PLUGIN_ROOT"] = dirA;

    const { parse } = await import("yaml");
    const { readFileSync, existsSync: fsExists } = await import("node:fs");
    const { dataSourcesFromExpansions } = await import(`./sources.ts?t=${Date.now()}`);

    const fakeExpansion = {
      name: "exp-b",
      manifest: { name: "exp-b", version: "1.0.0", contributes: { data: ["moves" as const] } },
      installPath: dirB,
    };
    const paths = dataSourcesFromExpansions("moves", [fakeExpansion]);
    expect(paths).toHaveLength(2);

    // Replicate the override loader semantics (mirrors loadMoves / loadAssets / loadOracles)
    const seen = new Map<string, number>();
    const all: Array<{ name: string; outcomes?: Record<string, string> }> = [];
    for (const filePath of paths) {
      if (!fsExists(filePath)) continue;
      const entries = parse(readFileSync(filePath, "utf-8")) as Array<{
        name: string;
        outcomes?: Record<string, string>;
      }>;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const key = entry.name?.toLowerCase() ?? "";
        if (seen.has(key)) {
          all[seen.get(key)!] = entry; // expansion overrides base
        } else {
          seen.set(key, all.length);
          all.push(entry);
        }
      }
    }

    expect(all).toHaveLength(1); // deduplicated: only one "Strike"
    expect(all[0]?.outcomes?.["strong_hit"]).toBe("expansion strong"); // expansion wins
  });

  it("last expansion wins when multiple expansions define the same name", async () => {
    const dirCore = join(tmpDir, "core");
    const dirExpA = join(tmpDir, "exp-a");
    const dirExpB = join(tmpDir, "exp-b");
    await mkdir(join(dirCore, "data"), { recursive: true });
    await mkdir(join(dirExpA, "data"), { recursive: true });
    await mkdir(join(dirExpB, "data"), { recursive: true });

    const makeYaml = (label: string) =>
      `- name: Oracle\n  dice: d100\n  rolls: []\n  _label: ${label}\n`;

    await writeFile(join(dirCore, "data", "moves.yaml"), ""); // empty core
    await writeFile(join(dirExpA, "data", "moves.yaml"), makeYaml("from-exp-a"));
    await writeFile(join(dirExpB, "data", "moves.yaml"), makeYaml("from-exp-b"));

    process.env["SCRIBE_PLUGIN_ROOT"] = dirCore;

    const { parse } = await import("yaml");
    const { readFileSync, existsSync: fsExists } = await import("node:fs");
    const { dataSourcesFromExpansions } = await import(`./sources.ts?t=${Date.now()}`);

    const expansions = [
      { name: "exp-a", manifest: { name: "exp-a", version: "1.0.0", contributes: { data: ["moves" as const] } }, installPath: dirExpA },
      { name: "exp-b", manifest: { name: "exp-b", version: "1.0.0", contributes: { data: ["moves" as const] } }, installPath: dirExpB },
    ];
    const paths = dataSourcesFromExpansions("moves", expansions);
    expect(paths).toHaveLength(3);

    const seen = new Map<string, number>();
    const all: Array<{ name: string; _label?: string }> = [];
    for (const filePath of paths) {
      if (!fsExists(filePath)) continue;
      const raw = readFileSync(filePath, "utf-8");
      if (!raw.trim()) continue;
      const entries = parse(raw) as Array<{ name: string; _label?: string }>;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const key = entry.name?.toLowerCase() ?? "";
        if (seen.has(key)) {
          all[seen.get(key)!] = entry;
        } else {
          seen.set(key, all.length);
          all.push(entry);
        }
      }
    }

    expect(all).toHaveLength(1);
    expect(all[0]?.["_label"]).toBe("from-exp-b"); // last expansion wins
  });
});
