import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import { upsertLore, linkLore, canonizeEntity } from "./lore.js";
import {
  exportSettingSeed,
  importSettingSeed,
  maybeImportPendingSettingSeed,
  SETTING_SEED_SCHEMA_VERSION,
  SETTING_SEED_PENDING_FILENAME,
  SETTING_SEED_IMPORTED_FILENAME,
  type SettingSeed,
} from "./setting-seed.js";

let _ollamaReady: boolean | null = null;
async function ollamaAvailable(): Promise<boolean> {
  if (_ollamaReady !== null) return _ollamaReady;
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    _ollamaReady = res.ok;
  } catch {
    _ollamaReady = false;
  }
  return _ollamaReady;
}

let sourceDir: string;
let targetDir: string;

beforeEach(async () => {
  sourceDir = await mkdtemp(join(tmpdir(), "scribe-setting-seed-source-"));
  targetDir = await mkdtemp(join(tmpdir(), "scribe-setting-seed-target-"));
});

afterEach(async () => {
  await rm(sourceDir, { recursive: true, force: true });
  await rm(targetDir, { recursive: true, force: true });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("exportSettingSeed", () => {
  it("only exports campaign_id IS NULL entities and relations, excluding campaign-scoped and invalidated ones", async () => {
    if (!(await ollamaAvailable())) return;
    const canonA = await upsertLore(sourceDir, { canonical: "The Sundered Hold", type: "place", summary: "a ruined fortress" });
    const canonB = await upsertLore(sourceDir, { canonical: "Warden Kess", type: "person", summary: "keeps the hold" });
    await canonizeEntity(sourceDir, canonA.id);
    await canonizeEntity(sourceDir, canonB.id);
    await linkLore(sourceDir, { from: canonA.id, to: canonB.id, relation: "GUARDED_BY" });

    // campaign-scoped noise — must not leak into the seed
    await upsertLore(sourceDir, { canonical: "Private Scratch Note", type: "concept", summary: "not canon" });

    const seed = await exportSettingSeed(sourceDir);
    expect(seed.schemaVersion).toBe(SETTING_SEED_SCHEMA_VERSION);
    expect(seed.entities.map((e) => e.canonical).sort()).toEqual(["The Sundered Hold", "Warden Kess"]);
    expect(seed.relations).toHaveLength(1);
    expect(seed.relations[0]!.label).toBe("GUARDED_BY");
  });
});

describe("importSettingSeed", () => {
  it("lands entities as world canon (campaign_id NULL), preserving ids, and links canon relations", async () => {
    if (!(await ollamaAvailable())) return;
    const holdId = crypto.randomUUID();
    const wardenId = crypto.randomUUID();
    const seed: SettingSeed = {
      schemaVersion: SETTING_SEED_SCHEMA_VERSION,
      sourceWorld: "Zura",
      exportedAt: new Date().toISOString(),
      entities: [
        { id: holdId, canonical: "The Sundered Hold", type: "place", summary: "a ruined fortress", content: {}, metadata: {}, aliases: [] },
        { id: wardenId, canonical: "Warden Kess", type: "person", summary: "keeps the hold", content: {}, metadata: {}, aliases: [] },
      ],
      relations: [
        { from_entity: holdId, to_entity: wardenId, label: "GUARDED_BY", notes: null, metadata: {} },
      ],
      communities: [],
    };

    const counts = await importSettingSeed(targetDir, seed);
    expect(counts).toEqual({ entities: 2, relations: 1, communities: 0 });

    const ctx = await resolveWorldContext(targetDir);
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const entRows = (await conn.runAndReadAll(
        `SELECT id, canonical, campaign_id FROM entities ORDER BY canonical`,
      )).getRowObjectsJS() as Record<string, unknown>[];
      expect(entRows).toHaveLength(2);
      for (const row of entRows) expect(row["campaign_id"]).toBeNull();
      expect(entRows.map((r) => String(r["id"])).sort()).toEqual([holdId, wardenId].sort());

      const relRows = (await conn.runAndReadAll(
        `SELECT from_entity, to_entity, label, campaign_id FROM relations`,
      )).getRowObjectsJS() as Record<string, unknown>[];
      expect(relRows).toHaveLength(1);
      expect(relRows[0]!["campaign_id"]).toBeNull();
      expect(relRows[0]!["label"]).toBe("GUARDED_BY");
    } finally {
      conn.closeSync();
    }
  });

  it("imports communities directly as campaign_id NULL", async () => {
    if (!(await ollamaAvailable())) return;
    const entityId = crypto.randomUUID();
    const communityId = "abc123";
    const seed: SettingSeed = {
      schemaVersion: SETTING_SEED_SCHEMA_VERSION,
      sourceWorld: "Zura",
      exportedAt: new Date().toISOString(),
      entities: [
        { id: entityId, canonical: "The Sundered Hold", type: "place", summary: "a ruined fortress", content: {}, metadata: {}, aliases: [] },
      ],
      relations: [],
      communities: [
        { id: communityId, level: 0, parent_id: null, member_ids: [entityId], member_count: 1, summary: "The Hold cluster", metadata: {} },
      ],
    };

    const counts = await importSettingSeed(targetDir, seed);
    expect(counts.communities).toBe(1);

    const ctx = await resolveWorldContext(targetDir);
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const rows = (await conn.runAndReadAll(
        `SELECT id, campaign_id, summary FROM lore_communities WHERE id = ?`,
        [communityId],
      )).getRowObjectsJS() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!["campaign_id"]).toBeNull();
      expect(rows[0]!["summary"]).toBe("The Hold cluster");
    } finally {
      conn.closeSync();
    }
  });

  it("throws on an unsupported schema version", async () => {
    const seed = {
      schemaVersion: 999,
      sourceWorld: "Zura",
      exportedAt: new Date().toISOString(),
      entities: [],
      relations: [],
      communities: [],
    } as SettingSeed;
    await expect(importSettingSeed(targetDir, seed)).rejects.toThrow(/schema version/i);
  });
});

