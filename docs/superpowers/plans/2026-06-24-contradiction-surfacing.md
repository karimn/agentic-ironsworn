# Contradiction Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add write-time contradiction detection to `upsertLore`/`linkLore` — flags persisted to a `contradictions` table and returned inline in tool responses — plus two MCP tools to list and resolve flags.

**Architecture:** New `rag/contradictions.ts` module owns detection logic and DB operations; called from `upsertLore` (cosine similarity < 0.72 on summary update) and `linkLore` (active A→B with different label exists without declared supersession). Two new MCP tools expose the flag lifecycle. `extract_session_lore` picks this up automatically since it calls `upsertLore`/`linkLore` internally.

**Tech Stack:** DuckDB (`@duckdb/node-api`), Bun/TypeScript, MCP SDK (`@modelcontextprotocol/sdk/server/mcp.js`), zod.

## Global Constraints

- Run tests: `cd packages/core && bun test` (or `bun test <specific-file>`)
- Typecheck core: `cd packages/core && bun run tsc --noEmit`
- Typecheck scribe: `cd plugins/ironsworn/scribe && bun run tsc --noEmit`
- Plugin version bump required in `plugins/ironsworn/.claude-plugin/plugin.json` on every PR (minor for new tools)
- Migration entries are append-only — never edit or reorder existing entries
- Detection threshold constant: `ENTITY_CONTRADICTION_THRESHOLD = 0.72`
- Never reject writes — surface flags only
- Unit tests in `contradictions.test.ts` use direct DB inserts with crafted embeddings (no Ollama)
- Integration tests in `lore.test.ts` call `upsertLore`/`linkLore` and require Ollama — guard with `if (!(await ollamaAvailable())) return;`

---

### Task 1: Add `contradictions` table to world DB schema + migration

**Files:**
- Modify: `packages/core/src/rag/world-db.ts` (add table in `initDb` before the `runDbMigrations` call at line 272)
- Modify: `packages/core/src/migrations/world.ts` (append version 2 entry after version 1)
- Modify: `packages/core/src/rag/world-db.test.ts` (add schema test)

