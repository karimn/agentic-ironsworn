import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const STUB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "stub");

describe("discoverExpansions", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scribe-loader-"));
    savedEnv["SCRIBE_PLUGINS_JSON"] = process.env["SCRIBE_PLUGINS_JSON"];
    savedEnv["SCRIBE_EXPANSIONS"] = process.env["SCRIBE_EXPANSIONS"];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when SCRIBE_EXPANSIONS is unset", async () => {
    delete process.env["SCRIBE_EXPANSIONS"];
    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(pluginsJson, JSON.stringify({ version: 2, plugins: {} }));
    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    const { discoverExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    const result = await discoverExpansions();
    expect(result).toEqual([]);
  });

  it("returns empty when installed_plugins.json is absent", async () => {
    process.env["SCRIBE_EXPANSIONS"] = "stub";
    process.env["SCRIBE_PLUGINS_JSON"] = join(tmpDir, "nonexistent.json");
    const { discoverExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    const result = await discoverExpansions();
    expect(result).toEqual([]);
  });

  it("discovers a valid expansion by installPath", async () => {
    process.env["SCRIBE_EXPANSIONS"] = "stub";
    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(pluginsJson, JSON.stringify({
      version: 2,
      plugins: {
        "ironsworn-stub@test-repo": [{ installPath: STUB_DIR, version: "1.0.0", scope: "user" }],
      },
    }));
    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    const { discoverExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    const result = await discoverExpansions();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("stub");
    expect(result[0].installPath).toBe(STUB_DIR);
  });

  it("skips expansions not in SCRIBE_EXPANSIONS allow-list", async () => {
    process.env["SCRIBE_EXPANSIONS"] = "other";
    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(pluginsJson, JSON.stringify({
      version: 2,
      plugins: {
        "ironsworn-stub@test-repo": [{ installPath: STUB_DIR, version: "1.0.0", scope: "user" }],
      },
    }));
    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    const { discoverExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    const result = await discoverExpansions();
    expect(result).toEqual([]);
  });

  it("skips expansion with no expansion.json", async () => {
    process.env["SCRIBE_EXPANSIONS"] = "missing";
    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(pluginsJson, JSON.stringify({
      version: 2,
      plugins: {
        "ironsworn-missing@test-repo": [{ installPath: join(tmpDir, "no-such-dir"), version: "1.0.0", scope: "user" }],
      },
    }));
    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    const { discoverExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    const result = await discoverExpansions();
    expect(result).toEqual([]);
  });
});
