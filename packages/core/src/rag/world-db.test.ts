import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getWorldDb, peekWorldDb, openWorldWriteConn } from "./world-db.js";
import {
  resolveWorldContext,
  loadWorldJson,
  writeWorldJson,
  assertEmbeddingPin,
  ensureWorldJson,
  DEFAULT_EMBEDDING_PIN,
  CURRENT_WORLD_SCHEMA_VERSION,
} from "../world.js";
import type { WorldContext } from "../world.js";

// ---------------------------------------------------------------------------
// assertEmbeddingPin — pure logic, no I/O, no DuckDB
// ---------------------------------------------------------------------------

describe("assertEmbeddingPin", () => {
  it("does not throw when pin exactly matches the active (default) pin", () => {
    expect(() => assertEmbeddingPin(DEFAULT_EMBEDDING_PIN)).not.toThrow();
  });

  it("does not throw when explicit active pin matches explicit pin", () => {
    const pin = { model: "foo", version: "2", dim: 512 };
    expect(() => assertEmbeddingPin(pin, pin)).not.toThrow();
  });

  it("throws when the model differs", () => {
    const mismatched = { ...DEFAULT_EMBEDDING_PIN, model: "other-model" };
    expect(() => assertEmbeddingPin(mismatched)).toThrow(/mismatch/i);
  });

  it("throws when the version differs", () => {
    const mismatched = { ...DEFAULT_EMBEDDING_PIN, version: "9.9" };
    expect(() => assertEmbeddingPin(mismatched)).toThrow(/mismatch/i);
  });

  it("throws when the dim differs", () => {
    const mismatched = { ...DEFAULT_EMBEDDING_PIN, dim: 512 };
    expect(() => assertEmbeddingPin(mismatched)).toThrow(/mismatch/i);
  });

  it("error message names both the pinned and the active descriptors", () => {
    const pin = { model: "old-model", version: "1.0", dim: 512 };
    const active = { model: "new-model", version: "2.0", dim: 768 };
    let msg = "";
    try {
      assertEmbeddingPin(pin, active);
    } catch (e: unknown) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("old-model");
    expect(msg).toContain("1.0");
    expect(msg).toContain("512");
    expect(msg).toContain("new-model");
    expect(msg).toContain("2.0");
    expect(msg).toContain("768");
  });

  it("error message suggests restoring the original model or running a re-embed migration", () => {
    const pin = { model: "stale", version: "0", dim: 384 };
    let msg = "";
    try {
      assertEmbeddingPin(pin);
    } catch (e: unknown) {
      msg = (e as Error).message;
    }
    // Must mention at least one actionable path
    expect(msg.toLowerCase()).toMatch(/restore|re-embed|migration/);
  });
});

// ---------------------------------------------------------------------------
// ensureWorldJson — file-based, no DuckDB
// ---------------------------------------------------------------------------