**Interfaces:**
- Produces: `contradictions` table with 12 columns present in every new and migrated `world.duckdb`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/rag/world-db.test.ts` (after the last existing describe block):

```ts
describe("initDb — contradictions table", () => {
  let campaignDir: string;

  beforeEach(async () => {
    campaignDir = await mkdtemp(join(tmpdir(), "world-contradiction-test-"));
  });

  afterEach(async () => {
    await rm(campaignDir, { recursive: true, force: true });
  });

  it("creates the contradictions table on fresh DB init", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await instance.connect();
    try {
      const result = await conn.runAndReadAll(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'contradictions' ORDER BY column_name`,
      );
      const cols = (result.getRowObjectsJS() as Record<string, unknown>[])
        .map((r) => String(r["column_name"]));
      expect(cols).toContain("id");
      expect(cols).toContain("kind");
      expect(cols).toContain("entity_id");
      expect(cols).toContain("relation_id");
      expect(cols).toContain("conflicting_relation_id");
      expect(cols).toContain("existing_value");
      expect(cols).toContain("incoming_value");
      expect(cols).toContain("similarity");
      expect(cols).toContain("campaign_id");
      expect(cols).toContain("created_at");
      expect(cols).toContain("resolved_at");
      expect(cols).toContain("resolution");
    } finally {
      conn.closeSync();
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/core && bun test src/rag/world-db.test.ts 2>&1 | grep -E "FAIL|error" | head -5
```

Expected: FAIL — `contradictions` table does not exist.

- [ ] **Step 3: Add table to `initDb` in `world-db.ts`**

In `packages/core/src/rag/world-db.ts`, insert immediately before the `runDbMigrations` call (~line 269):

```ts
    // -----------------------------------------------------------------------
    // contradictions — write-time conflict flags (v1 priority #4)
    // -----------------------------------------------------------------------
    await conn.run(`
      CREATE TABLE IF NOT EXISTS contradictions (
        id                      TEXT PRIMARY KEY,
        kind                    TEXT NOT NULL,
        entity_id               TEXT,
        relation_id             TEXT,
        conflicting_relation_id TEXT,
        existing_value          TEXT NOT NULL,
        incoming_value          TEXT NOT NULL,
        similarity              REAL,
        campaign_id             TEXT,
        created_at              TEXT NOT NULL,
        resolved_at             TEXT,
        resolution              TEXT
      )
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS contradictions_campaign_id_idx
      ON contradictions (campaign_id)
    `);
    await conn.run(`
      CREATE INDEX IF NOT EXISTS contradictions_entity_id_idx
      ON contradictions (entity_id)
    `);
```

- [ ] **Step 4: Append version 2 migration in `world.ts`**

In `packages/core/src/migrations/world.ts`, append after the closing `},` of the version 1 entry:

```ts
  {
    version: 2,
    description: "add contradictions table for write-time conflict surfacing",
    async up(conn) {
      await conn.run(`
        CREATE TABLE IF NOT EXISTS contradictions (
          id                      TEXT PRIMARY KEY,
          kind                    TEXT NOT NULL,
          entity_id               TEXT,
          relation_id             TEXT,
          conflicting_relation_id TEXT,
          existing_value          TEXT NOT NULL,
          incoming_value          TEXT NOT NULL,
          similarity              REAL,
          campaign_id             TEXT,
          created_at              TEXT NOT NULL,
          resolved_at             TEXT,
          resolution              TEXT
        )
      `);
      await conn.run(
        `CREATE INDEX IF NOT EXISTS contradictions_campaign_id_idx ON contradictions (campaign_id)`,
      );
      await conn.run(
        `CREATE INDEX IF NOT EXISTS contradictions_entity_id_idx ON contradictions (entity_id)`,
      );
    },
  },
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd packages/core && bun test src/rag/world-db.test.ts
```

Expected: all tests PASS including the new one.

- [ ] **Step 6: Typecheck**

```bash
cd packages/core && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/world-db.ts packages/core/src/migrations/world.ts packages/core/src/rag/world-db.test.ts
git commit -m "feat: add contradictions table to world DB schema (migration v2)"
```

---

### Task 2: `contradictions.ts` — types + entity check

**Files:**
- Create: `packages/core/src/rag/contradictions.ts`
- Create: `packages/core/src/rag/contradictions.test.ts`

**Interfaces:**
- Consumes: `DuckDBInstance` from `@duckdb/node-api`; `resolveWorldContext` from `../world.js`; `getWorldDb`, `openWorldWriteConn` from `./world-db.js`
- Produces:
  - `ContradictionFlag` — exported interface
  - `ENTITY_CONTRADICTION_THRESHOLD = 0.72` — exported const
  - `checkEntityContradiction(conn, input): Promise<ContradictionFlag | null>` — exported function

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/rag/contradictions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import {
  checkEntityContradiction,
  checkRelationContradiction,
  listContradictions,
  resolveContradiction,
  type ContradictionFlag,
} from "./contradictions.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-contradiction-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// Insert an entity row with a crafted embedding (no Ollama needed).
// embeddingFirstVal is placed at position 0; all other dims are 0.
// Cosine similarity between [a,0,...] and [b,0,...] = sign(a*b).
async function insertEntity(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  campaignId: string,
  opts: { id: string; summary: string; embeddingFirstVal: number; slug?: string },
): Promise<void> {
  const emb = [opts.embeddingFirstVal, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const slug = opts.slug ?? "test-entity";
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO entities
       (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
        campaign_id, created_in_campaign, created_at, updated_at)
     VALUES (?, ?, 'Test Entity', [], 'person', ?, '{}', '{}', ${embLiteral}, ?, ?, ?, ?)`,
    [opts.id, slug, opts.summary, campaignId, campaignId, now, now],
  );
}

describe("checkEntityContradiction", () => {
  it("returns a flag when new summary embedding is orthogonal to existing (sim ≈ 0)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const entityId = crypto.randomUUID();
      // stored embedding: [1, 0, 0, ...]
      await insertEntity(conn, ctx.campaignId, {
        id: entityId,
        summary: "A healer in Caldren",
        embeddingFirstVal: 1.0,
      });

      // new embedding: [0, 1, 0, ...] → cosine sim = 0 (orthogonal)
      const newEmb = [0.0, 1.0, ...Array(766).fill(0.0)];
      const flag = await checkEntityContradiction(conn, {
        entityId,
        newEmbedding: newEmb,
        existingSummary: "A healer in Caldren",
        incomingSummary: "A blacksmith in the capital",
        campaignId: ctx.campaignId,
      });

      expect(flag).not.toBeNull();
      expect(flag!.kind).toBe("entity_summary_divergence");
      expect(flag!.entity_id).toBe(entityId);
      expect(flag!.existing_value).toBe("A healer in Caldren");
      expect(flag!.incoming_value).toBe("A blacksmith in the capital");
      expect(flag!.similarity).toBeCloseTo(0, 5);
      expect(flag!.resolved_at).toBeUndefined();
      expect(flag!.id).toBeDefined();
      expect(flag!.created_at).toBeDefined();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when new embedding is identical to existing (sim = 1.0)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const entityId = crypto.randomUUID();
      // stored embedding: [1, 0, ...]
      await insertEntity(conn, ctx.campaignId, {
        id: entityId,
        summary: "A healer in Caldren",
        embeddingFirstVal: 1.0,
        slug: "test-entity-2",
      });

      // new embedding: same direction → cosine sim = 1.0 → no flag
      const newEmb = [1.0, ...Array(767).fill(0.0)];
      const flag = await checkEntityContradiction(conn, {
        entityId,
        newEmbedding: newEmb,
        existingSummary: "A healer in Caldren",
        incomingSummary: "A healer in Caldren (expanded)",
        campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts 2>&1 | head -10
```

Expected: FAIL — `contradictions.js` module not found.

- [ ] **Step 3: Create `contradictions.ts` with types + entity check**

Create `packages/core/src/rag/contradictions.ts`:

```ts
import { DuckDBInstance } from "@duckdb/node-api";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";

export interface ContradictionFlag {
  id: string;
  kind: "entity_summary_divergence" | "relation_label_conflict";
  entity_id?: string;
  relation_id?: string;
  conflicting_relation_id?: string;
  existing_value: string;
  incoming_value: string;
  similarity?: number;
  campaign_id: string | null;
  created_at: string;
  resolved_at?: string;
  resolution?: string;
}

export const ENTITY_CONTRADICTION_THRESHOLD = 0.72;

/**
 * Check whether an entity update's incoming summary diverges significantly
 * from the stored one. Uses DuckDB's array_cosine_similarity against the
 * existing embedding in the DB.
 *
 * MUST be called BEFORE the UPDATE statement in upsertLore — the UPDATE
 * overwrites the stored embedding, making the check trivially return 1.0 afterward.
 */
export async function checkEntityContradiction(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  input: {
    entityId: string;
    newEmbedding: number[];
    existingSummary: string;
    incomingSummary: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null> {
  const embLiteral = `[${input.newEmbedding.join(",")}]::FLOAT[768]`;
  const simResult = await conn.runAndReadAll(
    `SELECT array_cosine_similarity(embedding, ${embLiteral}) AS similarity
     FROM entities WHERE id = ?`,
    [input.entityId],
  );
  const rows = simResult.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const rawSim = rows[0]["similarity"];
  const similarity =
    typeof rawSim === "number" ? rawSim
    : typeof rawSim === "bigint" ? Number(rawSim)
    : Number.NaN;

  if (Number.isNaN(similarity) || similarity >= ENTITY_CONTRADICTION_THRESHOLD) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO contradictions
       (id, kind, entity_id, existing_value, incoming_value, similarity, campaign_id, created_at)
     VALUES (?, 'entity_summary_divergence', ?, ?, ?, ?, ?, ?)`,
    [id, input.entityId, input.existingSummary, input.incomingSummary, similarity, input.campaignId, now],
  );
  return {
    id,
    kind: "entity_summary_divergence",
    entity_id: input.entityId,
    existing_value: input.existingSummary,
    incoming_value: input.incomingSummary,
    similarity,
    campaign_id: input.campaignId,
    created_at: now,
  };
}
```

Leave stubs for `checkRelationContradiction`, `listContradictions`, `resolveContradiction` — they'll be added in Tasks 3–4. For now the file ends after `checkEntityContradiction`.

- [ ] **Step 4: Run to confirm entity tests pass**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts 2>&1 | grep -E "✓|✗|PASS|FAIL"
```

Expected: the 2 `checkEntityContradiction` tests PASS. The `checkRelationContradiction` / `listContradictions` / `resolveContradiction` tests FAIL (not yet written — that's expected).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rag/contradictions.ts packages/core/src/rag/contradictions.test.ts
git commit -m "feat: contradictions module — ContradictionFlag + checkEntityContradiction"
```

---

### Task 3: `contradictions.ts` — relation check

**Files:**
- Modify: `packages/core/src/rag/contradictions.ts` (append `checkRelationContradiction`)
- Modify: `packages/core/src/rag/contradictions.test.ts` (add 3 relation-check tests + `insertRelation`/`insertStubEntities` helpers)

**Interfaces:**
- Consumes: `contradictions` table (Task 1), open write conn
- Produces: `checkRelationContradiction(conn, input): Promise<ContradictionFlag | null>`

- [ ] **Step 1: Add failing tests**

Append to `packages/core/src/rag/contradictions.test.ts` (after the `checkEntityContradiction` describe block):

```ts
// Insert stub entity rows so FK-adjacent queries can join them.
async function insertStubEntities(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  campaignId: string,
  ids: [string, string][],  // [id, slug] pairs
): Promise<void> {
  const emb = [1.0, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  for (const [eid, slug] of ids) {
    await conn.run(
      `INSERT INTO entities
         (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
          campaign_id, created_in_campaign, created_at, updated_at)
       VALUES (?, ?, ?, [], 'person', 'stub', '{}', '{}', ${embLiteral}, ?, ?, ?, ?)`,
      [eid, slug, slug, campaignId, campaignId, now, now],
    );
  }
}

// Insert a relation row directly.
async function insertRelation(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: {
    id: string;
    fromId: string;
    toId: string;
    label: string;
    campaignId: string;
    invalidAt?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO relations
       (id, from_entity, to_entity, label, notes, metadata, campaign_id, valid_at, invalid_at, created_at)
     VALUES (?, ?, ?, ?, NULL, '{}', ?, NULL, ?, ?)`,
    [opts.id, opts.fromId, opts.toId, opts.label, opts.campaignId, opts.invalidAt ?? null, now],
  );
}

describe("checkRelationContradiction", () => {
  it("returns a flag when an active A→B relation with a different label exists", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      const existingRelId = crypto.randomUUID();
      const newRelId = crypto.randomUUID();

      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-a"], [toId, "to-a"]]);
      await insertRelation(conn, {
        id: existingRelId, fromId, toId, label: "ENEMY_OF", campaignId: ctx.campaignId,
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "ALLY_OF", newRelationId: newRelId, campaignId: ctx.campaignId,
      });

      expect(flag).not.toBeNull();
      expect(flag!.kind).toBe("relation_label_conflict");
      expect(flag!.relation_id).toBe(newRelId);
      expect(flag!.conflicting_relation_id).toBe(existingRelId);
      expect(flag!.existing_value).toBe("ENEMY_OF");
      expect(flag!.incoming_value).toBe("ALLY_OF");
      expect(flag!.id).toBeDefined();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when the only existing A→B relation is already invalidated", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-b"], [toId, "to-b"]]);
      await insertRelation(conn, {
        id: crypto.randomUUID(), fromId, toId, label: "HOLDS_TITLE",
        campaignId: ctx.campaignId, invalidAt: new Date().toISOString(),
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "BANISHED_FROM",
        newRelationId: crypto.randomUUID(), campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when the only existing A→B relation has the same label (defensive case)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-c"], [toId, "to-c"]]);
      await insertRelation(conn, {
        id: crypto.randomUUID(), fromId, toId, label: "ALLY_OF", campaignId: ctx.campaignId,
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "ALLY_OF",
        newRelationId: crypto.randomUUID(), campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts 2>&1 | grep -E "checkRelation|error" | head -5
```

Expected: `checkRelationContradiction` tests FAIL — function not found.

- [ ] **Step 3: Implement `checkRelationContradiction`**

Append to `packages/core/src/rag/contradictions.ts`:

```ts
/**
 * Check whether inserting a new A→B relation with `newLabel` conflicts with
 * any currently-active A→B relation with a different label (undeclared
 * supersession). Must be called AFTER the new relation row is inserted
 * so newRelationId is valid for the flag record.
 * Inserts a flag for each conflict found; returns the first flag or null.
 */
export async function checkRelationContradiction(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  input: {
    fromId: string;
    toId: string;
    newLabel: string;
    newRelationId: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null> {
  const result = await conn.runAndReadAll(
    `SELECT id, label FROM relations
     WHERE from_entity = ? AND to_entity = ? AND label != ?
       AND invalid_at IS NULL
       AND (campaign_id IS NULL OR campaign_id = ?)`,
    [input.fromId, input.toId, input.newLabel, input.campaignId],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const now = new Date().toISOString();
  let firstFlag: ContradictionFlag | null = null;

  for (const row of rows) {
    const conflictingId = String(row["id"]);
    const conflictingLabel = String(row["label"]);
    const id = crypto.randomUUID();
    await conn.run(
      `INSERT INTO contradictions
         (id, kind, relation_id, conflicting_relation_id, existing_value, incoming_value, campaign_id, created_at)
       VALUES (?, 'relation_label_conflict', ?, ?, ?, ?, ?, ?)`,
      [id, input.newRelationId, conflictingId, conflictingLabel, input.newLabel, input.campaignId, now],
    );
    if (firstFlag === null) {
      firstFlag = {
        id,
        kind: "relation_label_conflict",
        relation_id: input.newRelationId,
        conflicting_relation_id: conflictingId,
        existing_value: conflictingLabel,
        incoming_value: input.newLabel,
        campaign_id: input.campaignId,
        created_at: now,
      };
    }
  }

  return firstFlag;
}
```

- [ ] **Step 4: Run to confirm all 5 tests pass**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts
```

Expected: all 5 tests PASS (2 entity + 3 relation).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rag/contradictions.ts packages/core/src/rag/contradictions.test.ts
git commit -m "feat: contradictions module — checkRelationContradiction"
```

---

### Task 4: `contradictions.ts` — list + resolve

**Files:**
- Modify: `packages/core/src/rag/contradictions.ts` (append `rowToFlag`, `listContradictions`, `resolveContradiction`)
- Modify: `packages/core/src/rag/contradictions.test.ts` (add 2 tests)

**Interfaces:**
- Produces:
  - `listContradictions(campaignPath, opts?): Promise<ContradictionFlag[]>`
  - `resolveContradiction(campaignPath, id, resolution?): Promise<void>`

- [ ] **Step 1: Add failing tests**

Append to `packages/core/src/rag/contradictions.test.ts`:

```ts
describe("listContradictions + resolveContradiction", () => {
  it("listContradictions returns open flags and excludes resolved by default", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const openId = crypto.randomUUID();
    const resolvedId = crypto.randomUUID();
    try {
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'relation_label_conflict', 'A', 'B', ?, ?)`,
        [openId, ctx.campaignId, now],
      );
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at, resolved_at, resolution)
         VALUES (?, 'entity_summary_divergence', 'C', 'D', ?, ?, ?, 'confirmed coexistence')`,
        [resolvedId, ctx.campaignId, now, now, now],
      );
    } finally {
      conn.closeSync();
    }

    const openFlags = await listContradictions(campaignDir);
    expect(openFlags.length).toBe(1);
    expect(openFlags[0].id).toBe(openId);
    expect(openFlags[0].resolved_at).toBeUndefined();

    const allFlags = await listContradictions(campaignDir, { includeResolved: true });
    expect(allFlags.length).toBe(2);
  });

  it("resolveContradiction sets resolved_at and resolution on the row", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const flagId = crypto.randomUUID();
    try {
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'relation_label_conflict', 'X', 'Y', ?, ?)`,
        [flagId, ctx.campaignId, now],
      );
    } finally {
      conn.closeSync();
    }

    await resolveContradiction(campaignDir, flagId, "facts coexist — ally and student simultaneously");

    const all = await listContradictions(campaignDir, { includeResolved: true });
    const flag = all.find((f) => f.id === flagId);
    expect(flag).toBeDefined();
    expect(flag!.resolved_at).toBeDefined();
    expect(flag!.resolution).toBe("facts coexist — ally and student simultaneously");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts 2>&1 | grep -E "list|resolve|error" | head -5
```

Expected: new tests FAIL — functions not yet exported.

- [ ] **Step 3: Implement `rowToFlag`, `listContradictions`, `resolveContradiction`**

Append to `packages/core/src/rag/contradictions.ts`:

```ts
function rowToFlag(row: Record<string, unknown>): ContradictionFlag {
  return {
    id: String(row["id"]),
    kind: String(row["kind"]) as ContradictionFlag["kind"],
    entity_id: row["entity_id"] != null ? String(row["entity_id"]) : undefined,
    relation_id: row["relation_id"] != null ? String(row["relation_id"]) : undefined,
    conflicting_relation_id: row["conflicting_relation_id"] != null
      ? String(row["conflicting_relation_id"]) : undefined,
    existing_value: String(row["existing_value"]),
    incoming_value: String(row["incoming_value"]),
    similarity: row["similarity"] != null ? Number(row["similarity"]) : undefined,
    campaign_id: row["campaign_id"] != null ? String(row["campaign_id"]) : null,
    created_at: String(row["created_at"]),
    resolved_at: row["resolved_at"] != null ? String(row["resolved_at"]) : undefined,
    resolution: row["resolution"] != null ? String(row["resolution"]) : undefined,
  };
}

export async function listContradictions(
  campaignPath: string,
  opts?: { includeResolved?: boolean; limit?: number },
): Promise<ContradictionFlag[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const limit = opts?.limit ?? 20;
    const resolvedClause = (opts?.includeResolved ?? false) ? "" : "AND resolved_at IS NULL";
    const result = await conn.runAndReadAll(
      `SELECT id, kind, entity_id, relation_id, conflicting_relation_id,
              existing_value, incoming_value, similarity, campaign_id,
              created_at, resolved_at, resolution
       FROM contradictions
       WHERE campaign_id = ? ${resolvedClause}
       ORDER BY created_at DESC
       LIMIT ?`,
      [ctx.campaignId, limit],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map(rowToFlag);
  } finally {
    conn.closeSync();
  }
}

export async function resolveContradiction(
  campaignPath: string,
  id: string,
  resolution?: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const now = new Date().toISOString();
    await conn.run(
      `UPDATE contradictions SET resolved_at = ?, resolution = ? WHERE id = ?`,
      [now, resolution ?? null, id],
    );
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run full module suite**

```bash
cd packages/core && bun test src/rag/contradictions.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rag/contradictions.ts packages/core/src/rag/contradictions.test.ts
git commit -m "feat: contradictions module — listContradictions + resolveContradiction"
```

---

### Task 5: Wire `checkEntityContradiction` into `upsertLore`

**Files:**
- Modify: `packages/core/src/rag/lore.ts:93-99` (`UpsertLoreResult` — add `contradiction?`)
- Modify: `packages/core/src/rag/lore.ts:186-239` (`resolveExisting` — add `summary` to SELECT + return)
- Modify: `packages/core/src/rag/lore.ts:258-410` (`upsertLore` — add import, check before UPDATE, extend return)
- Modify: `packages/core/src/rag/lore.test.ts` (add 2 integration tests)

**Interfaces:**
- Consumes: `checkEntityContradiction`, `ContradictionFlag` from `./contradictions.js`
- Produces: `UpsertLoreResult.contradiction?: ContradictionFlag` (returned by `upsertLore`)

- [ ] **Step 1: Write failing integration tests**

Append to `packages/core/src/rag/lore.test.ts`:

```ts
describe("upsertLore — contradiction detection", () => {
  it("returns no contradiction flag when updated summary is semantically similar", async () => {
    if (!(await ollamaAvailable())) return;

    await upsertLore(campaignDir, {
      canonical: "Elder Voss",
      type: "person",
      summary: "Elder Voss is a wise council member in Holtfen, known for fairness.",
    });

    const result = await upsertLore(campaignDir, {
      canonical: "Elder Voss",
      type: "person",
      summary: "Elder Voss is a wise and respected council member in Holtfen Settlement, known for fair judgment.",
    });

    expect(result.updated).toBe(true);
    expect(result.contradiction).toBeUndefined();
  });

  it("field 'contradiction' is present on UpsertLoreResult type (structural check)", async () => {
    if (!(await ollamaAvailable())) return;

    const result = await upsertLore(campaignDir, {
      canonical: "Structural Check Entity",
      type: "concept",
      summary: "A concept for type-checking purposes.",
    });

    // TypeScript compiler enforces contradiction?: ContradictionFlag exists on result.
    // At runtime, it should be undefined on a fresh insert (no existing entity to compare).
    expect(result.contradiction).toBeUndefined();
    // Ensure the field is truly optional (not a missing key)
    expect("contradiction" in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm TypeScript error**

```bash
cd packages/core && bun run tsc --noEmit 2>&1 | grep "contradiction" | head -5
```

Expected: TypeScript error — `contradiction` does not exist on `UpsertLoreResult`.

- [ ] **Step 3: Update `UpsertLoreResult` interface**

In `packages/core/src/rag/lore.ts`, change the `UpsertLoreResult` interface (lines 93-99):

```ts
// Before:
export interface UpsertLoreResult {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

// After:
export interface UpsertLoreResult {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
  contradiction?: ContradictionFlag;
}
```

- [ ] **Step 4: Add import at top of `lore.ts`**

After the existing imports in `packages/core/src/rag/lore.ts`, add:

```ts
import { checkEntityContradiction, type ContradictionFlag } from "./contradictions.js";
```

- [ ] **Step 5: Add `summary` to `resolveExisting`**

In `packages/core/src/rag/lore.ts`, update `resolveExisting`:

Change the return type annotation (line ~191) to add `summary: string`:
```ts
): Promise<{ id: string; slug: string; canonical: string; aliases: string[]; summary: string; metadata: string; campaign_id: string | null } | null>
```

In the non-sibling SELECT (line ~199), change:
```ts
`SELECT id, slug, canonical, aliases, metadata, campaign_id`
// →
`SELECT id, slug, canonical, aliases, summary, metadata, campaign_id`
```

In the sibling SELECT (line ~219), make the same change.

In both return objects inside the function, add:
```ts
summary: String(r["summary"] ?? ""),
```

Also update the **Case 1 UUID PK lookup** block in `upsertLore` (~line 283):

Change:
```ts
`SELECT id, slug, canonical, aliases, metadata, campaign_id
 FROM entities WHERE id = ?`
```
To:
```ts
`SELECT id, slug, canonical, aliases, summary, metadata, campaign_id
 FROM entities WHERE id = ?`
```

And in the returned object for Case 1, add:
```ts
summary: String(row["summary"] ?? ""),
```

- [ ] **Step 6: Add contradiction check before the UPDATE in `upsertLore`**

In `packages/core/src/rag/lore.ts`, locate the region around line 314 where `updated = true` is set and aliases/metadata are computed. Introduce a `let contradiction: ContradictionFlag | undefined;` variable before the if/else block, then add the check in the update path, before the `await conn.run(UPDATE ...)` statement.

The full updated if/else block (replace the second `if (existingRow !== null)` block that does the DB write, starting around line 384):

```ts
    let contradiction: ContradictionFlag | undefined;

    if (existingRow !== null) {
      // Check BEFORE overwriting the stored embedding — similarity must compare old vs new.
      const flag = await checkEntityContradiction(conn, {
        entityId,
        newEmbedding: embedding,
        existingSummary: existingRow.summary,
        incomingSummary: input.summary,
        campaignId: ctx.campaignId,
      });
      contradiction = flag ?? undefined;

      // Update — do NOT change campaign_id (canonize is a separate Phase 3 op)
      await conn.run(
        `UPDATE entities SET canonical = ?, slug = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
           content = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ? WHERE id = ?`,
        [input.canonical, entitySlug, input.type, input.summary, contentJson, metadataJson, now, entityId],
      );
    } else {
      await conn.run(
        `INSERT INTO entities
           (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
            campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, ?, ?, ${aliasesLiteral}, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
        [entityId, entitySlug, input.canonical, input.type, input.summary, contentJson, metadataJson,
         ctx.campaignId, ctx.campaignId, now, now],
      );
    }

    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "entity", entityId, input.provenance, now);
    }

    return { id: entityId, slug: entitySlug, canonical: input.canonical, aliases: mergedAliases, updated, contradiction };
```

Note: the `embedding` variable (line 263 in original) holds `number[]` from `getWorldEmbedding`. Pass it as `newEmbedding` — it's already in scope.

- [ ] **Step 7: Run integration tests**

```bash
cd packages/core && bun test src/rag/lore.test.ts --testNamePattern "contradiction"
```

Expected: both tests PASS (or skip if Ollama unavailable).

- [ ] **Step 8: Run full lore suite**

```bash
cd packages/core && bun test src/rag/lore.test.ts
```

Expected: all pre-existing tests still PASS.

- [ ] **Step 9: Typecheck**

```bash
cd packages/core && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/rag/lore.ts packages/core/src/rag/lore.test.ts
git commit -m "feat: wire checkEntityContradiction into upsertLore update path"
```

---

### Task 6: Wire `checkRelationContradiction` into `linkLore`

**Files:**
- Modify: `packages/core/src/rag/lore.ts:535-603` (`linkLore` — add check on insert path, extend return)
- Modify: `packages/core/src/rag/lore.test.ts` (add 2 integration tests)

**Interfaces:**
- Consumes: `checkRelationContradiction` from `./contradictions.js` (already imported in Task 5)
- Produces: `linkLore` return value gains optional `contradiction?: ContradictionFlag`

- [ ] **Step 1: Write failing integration tests**

Append to `packages/core/src/rag/lore.test.ts`:

```ts
describe("linkLore — contradiction detection", () => {
  it("returns a contradiction when active A→B with different label exists", async () => {
    if (!(await ollamaAvailable())) return;

    await upsertLore(campaignDir, { canonical: "Zura", type: "person", summary: "The protagonist." });
    await upsertLore(campaignDir, { canonical: "Holtfen", type: "place", summary: "A settlement in the ironlands." });

    await linkLore(campaignDir, { from: "Zura", to: "Holtfen", relation: "HOLDS_TITLE" });

    // Add a second relation on same A→B without invalidating the first
    const result = await linkLore(campaignDir, { from: "Zura", to: "Holtfen", relation: "BANISHED_FROM" });

    expect(result.contradiction).toBeDefined();
    expect(result.contradiction!.kind).toBe("relation_label_conflict");
    expect(result.contradiction!.existing_value).toBe("HOLDS_TITLE");
    expect(result.contradiction!.incoming_value).toBe("BANISHED_FROM");
  });

  it("returns no contradiction when the prior A→B relation was already invalidated", async () => {
    if (!(await ollamaAvailable())) return;

    await upsertLore(campaignDir, { canonical: "Renna", type: "person", summary: "A wanderer from the coast." });
    await upsertLore(campaignDir, { canonical: "Caldren", type: "place", summary: "A fortified city." });

    const first = await linkLore(campaignDir, { from: "Renna", to: "Caldren", relation: "GUARDS" });

    // Invalidate the prior relation explicitly (simulates declared supersession)
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      await conn.run(
        `UPDATE relations SET invalid_at = ? WHERE id = ?`,
        [new Date().toISOString(), first.relation_id],
      );
    } finally {
      conn.closeSync();
    }

    const result = await linkLore(campaignDir, { from: "Renna", to: "Caldren", relation: "EXILED_FROM" });
    expect(result.contradiction).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm TypeScript error on `result.contradiction`**

```bash
cd packages/core && bun run tsc --noEmit 2>&1 | grep "linkLore\|contradiction" | head -5
```

Expected: TypeScript error — `contradiction` does not exist on `linkLore`'s return type.

- [ ] **Step 3: Add `checkRelationContradiction` call to `linkLore`**

In `packages/core/src/rag/lore.ts`, in `linkLore`, just before the `try` block's `return` statement (around line 598), introduce `let relationContradiction: ContradictionFlag | null = null;` at the start of the `try` block.

Locate the `else` branch for inserting a new relation (around line 587). After the `INSERT INTO relations` run, add:

```ts
      relationContradiction = await checkRelationContradiction(conn, {
        fromId,
        toId,
        newLabel: input.relation,
        newRelationId: relationId,
        campaignId: ctx.campaignId,
      });
```

Update the return statement at the end of `linkLore`'s `try` block:

```ts
    return {
      from_id: fromId,
      to_id: toId,
      relation: input.relation,
      relation_id: relationId,
      ...(relationContradiction !== null && { contradiction: relationContradiction }),
    };
```

- [ ] **Step 4: Run integration tests**

```bash
cd packages/core && bun test src/rag/lore.test.ts --testNamePattern "linkLore.*contradiction"
```

Expected: both tests PASS (or skip if Ollama unavailable).

- [ ] **Step 5: Run full suites**

```bash
cd packages/core && bun test src/rag/lore.test.ts src/rag/contradictions.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck**

```bash
cd packages/core && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/lore.ts packages/core/src/rag/lore.test.ts
git commit -m "feat: wire checkRelationContradiction into linkLore insert path"
```

---

### Task 7: Export from `index.ts`

**Files:**
- Modify: `packages/core/src/index.ts` (add contradiction exports after the lore exports at line ~41)

**Interfaces:**
- Produces: `ContradictionFlag`, `checkEntityContradiction`, `checkRelationContradiction`, `listContradictions`, `resolveContradiction`, `ENTITY_CONTRADICTION_THRESHOLD` importable as `@agentic-rpg/core`

- [ ] **Step 1: Add exports**

In `packages/core/src/index.ts`, after the existing `// RAG — lore` export block (after line ~41), add:

```ts
// RAG — contradictions
export {
  checkEntityContradiction,
  checkRelationContradiction,
  listContradictions,
  resolveContradiction,
  ENTITY_CONTRADICTION_THRESHOLD,
} from "./rag/contradictions.js";
export type { ContradictionFlag } from "./rag/contradictions.js";
```

- [ ] **Step 2: Typecheck both packages**

```bash
cd packages/core && bun run tsc --noEmit
cd plugins/ironsworn/scribe && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all core tests**

```bash
cd packages/core && bun test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export contradiction types and functions from @agentic-rpg/core"
```

---

### Task 8: MCP tools + plugin version bump

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/lore.ts` (add `list_contradictions`, `resolve_contradiction`; confirm inline `contradiction` pass-through for `upsert_entity`, `upsert_lore`, `link_lore`)
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json` (minor version bump)

**Interfaces:**
- Consumes: `listContradictions`, `resolveContradiction` from `@agentic-rpg/core` (already exported in Task 7)

- [ ] **Step 1: Add imports to `scribe/src/tools/lore.ts`**

In the existing `@agentic-rpg/core` import block at the top of `plugins/ironsworn/scribe/src/tools/lore.ts`, add:

```ts
import {
  // ... existing imports ...
  listContradictions,
  resolveContradiction,
} from "@agentic-rpg/core";
```

- [ ] **Step 2: Confirm inline pass-through requires no code change**

The `upsert_entity` handler (line ~58), `upsert_lore` alias handler (~line 170), and `link_lore` handler (~line 271) all do `JSON.stringify(result)`. Since `result` from `upsertLore`/`linkLore` now carries `contradiction?: ContradictionFlag`, JSON.stringify will emit it when present. No code change needed in those handlers.

- [ ] **Step 3: Register `list_contradictions` tool**

In `plugins/ironsworn/scribe/src/tools/lore.ts`, append inside `register()` before the closing `}`:

```ts
  server.tool(
    "list_contradictions",
    "List open (unresolved) contradiction flags raised at write time. Call before canonize to see what needs adjudication.",
    {
      include_resolved: z.boolean().optional()
        .describe("Include already-resolved flags (default false)"),
      limit: z.coerce.number().int().min(1).max(100).optional()
        .describe("Max results 1–100 (default 20)"),
    },
    async ({ include_resolved, limit }) => {
      try {
        const flags = await listContradictions(campaignPath, {
          includeResolved: include_resolved ?? false,
          limit: limit ?? 20,
        });
        return { content: [{ type: "text", text: JSON.stringify(flags) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
```

- [ ] **Step 4: Register `resolve_contradiction` tool**

Append in the same location:

```ts
  server.tool(
    "resolve_contradiction",
    "Mark a contradiction flag as resolved. Call after adjudicating — e.g. after canonizing the correct version or confirming the two facts genuinely coexist.",
    {
      id: z.string().describe("UUID of the contradiction flag"),
      resolution: z.string().optional()
        .describe("Optional note on how it was resolved"),
    },
    async ({ id, resolution }) => {
      try {
        await resolveContradiction(campaignPath, id, resolution);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, id }) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
```

- [ ] **Step 5: Bump plugin version**

In `plugins/ironsworn/.claude-plugin/plugin.json`, increment the minor version: `0.33.0` → `0.34.0`.

- [ ] **Step 6: Typecheck scribe**

```bash
cd plugins/ironsworn/scribe && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
cd packages/core && bun test
cd plugins/ironsworn/scribe && bun test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/lore.ts plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "feat: add list_contradictions + resolve_contradiction MCP tools (v0.34.0)"
```
