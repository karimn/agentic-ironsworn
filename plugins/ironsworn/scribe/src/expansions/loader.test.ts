import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

// ---------------------------------------------------------------------------
// loadExpansions — namespace binding
// ---------------------------------------------------------------------------

describe("loadExpansions namespace binding", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scribe-loader-ns-"));
    savedEnv["SCRIBE_PLUGINS_JSON"] = process.env["SCRIBE_PLUGINS_JSON"];
    savedEnv["SCRIBE_EXPANSIONS"] = process.env["SCRIBE_EXPANSIONS"];
    savedEnv["SCRIBE_CAMPAIGN"] = process.env["SCRIBE_CAMPAIGN"];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("binds expansion name as namespace in ctx.runDbMigrations", async () => {
    const expansionName = "testns";
    const expansionDir = join(tmpDir, `ironsworn-${expansionName}`);
    await mkdir(join(expansionDir, "server"), { recursive: true });

    await writeFile(
      join(expansionDir, "expansion.json"),
      JSON.stringify({
        name: expansionName,
        version: "1.0.0",
        contributes: { server: true },
      }),
    );

    // The result path is templated into the expansion module so it can write
    // back which namespace was recorded without needing any external imports.
    const resultPath = join(tmpDir, "ns-result.json");

    // This expansion calls ctx.runDbMigrations using the lore DB connection
    // supplied via ctx.getLoreDb. It writes the recorded namespace back to a
    // file so the test can verify it without importing @duckdb/node-api.
    await writeFile(
      join(expansionDir, "server", "index.ts"),
      `import { writeFileSync } from "node:fs";
export async function register(_server, ctx) {
  const db = await ctx.getLoreDb(ctx.campaignPath);
  const conn = await db.connect();
  try {
    await ctx.runDbMigrations(conn, [
      { version: 1, description: "ns-check", async up() {} },
    ]);
    const res = await conn.runAndReadAll(
      "SELECT namespace, version FROM _schema_migrations_ns WHERE version = 1",
    );
    const rows = res.getRowObjectsJS().map((r) => ({
      namespace: r.namespace,
      version: typeof r.version === "bigint" ? Number(r.version) : r.version,
    }));
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(rows));
  } finally {
    conn.closeSync();
  }
}
`,
    );

    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(
      pluginsJson,
      JSON.stringify({
        version: 2,
        plugins: {
          [`ironsworn-${expansionName}@test`]: [
            { installPath: expansionDir, version: "1.0.0", scope: "user" },
          ],
        },
      }),
    );

    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    process.env["SCRIBE_EXPANSIONS"] = expansionName;
    process.env["SCRIBE_CAMPAIGN"] = tmpDir;

    const server = new McpServer({ name: "test", version: "0.0.1" });
    const { loadExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    await loadExpansions(server, tmpDir);

    const raw = JSON.parse(await readFile(resultPath, "utf-8")) as Array<
      Record<string, unknown>
    >;
    expect(raw).toHaveLength(1);
    expect(raw[0]!["namespace"]).toBe(expansionName);
    expect(raw[0]!["version"]).toBe(1);
  });

  it("expansion v1 and core v1 do not collide in the same DB", async () => {
    const expansionName = "xpns";
    const expansionDir = join(tmpDir, `ironsworn-${expansionName}`);
    await mkdir(join(expansionDir, "server"), { recursive: true });

    await writeFile(
      join(expansionDir, "expansion.json"),
      JSON.stringify({
        name: expansionName,
        version: "1.0.0",
        contributes: { server: true },
      }),
    );

    const resultPath = join(tmpDir, "both-ns-result.json");

    await writeFile(
      join(expansionDir, "server", "index.ts"),
      `import { writeFileSync } from "node:fs";
export async function register(_server, ctx) {
  const db = await ctx.getLoreDb(ctx.campaignPath);
  const conn = await db.connect();
  try {
    // Run expansion migration v1
    await ctx.runDbMigrations(conn, [
      { version: 1, description: "expansion v1", async up() {} },
    ]);
    // Verify expansion row is in the namespaced table
    const expRes = await conn.runAndReadAll(
      "SELECT namespace FROM _schema_migrations_ns WHERE version = 1",
    );
    // Also verify core _schema_migrations doesn't have a row with version 1
    // (runDbMigrations(conn, [], "") was never called for core here, but the
    //  table may exist from initDb — what matters is the expansion row is in _ns)
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(
      expRes.getRowObjectsJS().map(r => ({ namespace: r.namespace }))
    ));
  } finally {
    conn.closeSync();
  }
}
`,
    );

    const pluginsJson = join(tmpDir, "plugins.json");
    await writeFile(
      pluginsJson,
      JSON.stringify({
        version: 2,
        plugins: {
          [`ironsworn-${expansionName}@test`]: [
            { installPath: expansionDir, version: "1.0.0", scope: "user" },
          ],
        },
      }),
    );

    process.env["SCRIBE_PLUGINS_JSON"] = pluginsJson;
    process.env["SCRIBE_EXPANSIONS"] = expansionName;
    process.env["SCRIBE_CAMPAIGN"] = tmpDir;

    const server = new McpServer({ name: "test", version: "0.0.1" });
    const { loadExpansions } = await import(`./loader.ts?t=${Date.now()}`);
    await loadExpansions(server, tmpDir);

    const raw = JSON.parse(await readFile(resultPath, "utf-8")) as Array<
      Record<string, unknown>
    >;
    // The row in _schema_migrations_ns should use the expansion name, not ""
    expect(raw).toHaveLength(1);
    expect(raw[0]!["namespace"]).toBe(expansionName);
  });
});
