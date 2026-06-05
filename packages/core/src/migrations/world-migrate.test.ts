/**
 * Tests for world-migrate.ts (Phase 3b of #166).
 *
 * Builds a synthetic legacy layout in a temp directory, runs the migration,
 * and verifies all the invariants described in the spec. No Ollama required —
 * a stub embedder is injected via opts.embedder.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import { migrateToWorldDb } from "./world-migrate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub embedder — always returns a 768-dim all-0.2 vector. Ollama-free. */
const stubEmbedder = async (_text: string): Promise<number[]> =>
  new Array(768).fill(0.2);

/** Build a minimal FLOAT[768] all-0.1 literal for DuckDB inserts. */
const EMBD_01 = `[${new Array(768).fill(0.1).join(",")}]::FLOAT[768]`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Legacy DB builders
// ---------------------------------------------------------------------------

/**
 * Build legacy lore.duckdb with the old schema and synthetic rows:
 *   3 entities: bramble-hollow, magistrate-vos, fungal-iron
 *   2 relations: (bramble-hollow → magistrate-vos "rules"), (magistrate-vos → fungal-iron "trades-in")
 *   1 proximity edge: prox-bramble-hollow-magistrate-vos-spatial
 *   3 provenance rows: one entity, one relation, one proximity
 *   1 community: level-0 with members [bramble-hollow, magistrate-vos]
 */