describe("round trip", () => {
  it("export from a source world reproduces equivalent canon in a freshly-seeded target world", async () => {
    if (!(await ollamaAvailable())) return;
    const place = await upsertLore(sourceDir, { canonical: "The Sundered Hold", type: "place", summary: "a ruined fortress" });
    const person = await upsertLore(sourceDir, { canonical: "Warden Kess", type: "person", summary: "keeps the hold" });
    await canonizeEntity(sourceDir, place.id);
    await canonizeEntity(sourceDir, person.id);
    await linkLore(sourceDir, { from: place.id, to: person.id, relation: "GUARDED_BY" });

    const seed = await exportSettingSeed(sourceDir);
    await importSettingSeed(targetDir, seed);

    const reExported = await exportSettingSeed(targetDir);
    expect(reExported.entities.map((e) => e.canonical).sort()).toEqual(
      seed.entities.map((e) => e.canonical).sort(),
    );
    expect(reExported.relations.map((r) => r.label)).toEqual(seed.relations.map((r) => r.label));
  });
});

describe("maybeImportPendingSettingSeed", () => {
  it("no-ops when there is no pending seed file", async () => {
    const result = await maybeImportPendingSettingSeed(targetDir);
    expect(result.imported).toBe(false);
  });

  it("imports and renames the pending file exactly once", async () => {
    if (!(await ollamaAvailable())) return;
    const entityId = crypto.randomUUID();
    const seed: SettingSeed = {
      schemaVersion: SETTING_SEED_SCHEMA_VERSION,
      sourceWorld: "Zura",
      exportedAt: new Date().toISOString(),
      entities: [
        { id: entityId, canonical: "The Sundered Hold", type: "place", summary: "a ruined fortress", content: {}, metadata: {}, aliases: [] },
      ],
      relations: [],
      communities: [],
    };
    const ctx = await resolveWorldContext(targetDir);
    await writeFile(join(ctx.worldRoot, SETTING_SEED_PENDING_FILENAME), JSON.stringify(seed));

    const first = await maybeImportPendingSettingSeed(targetDir);
    expect(first.imported).toBe(true);
    expect(first.counts).toEqual({ entities: 1, relations: 0, communities: 0 });
    expect(await fileExists(join(ctx.worldRoot, SETTING_SEED_PENDING_FILENAME))).toBe(false);
    expect(await fileExists(join(ctx.worldRoot, SETTING_SEED_IMPORTED_FILENAME))).toBe(true);

    const second = await maybeImportPendingSettingSeed(targetDir);
    expect(second.imported).toBe(false);

    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    try {
      const rows = (await conn.runAndReadAll(`SELECT COUNT(*) AS cnt FROM entities WHERE campaign_id IS NULL`))
        .getRowObjectsJS() as Record<string, unknown>[];
      expect(Number(rows[0]!["cnt"])).toBe(1);
    } finally {
      conn.closeSync();
    }
  });
});