describe("ensureWorldJson", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "world-json-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates world.json with the default pin when absent", async () => {
    const wj = await ensureWorldJson(tmpDir, "Test World");
    expect(wj.schemaVersion).toBe(CURRENT_WORLD_SCHEMA_VERSION);
    expect(wj.name).toBe("Test World");
    expect(wj.embedding).toEqual(DEFAULT_EMBEDDING_PIN);
  });

  it("writes a file that loadWorldJson can round-trip", async () => {
    await ensureWorldJson(tmpDir, "Round-trip World");
    const loaded = await loadWorldJson(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Round-trip World");
    expect(loaded!.embedding).toEqual(DEFAULT_EMBEDDING_PIN);
  });

  it("is idempotent — returns existing file unchanged", async () => {
    const first = await ensureWorldJson(tmpDir, "First");
    const second = await ensureWorldJson(tmpDir, "Different Name");
    // Should keep original name and pin, not overwrite
    expect(second.name).toBe("First");
    expect(second).toEqual(first);
  });

  it("writeWorldJson then loadWorldJson round-trips correctly", async () => {
    const data = {
      schemaVersion: 1,
      embedding: DEFAULT_EMBEDDING_PIN,
      name: "My World",
    };
    await writeWorldJson(tmpDir, data);
    const loaded = await loadWorldJson(tmpDir);
    expect(loaded).toEqual(data);
  });

  it("loadWorldJson returns null when file is absent", async () => {
    const result = await loadWorldJson(join(tmpDir, "nonexistent"));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWorldContext — walk-up logic, file-based, no DuckDB
// ---------------------------------------------------------------------------

describe("resolveWorldContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "world-ctx-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("walk-up: finds worldRoot containing world.json above campaigns/<id>", async () => {
    // Layout: <tmpDir>/world.json, <tmpDir>/campaigns/foo/campaign.json {id:"foo"}
    await writeWorldJson(tmpDir, {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      embedding: DEFAULT_EMBEDDING_PIN,
      name: "Walk-up World",
    });
    const campaignPath = join(tmpDir, "campaigns", "foo");
    await mkdir(campaignPath, { recursive: true });
    await writeFile(
      join(campaignPath, "campaign.json"),
      JSON.stringify({ id: "foo", name: "Foo Campaign" }),
      "utf8",
    );

    const ctx = await resolveWorldContext(campaignPath);

    expect(ctx.worldRoot).toBe(tmpDir);
    expect(ctx.campaignId).toBe("foo");
    expect(ctx.campaignPath).toBe(campaignPath);
    expect(ctx.worldDbPath).toBe(join(tmpDir, "world.duckdb"));
  });

  it("walk-up: also recognises worldRoot via world.duckdb (no world.json)", async () => {
    // Create a dummy world.duckdb file so the walk-up stops here
    await writeFile(join(tmpDir, "world.duckdb"), "", "utf8");
    const campaignPath = join(tmpDir, "campaigns", "bar");
    await mkdir(campaignPath, { recursive: true });

    const ctx = await resolveWorldContext(campaignPath);

    expect(ctx.worldRoot).toBe(tmpDir);
    expect(ctx.campaignId).toBe("bar"); // basename fallback (no campaign.json)
  });

  it("fallback: uses dirname(dirname(campaignPath)) for .../campaigns/<id> layout when no world.json exists", async () => {
    // No world.json anywhere — should fall back to grandparent
    const worldRoot = join(tmpDir, "myworld");
    const campaignPath = join(worldRoot, "campaigns", "hero");
    await mkdir(campaignPath, { recursive: true });

    const ctx = await resolveWorldContext(campaignPath);

    expect(ctx.worldRoot).toBe(worldRoot);
    expect(ctx.campaignId).toBe("hero"); // basename
  });

  it("fallback: uses campaignPath itself when layout doesn't match campaigns/<id>", async () => {
    // Campaign folder directly in tmpDir — no "campaigns" parent
    const campaignPath = join(tmpDir, "standalone");
    await mkdir(campaignPath, { recursive: true });

    const ctx = await resolveWorldContext(campaignPath);

    // worldRoot is campaignPath itself (single-campaign legacy/dev case)
    expect(ctx.worldRoot).toBe(campaignPath);
    expect(ctx.campaignId).toBe("standalone");
  });

  it("reads campaignId from campaign.json { id } when present", async () => {
    await writeWorldJson(tmpDir, {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      embedding: DEFAULT_EMBEDDING_PIN,
      name: "ID World",
    });
    const campaignPath = join(tmpDir, "campaigns", "folder-name");
    await mkdir(campaignPath, { recursive: true });
    await writeFile(
      join(campaignPath, "campaign.json"),
      JSON.stringify({ id: "custom-id", name: "Custom" }),
      "utf8",
    );

    const ctx = await resolveWorldContext(campaignPath);

    expect(ctx.campaignId).toBe("custom-id");
  });

  it("falls back to basename(campaignPath) when campaign.json is absent", async () => {
    await writeWorldJson(tmpDir, {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      embedding: DEFAULT_EMBEDDING_PIN,
      name: "Basename World",
    });
    const campaignPath = join(tmpDir, "campaigns", "basename-id");
    await mkdir(campaignPath, { recursive: true });
    // No campaign.json written

    const ctx = await resolveWorldContext(campaignPath);

    expect(ctx.campaignId).toBe("basename-id");
  });
});

// ---------------------------------------------------------------------------
// getWorldDb / peekWorldDb / openWorldWriteConn — DuckDB required
//
// Each test gets its own dir to avoid the module-level cache interfering.
// We do NOT call the real Ollama embedder; world-db.ts only calls
// ensureWorldJson (no embedding) during initDb.
// ---------------------------------------------------------------------------

describe("getWorldDb", () => {
  let dirs: string[] = [];

  async function freshCtx(): Promise<WorldContext> {
    const dir = await mkdtemp(join(tmpdir(), "world-db-test-"));
    dirs.push(dir);
    // Create the world.json first so assertEmbeddingPin passes
    await ensureWorldJson(dir, "Test World");
    const campaignPath = join(dir, "campaigns", "test");
    await mkdir(campaignPath, { recursive: true });
    return {
      worldRoot: dir,
      campaignId: "test",
      campaignPath,
      worldDbPath: join(dir, "world.duckdb"),
    };
  }

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs = [];
  });

  it("opens a fresh world.duckdb and returns a usable DuckDBInstance", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    expect(inst).toBeDefined();
    const conn = await inst.connect();
    await expect(conn.runAndReadAll("SELECT 1 AS n")).resolves.toBeDefined();
    conn.closeSync();
  });

  it("all target tables exist after initDb", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const result = await conn.runAndReadAll(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name",
      );
      const rows = result.getRowObjectsJS() as Record<string, unknown>[];
      const tables = new Set(rows.map((r) => String(r["table_name"])));

      const expected = [
        "entities",
        "lore_communities",
        "lore_extraction_log",
        "lore_provenance",
        "lore_proximity_edges",
        "relations",
        "scene_beats",
        "scene_entity_refs",
        "scenes",
      ];
      for (const t of expected) {
        expect(tables.has(t)).toBe(true);
      }
    } finally {
      conn.closeSync();
    }
  });

  it("entities table has the expected columns", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const result = await conn.runAndReadAll(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'entities' ORDER BY column_name",
      );
      const rows = result.getRowObjectsJS() as Record<string, unknown>[];
      const cols = new Set(rows.map((r) => String(r["column_name"])));
      for (const c of ["id", "slug", "canonical", "aliases", "type", "summary", "content", "metadata", "embedding", "campaign_id", "created_in_campaign", "created_at", "updated_at"]) {
        expect(cols.has(c)).toBe(true);
      }
    } finally {
      conn.closeSync();
    }
  });

  it("scenes table has campaign_id and place_entity columns", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const result = await conn.runAndReadAll(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'scenes' ORDER BY column_name",
      );
      const rows = result.getRowObjectsJS() as Record<string, unknown>[];
      const cols = new Set(rows.map((r) => String(r["column_name"])));
      expect(cols.has("campaign_id")).toBe(true);
      expect(cols.has("place_entity")).toBe(true);
    } finally {
      conn.closeSync();
    }
  });

  it("lore_communities table has campaign_id column", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const result = await conn.runAndReadAll(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'lore_communities' ORDER BY column_name",
      );
      const rows = result.getRowObjectsJS() as Record<string, unknown>[];
      const cols = new Set(rows.map((r) => String(r["column_name"])));
      expect(cols.has("campaign_id")).toBe(true);
    } finally {
      conn.closeSync();
    }
  });

  it("caches the instance — repeated calls with same worldDbPath return the same promise", async () => {
    const ctx = await freshCtx();
    const p1 = getWorldDb(ctx);
    const p2 = getWorldDb(ctx);
    expect(p1).toBe(p2);
    await p1; // ensure it resolves
  });

  it("peekWorldDb returns undefined before the DB is opened", async () => {
    const neverOpenedPath = join(tmpdir(), "never-opened-" + Date.now() + ".duckdb");
    expect(peekWorldDb(neverOpenedPath)).toBeUndefined();
  });

  it("peekWorldDb returns the cached promise after getWorldDb has been called", async () => {
    const ctx = await freshCtx();
    const p = getWorldDb(ctx);
    expect(peekWorldDb(ctx.worldDbPath)).toBe(p);
    await p;
  });

  it("openWorldWriteConn opens a usable write connection", async () => {
    const ctx = await freshCtx();
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    expect(conn).toBeDefined();
    await expect(conn.runAndReadAll("SELECT 42 AS n")).resolves.toBeDefined();
    conn.closeSync();
  });

  it("refuses to open when world.json has a mismatched embedding model", async () => {
    const ctx = await freshCtx();
    // Overwrite world.json with a mismatched pin
    await writeWorldJson(ctx.worldRoot, {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      embedding: { model: "wrong-model", version: "0.0", dim: 384 },
      name: "Bad Pin World",
    });
    // Use a fresh path to avoid cache hit from a prior test
    const mismatchedCtx: WorldContext = {
      ...ctx,
      worldDbPath: join(ctx.worldRoot, "world-mismatch.duckdb"),
    };
    await expect(getWorldDb(mismatchedCtx)).rejects.toThrow(/mismatch/i);
  });

  it("mismatch error message names the pinned model and the active model", async () => {
    const ctx = await freshCtx();
    await writeWorldJson(ctx.worldRoot, {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      embedding: { model: "pinned-model", version: "1.0", dim: 512 },
      name: "Mismatch World",
    });
    const mismatchedCtx: WorldContext = {
      ...ctx,
      worldDbPath: join(ctx.worldRoot, "world-err.duckdb"),
    };
    let msg = "";
    try {
      await getWorldDb(mismatchedCtx);
    } catch (e: unknown) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("pinned-model");
    expect(msg).toContain(DEFAULT_EMBEDDING_PIN.model);
  });
});
