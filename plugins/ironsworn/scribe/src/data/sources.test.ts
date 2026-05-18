import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