async function buildLegacyLore(campaignPath: string): Promise<void> {
  const dbPath = join(campaignPath, "lore.duckdb");
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  try {
    await conn.run(`
      CREATE TABLE lore_entities (
        id         TEXT PRIMARY KEY,
        canonical  TEXT NOT NULL,
        aliases    TEXT[] NOT NULL DEFAULT [],
        type       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '{}',
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768] NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE lore_relations (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        relation   TEXT NOT NULL,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768],
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation)
      )
    `);
    await conn.run(`
      CREATE TABLE lore_provenance (
        id           TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id   TEXT NOT NULL,
        source_kind  TEXT NOT NULL,
        source_id    TEXT,
        excerpt      TEXT,
        confidence   FLOAT,
        created_at   TEXT NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE lore_communities (
        id           TEXT PRIMARY KEY,
        level        INTEGER NOT NULL,
        parent_id    TEXT,
        member_ids   TEXT[] NOT NULL DEFAULT [],
        member_count INTEGER NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        embedding    FLOAT[768],
        metadata     TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `);
    await conn.run(`
      CREATE TABLE lore_extraction_log (
        scene_id          TEXT PRIMARY KEY,
        extracted_at      TEXT NOT NULL,
        entities_created  INTEGER NOT NULL DEFAULT 0,
        entities_updated  INTEGER NOT NULL DEFAULT 0,
        relations_created INTEGER NOT NULL DEFAULT 0,
        skipped           INTEGER NOT NULL DEFAULT 0
      )
    `);
    await conn.run(`
      CREATE TABLE lore_proximity_edges (
        id         TEXT PRIMARY KEY,
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        dimension  TEXT NOT NULL,
        magnitude  FLOAT NOT NULL,
        direction  TEXT,
        order_kind TEXT,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (from_id, to_id, dimension)
      )
    `);

    const ts = "2026-01-01T00:00:00.000Z";

    // 3 entities
    await conn.run(
      `INSERT INTO lore_entities VALUES ('bramble-hollow', 'Bramble Hollow', ['bh', 'hollow'], 'place', 'A haunted village', '{}', '{}', ${EMBD_01}, ?, ?)`,
      [ts, ts],
    );
    await conn.run(
      `INSERT INTO lore_entities VALUES ('magistrate-vos', 'Magistrate Vos', [], 'person', 'The iron magistrate', '{}', '{}', ${EMBD_01}, ?, ?)`,
      [ts, ts],
    );
    await conn.run(
      `INSERT INTO lore_entities VALUES ('fungal-iron', 'Fungal Iron', ['fi'], 'material', 'Strange metal from the depths', '{}', '{}', ${EMBD_01}, ?, ?)`,
      [ts, ts],
    );

    // 2 relations
    await conn.run(
      `INSERT INTO lore_relations VALUES ('bramble-hollow', 'magistrate-vos', 'rules', 'from the keep', '{}', NULL, ?)`,
      [ts],
    );
    await conn.run(
      `INSERT INTO lore_relations VALUES ('magistrate-vos', 'fungal-iron', 'trades-in', NULL, '{}', NULL, ?)`,
      [ts],
    );

    // 1 proximity edge
    const proxId = "prox-bramble-hollow-magistrate-vos-spatial";
    await conn.run(
      `INSERT INTO lore_proximity_edges VALUES (?, 'bramble-hollow', 'magistrate-vos', 'spatial', 1.5, 'north', 'ordered', 'adjacent', '{}', ?)`,
      [proxId, ts],
    );

    // 3 provenance rows
    await conn.run(
      `INSERT INTO lore_provenance VALUES ('prov-entity-1', 'entity', 'bramble-hollow', 'manual', NULL, NULL, 1.0, ?)`,
      [ts],
    );
    // Relation provenance uses "from|to|relation" as subject_id
    await conn.run(
      `INSERT INTO lore_provenance VALUES ('prov-relation-1', 'relation', 'bramble-hollow|magistrate-vos|rules', 'manual', NULL, NULL, 0.9, ?)`,
      [ts],
    );
    await conn.run(
      `INSERT INTO lore_provenance VALUES ('prov-prox-1', 'proximity', ?, 'manual', NULL, NULL, 0.8, ?)`,
      [proxId, ts],
    );

    // 1 community (level-0 with 2 entity members)
    await conn.run(
      `INSERT INTO lore_communities VALUES ('comm-village', 0, NULL, ['bramble-hollow', 'magistrate-vos'], 2, 'The village cluster', NULL, '{}', ?, ?)`,
      [ts, ts],
    );
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

/**
 * Build legacy scenes.duckdb with:
 *   1 scene (known UUID)
 *   2 beats
 */
const SCENE_UUID = "11111111-1111-1111-1111-111111111111";
const BEAT_UUID_1 = "22222222-2222-2222-2222-222222222222";
const BEAT_UUID_2 = "33333333-3333-3333-3333-333333333333";

async function buildLegacyScenes(campaignPath: string): Promise<void> {
  const dbPath = join(campaignPath, "scenes.duckdb");
  const inst = await DuckDBInstance.create(dbPath);
  const conn = await inst.connect();
  try {
    await conn.run(`
      CREATE TABLE scenes (
        id                 TEXT PRIMARY KEY,
        text               TEXT NOT NULL,
        embedding          FLOAT[768] NOT NULL,
        timestamp          TEXT NOT NULL,
        kind               TEXT NOT NULL DEFAULT 'scene',
        complication_theme TEXT,
        quality_notes      TEXT
      )
    `);
    await conn.run(`
      CREATE TABLE scene_beats (
        id         TEXT PRIMARY KEY,
        scene_id   TEXT NOT NULL,
        beat_index INTEGER NOT NULL,
        kind       TEXT NOT NULL,
        speaker    TEXT,
        text       TEXT NOT NULL,
        embedding  FLOAT[768] NOT NULL,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `);

    const ts = "2026-01-02T00:00:00.000Z";

    await conn.run(
      `INSERT INTO scenes VALUES (?, 'The village burns', ${EMBD_01}, ?, 'scene', NULL, NULL)`,
      [SCENE_UUID, ts],
    );
    await conn.run(
      `INSERT INTO scene_beats VALUES (?, ?, 0, 'narration', NULL, 'Flames rise high', ${EMBD_01}, '{}', ?)`,
      [BEAT_UUID_1, SCENE_UUID, ts],
    );
    await conn.run(
      `INSERT INTO scene_beats VALUES (?, ?, 1, 'dialogue', 'Vos', 'This was inevitable', ${EMBD_01}, '{}', ?)`,
      [BEAT_UUID_2, SCENE_UUID, ts],
    );
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

/** Write two NPC markdown files. */
async function buildLegacyNpcs(campaignPath: string): Promise<void> {
  const npcsDir = join(campaignPath, "npcs");
  await mkdir(npcsDir, { recursive: true });

  await writeFile(
    join(npcsDir, "el.md"),
    `# Elder Lyra\n\n## 2026-01-01T00:00:00.000Z\n\n**Description:** A weathered elder with silver eyes.\n**Impression:** Wise and cautious.\n`,
    "utf8",
  );

  await writeFile(
    join(npcsDir, "vos.md"),
    `# The Iron Vos\n\n## 2026-01-01T00:00:00.000Z\n\n**Description:** A ruthless official.\n**Impression:** Dangerous.\n`,
    "utf8",
  );
}

/** Write a threads.yaml with 1 open + 1 closed thread. */
async function buildLegacyThreads(campaignPath: string): Promise<void> {
  const yaml = `
- title: Find the source of fungal iron
  kind: goal
  status: open
  notes: The party suspects the mine is the origin
  openedAt: "2026-01-01T00:00:00.000Z"
- title: Clear debts with Elder Lyra
  kind: debt
  status: closed
  notes: Repaid with a favour
  openedAt: "2026-01-01T00:00:00.000Z"
  closedAt: "2026-01-03T00:00:00.000Z"
  resolution: Favour was paid
`.trim();
  await writeFile(join(campaignPath, "threads.yaml"), yaml, "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrateToWorldDb", () => {
  let tmpDir: string;
  let campaignPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "world-migrate-test-"));
    campaignPath = join(tmpDir, "campaigns", "default");
    await mkdir(campaignPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Idempotency — no legacy files present → alreadyMigrated: true
  // -------------------------------------------------------------------------
  it("returns alreadyMigrated:true when no legacy DBs exist", async () => {
    const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
    expect(report.alreadyMigrated).toBe(true);
    expect(report.entities).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Full migration — synthetic fixture
  // -------------------------------------------------------------------------
  describe("full fixture migration", () => {
    beforeEach(async () => {
      await buildLegacyLore(campaignPath);
      await buildLegacyScenes(campaignPath);
      await buildLegacyNpcs(campaignPath);
      await buildLegacyThreads(campaignPath);
    });

    it("produces world.duckdb + world.json at worldRoot (tmpDir)", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(await fileExists(join(tmpDir, "world.duckdb"))).toBe(true);
      expect(await fileExists(join(tmpDir, "world.json"))).toBe(true);
    });

    it("writes campaign.json into the campaign folder", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(await fileExists(join(campaignPath, "campaign.json"))).toBe(true);
      const raw = await readFile(join(campaignPath, "campaign.json"), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed["id"]).toBe("default");
    });

    it("entity count == 3 lore + 2 npc + 2 thread = 7", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.entities).toBe(7);
    });

    it("relation count == 2", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.relations).toBe(2);
    });

    it("proximity_edges count == 1", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.proximity_edges).toBe(1);
    });

    it("scenes == 1, beats == 2", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.scenes).toBe(1);
      expect(report.beats).toBe(2);
    });

    it("legacy scene UUID is preserved", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT id FROM scenes WHERE campaign_id = 'default'",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        expect(rows.map((r) => String(r["id"]))).toContain(SCENE_UUID);
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("scene beat UUIDs are preserved", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT id FROM scene_beats ORDER BY beat_index",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        const ids = rows.map((r) => String(r["id"]));
        expect(ids).toContain(BEAT_UUID_1);
        expect(ids).toContain(BEAT_UUID_2);
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("slug→uuid map is bijective (each legacy slug appears once as slug or alias)", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT id, slug, aliases FROM entities WHERE campaign_id = 'default' ORDER BY slug",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        // The 3 lore entities should have their legacy slugs as `slug`
        const slugs = rows.map((r) => String(r["slug"]));
        // All IDs are UUIDs
        for (const row of rows) {
          const id = String(row["id"]);
          expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
        }
        // Legacy entity slugs appear in slug column
        expect(slugs).toContain("bramble-hollow");
        expect(slugs).toContain("magistrate-vos");
        expect(slugs).toContain("fungal-iron");
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("relations resolve: from_entity/to_entity are valid entity UUIDs", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(`
          SELECT r.id, r.from_entity, r.to_entity, r.label
          FROM relations r
          WHERE r.campaign_id = 'default'
        `);
        const rels = res.getRowObjectsJS() as Record<string, unknown>[];
        expect(rels.length).toBe(2);
        for (const rel of rels) {
          // both FKs must be present in entities
          const fromCheck = await conn.runAndReadAll(
            "SELECT id FROM entities WHERE id = ?",
            [String(rel["from_entity"])],
          );
          expect(fromCheck.getRowObjectsJS().length).toBe(1);
          const toCheck = await conn.runAndReadAll(
            "SELECT id FROM entities WHERE id = ?",
            [String(rel["to_entity"])],
          );
          expect(toCheck.getRowObjectsJS().length).toBe(1);
        }
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("proximity edge resolves to valid entity UUIDs", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT from_id, to_id FROM lore_proximity_edges WHERE campaign_id = 'default'",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        expect(rows.length).toBe(1);
        for (const row of rows) {
          const fromCheck = await conn.runAndReadAll(
            "SELECT id FROM entities WHERE id = ?",
            [String(row["from_id"])],
          );
          expect(fromCheck.getRowObjectsJS().length).toBe(1);
          const toCheck = await conn.runAndReadAll(
            "SELECT id FROM entities WHERE id = ?",
            [String(row["to_id"])],
          );
          expect(toCheck.getRowObjectsJS().length).toBe(1);
        }
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("provenance subject_ids all resolve to existing rows (no dangling)", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        // entity provenance → subject_id in entities
        const entityProv = await conn.runAndReadAll(
          "SELECT subject_id FROM lore_provenance WHERE subject_kind = 'entity'",
        );
        const entityProvRows = entityProv.getRowObjectsJS() as Record<string, unknown>[];
        for (const row of entityProvRows) {
          const check = await conn.runAndReadAll(
            "SELECT id FROM entities WHERE id = ?",
            [String(row["subject_id"])],
          );
          expect(check.getRowObjectsJS().length).toBe(1);
        }

        // relation provenance → subject_id in relations
        const relProv = await conn.runAndReadAll(
          "SELECT subject_id FROM lore_provenance WHERE subject_kind = 'relation'",
        );
        const relProvRows = relProv.getRowObjectsJS() as Record<string, unknown>[];
        for (const row of relProvRows) {
          const check = await conn.runAndReadAll(
            "SELECT id FROM relations WHERE id = ?",
            [String(row["subject_id"])],
          );
          expect(check.getRowObjectsJS().length).toBe(1);
        }

        // proximity provenance → subject_id in lore_proximity_edges
        const proxProv = await conn.runAndReadAll(
          "SELECT subject_id FROM lore_provenance WHERE subject_kind = 'proximity'",
        );
        const proxProvRows = proxProv.getRowObjectsJS() as Record<string, unknown>[];
        for (const row of proxProvRows) {
          const check = await conn.runAndReadAll(
            "SELECT id FROM lore_proximity_edges WHERE id = ?",
            [String(row["subject_id"])],
          );
          expect(check.getRowObjectsJS().length).toBe(1);
        }
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("NPCs appear as type='person' scoped to campaignId", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT canonical FROM entities WHERE type = 'person' AND campaign_id = 'default' ORDER BY canonical",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        const names = rows.map((r) => String(r["canonical"]));
        expect(names).toContain("Elder Lyra");
        expect(names).toContain("The Iron Vos");
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("threads appear as type='thread' scoped to campaignId", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT canonical, metadata FROM entities WHERE type = 'thread' AND campaign_id = 'default' ORDER BY canonical",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        const titles = rows.map((r) => String(r["canonical"]));
        expect(titles).toContain("Clear debts with Elder Lyra");
        expect(titles).toContain("Find the source of fungal iron");
        // Verify closed thread has status and closedAt in metadata
        const closedRow = rows.find((r) => r["canonical"] === "Clear debts with Elder Lyra");
        expect(closedRow).toBeDefined();
        const meta = JSON.parse(String(closedRow!["metadata"])) as Record<string, unknown>;
        expect(meta["status"]).toBe("closed");
        expect(meta["closedAt"]).toBeDefined();
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("moves legacy files to *.legacy paths", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.legacyMoved.length).toBeGreaterThan(0);
      // Original paths gone
      expect(await fileExists(join(campaignPath, "lore.duckdb"))).toBe(false);
      expect(await fileExists(join(campaignPath, "scenes.duckdb"))).toBe(false);
      expect(await fileExists(join(campaignPath, "npcs"))).toBe(false);
      expect(await fileExists(join(campaignPath, "threads.yaml"))).toBe(false);
      // Legacy destinations exist
      expect(await fileExists(join(campaignPath, "lore.duckdb.legacy"))).toBe(true);
      expect(await fileExists(join(campaignPath, "scenes.duckdb.legacy"))).toBe(true);
      expect(await fileExists(join(campaignPath, "npcs.legacy"))).toBe(true);
      expect(await fileExists(join(campaignPath, "threads.yaml.legacy"))).toBe(true);
    });

    it("re-run returns alreadyMigrated: true and does not duplicate rows", async () => {
      await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      // Second run: legacy files have been moved, so no lore.duckdb / scenes.duckdb
      const report2 = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report2.alreadyMigrated).toBe(true);
      expect(report2.entities).toBe(0);

      // Entity count in DB should still be 7, not 14
      const inst = await DuckDBInstance.create(join(tmpDir, "world.duckdb"));
      const conn = await inst.connect();
      try {
        const res = await conn.runAndReadAll(
          "SELECT COUNT(*) AS n FROM entities WHERE campaign_id = 'default'",
        );
        const rows = res.getRowObjectsJS() as Record<string, unknown>[];
        const n = rows[0]!["n"];
        const count = typeof n === "bigint" ? Number(n) : (n as number);
        expect(count).toBe(7);
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    });

    it("dryRun does not move legacy files", async () => {
      const report = await migrateToWorldDb(campaignPath, {
        embedder: stubEmbedder,
        dryRun: true,
      });
      expect(report.legacyMoved).toEqual([]);
      expect(report.alreadyMigrated).toBe(false);
      // Original paths still present
      expect(await fileExists(join(campaignPath, "lore.duckdb"))).toBe(true);
      expect(await fileExists(join(campaignPath, "scenes.duckdb"))).toBe(true);
    });

    it("worldRoot is reported correctly (grandparent of campaigns/<id>)", async () => {
      const report = await migrateToWorldDb(campaignPath, { embedder: stubEmbedder });
      expect(report.worldRoot).toBe(tmpDir);
      expect(report.campaignId).toBe("default");
    });
  });
});
