# Lore Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, rename-resilient knowledge graph (entities + typed relationships + semantic retrieval) to scribe so a campaign world can grow organically without a fixed schema, with schema-level seams in place to evolve into a full GraphRAG system later.

**Architecture:** A new `src/rag/lore.ts` module mirroring the `src/rag/scenes.ts` pattern (DuckDB + VSS + Ollama embeddings) with three tables: `lore_entities` (stable IDs, canonical name, aliases, type, embedded summary, free-form JSON content + metadata), `lore_relations` (typed edges between entity IDs, with notes, free-form metadata, and a nullable edge embedding), and `lore_provenance` (records the source — manual, scene, extraction — behind every entity and relation). Aliases solve the rename problem; structured edges reference stable IDs. The metadata/embedding/provenance columns are populated incrementally — initial tasks leave them empty/null to keep behavior small, a dedicated later task wires them through. MCP tools live in a new `src/tools/lore.ts` registered in `server.ts`.

**Tech Stack:** TypeScript, Bun (test runner + runtime), DuckDB Node API (with `vss` extension for HNSW vector index), Ollama (`nomic-embed-text`, 768-dim), MCP SDK, Zod.

---

## File Structure

| File | Purpose |
|------|---------|
| `scribe/src/rag/lore.ts` (new) | Core lore module: types, DB init, upsert/get/search/link/graph functions |
| `scribe/src/rag/lore.test.ts` (new) | Unit + integration tests for the lore module |
| `scribe/src/tools/lore.ts` (new) | MCP tool registrations: `upsert_lore`, `get_lore`, `search_lore`, `link_lore`, `get_lore_graph` |
| `scribe/src/server.ts` (modify) | Register new lore tool module |

**Conventions followed (from existing scribe code):**
- Per-campaign DB cache via `Map<string, Promise<DuckDBInstance>>` (see `scenes.ts:27-73`)
- `mkdir(campaignPath, { recursive: true })` before opening DB
- DuckDB connection per operation, `closeSync()` in `finally`
- Embedding via Ollama at `OLLAMA_BASE_URL` env var (default `http://localhost:11434`)
- 768-dim FLOAT vectors, HNSW index with cosine metric
- Tests gracefully skip when Ollama is unreachable (`scenes.test.ts:8-17`)
- MCP tool handlers wrap try/catch returning `{ content: [{ type: "text", text: JSON.stringify(...) }] }` on success or `{ ..., isError: true }` on failure

---

## Task 1: Lore module skeleton — insert and retrieve a single entity by ID

**Files:**
- Create: `scribe/src/rag/lore.ts`
- Create: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scribe/src/rag/lore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertLore, getLore } from "./lore.js";

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/tags`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-lore-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("upsertLore + getLore", () => {
  it("creates an entity and retrieves it by ID", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron excavated from elven ruins. Tracks broken vows.",
    });
    expect(id).toBe("elven-iron");

    const entity = await getLore(campaignDir, id);
    expect(entity).not.toBeNull();
    expect(entity!.canonical).toBe("Elven Iron");
    expect(entity!.type).toBe("material");
    expect(entity!.aliases).toEqual([]);
    expect(entity!.content).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `Cannot find module './lore.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scribe/src/rag/lore.ts`:

```typescript
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LoreType =
  | "material"
  | "faction"
  | "place"
  | "concept"
  | "creature"
  | "event"
  | "truth";

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  aliases?: string[];
}

export interface UpsertLoreResult {
  id: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const _dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(`${campaignPath}/lore.duckdb`);

  const conn = await instance.connect();
  try {
    await conn.run("INSTALL vss;");
    await conn.run("LOAD vss;");

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_entities (
        id         TEXT PRIMARY KEY,
        canonical  TEXT NOT NULL,
        aliases    TEXT[] NOT NULL DEFAULT [],
        type       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '{}',
        metadata   TEXT NOT NULL DEFAULT '{}',  -- GraphRAG forward-compat: community ids, scores, etc.
        embedding  FLOAT[768] NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_embedding_idx
      ON lore_entities USING HNSW (embedding)
      WITH (metric = 'cosine')
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_relations (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        relation   TEXT NOT NULL,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',  -- GraphRAG forward-compat: extraction scores, edge weights
        embedding  FLOAT[768],                  -- nullable; populated by future edge-embedding pass
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation)
      )
    `);

    // GraphRAG forward-compat: every fact (entity or relation) can be traced
    // back to its source — manual entry, scene, document, or auto-extraction.
    // Initial tasks leave this empty for manual entries; the metadata-and-
    // provenance task wires it through.
    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_provenance (
        id           TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,            -- 'entity' | 'relation'
        subject_id   TEXT NOT NULL,            -- entity id, or "<from>|<to>|<relation>"
        source_kind  TEXT NOT NULL,            -- 'manual' | 'scene' | 'document' | 'extraction'
        source_id    TEXT,                     -- e.g. scene UUID; nullable for 'manual'
        excerpt      TEXT,                     -- the text fragment supporting this fact
        confidence   FLOAT,                    -- nullable; 1.0 implied for manual entries
        created_at   TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_provenance_subject_idx
      ON lore_provenance (subject_kind, subject_id)
    `);
  } finally {
    conn.closeSync();
  }

  return instance;
}

function getDb(campaignPath: string): Promise<DuckDBInstance> {
  const cached = _dbPromises.get(campaignPath);
  if (cached !== undefined) return cached;

  const promise = initDb(campaignPath).catch((e) => {
    _dbPromises.delete(campaignPath);
    throw e;
  });
  _dbPromises.set(campaignPath, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function getEmbedding(text: string): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: text }),
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(`Ollama unavailable at ${OLLAMA_BASE_URL}: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Ollama embed failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { embeddings: number[][] };

  if (!data.embeddings || !Array.isArray(data.embeddings[0])) {
    throw new Error("Unexpected Ollama response shape");
  }

  if (data.embeddings[0].length !== 768) {
    throw new Error(
      `Expected 768-dim embedding, got ${data.embeddings[0].length}`,
    );
  }

  if (!data.embeddings[0].every((v) => typeof v === "number" && isFinite(v))) {
    throw new Error("Invalid embedding values from Ollama");
  }

  return data.embeddings[0];
}

// ---------------------------------------------------------------------------
// Row mapping helper
// ---------------------------------------------------------------------------

function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];

  let content: Record<string, unknown> = {};
  const contentRaw = row["content"];
  if (typeof contentRaw === "string" && contentRaw.length > 0) {
    try {
      content = JSON.parse(contentRaw) as Record<string, unknown>;
    } catch {
      content = {};
    }
  }

  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }

  const [embedding, instance] = await Promise.all([
    getEmbedding(input.summary),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});
  const aliases = input.aliases ?? [];
  const aliasesLiteral = `[${aliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

  const conn = await instance.connect();
  try {
    await conn.run(
      `INSERT INTO lore_entities
         (id, canonical, aliases, type, summary, content, embedding, created_at, updated_at)
       VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
      [id, input.canonical, input.type, input.summary, contentJson, now, now],
    );
  } finally {
    conn.closeSync();
  }

  return { id, canonical: input.canonical, aliases, updated: false };
}

export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getDb(campaignPath);

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content
       FROM lore_entities
       WHERE id = ?
       LIMIT 1`,
      [identifier],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;

    return rowToEntity(rows[0]);
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS (or skip if Ollama unavailable).

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): add lore module skeleton with upsert/get by id

Introduces lore_entities, lore_relations, and lore_provenance tables
(DuckDB + VSS). Schema is GraphRAG-forward-compatible (metadata JSON
on both entity and relation tables, nullable edge embedding,
provenance table) but only the core entity insert/get loop is wired
in code yet. Adds slugify helper for stable IDs."
```

---

## Task 2: Resolve `getLore` by canonical name and alias

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts` inside the existing `describe("upsertLore + getLore", () => { ... })` block (just before the closing `});`):

```typescript
  it("resolves by canonical name (case-insensitive)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const byCanonical = await getLore(campaignDir, "Elven Iron");
    expect(byCanonical?.id).toBe("elven-iron");

    const byMixedCase = await getLore(campaignDir, "elven IRON");
    expect(byMixedCase?.id).toBe("elven-iron");
  });

  it("resolves by alias", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elven iron", "elf-iron"],
    });

    const byAlias = await getLore(campaignDir, "elven iron");
    expect(byAlias?.canonical).toBe("Veth Iron");

    const byOtherAlias = await getLore(campaignDir, "Elf-Iron");
    expect(byOtherAlias?.canonical).toBe("Veth Iron");
  });

  it("returns null when nothing matches", async () => {
    if (!(await ollamaAvailable())) return;
    const missing = await getLore(campaignDir, "nonexistent-thing");
    expect(missing).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — the canonical/alias tests fail because `getLore` only checks `id`.

- [ ] **Step 3: Update `getLore` to resolve by ID, canonical, or alias (case-insensitive)**

Replace the body of `getLore` in `scribe/src/rag/lore.ts` with:

```typescript
export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getDb(campaignPath);
  const needle = identifier.toLowerCase();

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content
       FROM lore_entities
       WHERE lower(id) = ?
          OR lower(canonical) = ?
          OR EXISTS (
               SELECT 1 FROM unnest(aliases) AS t(alias)
               WHERE lower(alias) = ?
             )
       LIMIT 1`,
      [needle, needle, needle],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;

    return rowToEntity(rows[0]);
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all four `upsertLore + getLore` cases.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): resolve getLore by canonical name and alias

getLore now matches case-insensitively against id, canonical, or any
alias. Foundation for rename-resilient lookups."
```

---

## Task 3: Upsert update path with automatic rename → alias

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts` (new `describe` block):

```typescript
describe("upsertLore — update and rename", () => {
  it("updates existing entity in place", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First version.",
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Elven Iron",
      type: "material",
      summary: "Second version with more detail.",
    });

    expect(result.updated).toBe(true);
    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.summary).toBe("Second version with more detail.");
  });

  it("moves old canonical to aliases on rename", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    expect(result.updated).toBe(true);
    expect(result.canonical).toBe("Veth Iron");
    expect(result.aliases).toContain("Elven Iron");

    // Both names still resolve
    const byOld = await getLore(campaignDir, "elven iron");
    const byNew = await getLore(campaignDir, "Veth Iron");
    expect(byOld?.id).toBe("elven-iron");
    expect(byNew?.id).toBe("elven-iron");
  });

  it("merges new aliases with existing without duplicating", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elf-iron"],
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elf-iron", "Iron of the Firstborn"],
    });

    expect(result.aliases.filter((a) => a.toLowerCase() === "elf-iron")).toHaveLength(1);
    expect(result.aliases).toContain("Iron of the Firstborn");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `upsertLore` currently does a plain INSERT and crashes on the second call with a primary key violation.

- [ ] **Step 3: Implement update + rename detection in `upsertLore`**

Replace the body of `upsertLore` in `scribe/src/rag/lore.ts` with:

```typescript
export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }

  const [embedding, instance] = await Promise.all([
    getEmbedding(input.summary),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});

  const conn = await instance.connect();
  try {
    // Look up existing entity (if any)
    const existingResult = await conn.runAndReadAll(
      `SELECT canonical, aliases FROM lore_entities WHERE id = ?`,
      [id],
    );
    const existingRows = existingResult.getRowObjectsJS() as Record<string, unknown>[];
    const existing = existingRows[0];

    // Build the merged alias list
    const incomingAliases = input.aliases ?? [];
    let mergedAliases: string[];
    let updated = false;

    if (existing) {
      updated = true;
      const oldCanonical = String(existing["canonical"] ?? "");
      const oldAliases = Array.isArray(existing["aliases"])
        ? (existing["aliases"] as unknown[]).map(String)
        : [];

      const seen = new Set<string>();
      const acc: string[] = [];
      const push = (name: string) => {
        const key = name.toLowerCase();
        if (key.length === 0) return;
        if (key === input.canonical.toLowerCase()) return; // never alias the canonical
        if (seen.has(key)) return;
        seen.add(key);
        acc.push(name);
      };

      for (const a of oldAliases) push(a);
      if (oldCanonical.length > 0 && oldCanonical !== input.canonical) {
        push(oldCanonical);
      }
      for (const a of incomingAliases) push(a);

      mergedAliases = acc;
    } else {
      const seen = new Set<string>();
      mergedAliases = [];
      for (const a of incomingAliases) {
        const key = a.toLowerCase();
        if (key.length === 0 || key === input.canonical.toLowerCase()) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedAliases.push(a);
      }
    }

    const aliasesLiteral = `[${mergedAliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

    if (existing) {
      await conn.run(
        `UPDATE lore_entities
         SET canonical = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
             content = ?, embedding = ${embeddingLiteral}, updated_at = ?
         WHERE id = ?`,
        [input.canonical, input.type, input.summary, contentJson, now, id],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_entities
           (id, canonical, aliases, type, summary, content, embedding, created_at, updated_at)
         VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
        [id, input.canonical, input.type, input.summary, contentJson, now, now],
      );
    }

    return { id, canonical: input.canonical, aliases: mergedAliases, updated };
  } finally {
    conn.closeSync();
  }
}
```

Also update the first test in Task 1 — the assertion `expect(entity!.aliases).toEqual([])` is still correct for the first-create case since no aliases were provided.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all `upsertLore` cases including the rename scenarios.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): support lore update and rename via alias migration

Renaming an entity (changing canonical) now appends the old name to
aliases automatically. Aliases dedup case-insensitively and never
duplicate the canonical name."
```

---

## Task 4: Semantic search via `searchLore`

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts`:

```typescript
import { searchLore } from "./lore.js";

describe("searchLore", () => {
  it("returns ranked entities by semantic similarity", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron excavated from elven ruins. Tracks broken vows.",
    });
    await upsertLore(campaignDir, {
      canonical: "Tempest Hills",
      type: "place",
      summary: "Windswept highlands in the western Ironlands.",
    });

    const results = await searchLore(campaignDir, "metal used for oaths", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].canonical).toBe("Elven Iron");
  });

  it("filters by type when provided", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "A material used in vows.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    const onlyMaterials = await searchLore(campaignDir, "iron", 5, "material");
    expect(onlyMaterials.every((r) => r.type === "material")).toBe(true);
  });

  it("returns empty array when no entities exist", async () => {
    if (!(await ollamaAvailable())) return;
    const results = await searchLore(campaignDir, "anything", 5);
    expect(results).toEqual([]);
  });
});
```

Update the existing import at the top of the file to add `searchLore` (or keep the additional import where it is — Bun handles either fine).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `searchLore` is not exported.

- [ ] **Step 3: Implement `searchLore`**

Add to `scribe/src/rag/lore.ts`:

```typescript
export interface LoreSearchHit {
  id: string;
  canonical: string;
  type: LoreType;
  summary: string;
  score: number;
}

export async function searchLore(
  campaignPath: string,
  query: string,
  k = 5,
  type?: LoreType,
): Promise<LoreSearchHit[]> {
  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    const sql = type
      ? `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities
         WHERE type = ?
         ORDER BY score DESC
         LIMIT ?`
      : `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities
         ORDER BY score DESC
         LIMIT ?`;

    const params = type ? [type, k] : [k];
    const result = await conn.runAndReadAll(sql, params);
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      canonical: String(row["canonical"] ?? ""),
      type: String(row["type"] ?? "concept") as LoreType,
      summary: String(row["summary"] ?? ""),
      score:
        typeof row["score"] === "number"
          ? row["score"]
          : typeof row["score"] === "bigint"
            ? Number(row["score"])
            : 0,
    }));
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all `searchLore` cases.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): add semantic search over lore entities

searchLore embeds the query and ranks entities by cosine similarity
on the HNSW index. Optional type filter for narrowing results."
```

---

## Task 5: Typed relationships via `linkLore` and `getLore` with relations

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts`:

```typescript
import { linkLore } from "./lore.js";

describe("linkLore + getLore relations", () => {
  it("creates a typed relation between two entities", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    await linkLore(campaignDir, {
      from: "Iron Vow",
      to: "elven-iron",
      relation: "sworn_on",
      notes: "The metal that binds the oath.",
    });

    const vow = await getLore(campaignDir, "iron-vow");
    expect(vow?.relations).toBeDefined();
    expect(vow!.relations).toHaveLength(1);
    const rel = vow!.relations![0];
    expect(rel.direction).toBe("from");
    expect(rel.relation).toBe("sworn_on");
    expect(rel.entity.canonical).toBe("Elven Iron");
    expect(rel.notes).toBe("The metal that binds the oath.");
  });

  it("shows incoming relations on the target", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });
    await linkLore(campaignDir, {
      from: "Iron Vow",
      to: "Elven Iron",
      relation: "sworn_on",
    });

    const iron = await getLore(campaignDir, "elven-iron");
    expect(iron!.relations).toHaveLength(1);
    expect(iron!.relations![0].direction).toBe("to");
    expect(iron!.relations![0].entity.canonical).toBe("Iron Vow");
  });

  it("resolves from/to identifiers via aliases", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elven iron"],
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    await linkLore(campaignDir, {
      from: "iron vow",
      to: "elven iron", // alias
      relation: "sworn_on",
    });

    const iron = await getLore(campaignDir, "veth-iron");
    expect(iron!.relations).toHaveLength(1);
  });

  it("ignores duplicate relations (idempotent)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });

    await linkLore(campaignDir, { from: "a", to: "b", relation: "rel" });
    await linkLore(campaignDir, { from: "a", to: "b", relation: "rel" });

    const a = await getLore(campaignDir, "a");
    expect(a!.relations).toHaveLength(1);
  });

  it("throws when an endpoint cannot be resolved", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await expect(
      linkLore(campaignDir, { from: "a", to: "missing", relation: "rel" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `linkLore` not exported and `LoreEntity.relations` does not exist.

- [ ] **Step 3: Add relations support**

In `scribe/src/rag/lore.ts`:

(a) Extend `LoreEntity` and add helper interfaces:

```typescript
export interface LoreRelation {
  direction: "from" | "to";
  relation: string;
  entity: { id: string; canonical: string; type: LoreType };
  notes?: string;
}

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  relations?: LoreRelation[];
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
}
```

(b) Add an internal helper `resolveId` that turns any identifier (id/canonical/alias) into the stable id, throwing if not found:

```typescript
async function resolveId(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  identifier: string,
): Promise<string> {
  const needle = identifier.toLowerCase();
  const result = await conn.runAndReadAll(
    `SELECT id FROM lore_entities
     WHERE lower(id) = ?
        OR lower(canonical) = ?
        OR EXISTS (
             SELECT 1 FROM unnest(aliases) AS t(alias)
             WHERE lower(alias) = ?
           )
     LIMIT 1`,
    [needle, needle, needle],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(`Lore entity not found: "${identifier}"`);
  }
  return String(rows[0]["id"]);
}
```

(c) Implement `linkLore`:

```typescript
export async function linkLore(
  campaignPath: string,
  input: LinkLoreInput,
): Promise<{ from_id: string; to_id: string; relation: string }> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const fromId = await resolveId(conn, input.from);
    const toId = await resolveId(conn, input.to);
    const now = new Date().toISOString();

    await conn.run(
      `INSERT INTO lore_relations (from_id, to_id, relation, notes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, relation) DO NOTHING`,
      [fromId, toId, input.relation, input.notes ?? null, now],
    );

    return { from_id: fromId, to_id: toId, relation: input.relation };
  } finally {
    conn.closeSync();
  }
}
```

(d) Extend `getLore` to fetch relations:

```typescript
export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getDb(campaignPath);
  const needle = identifier.toLowerCase();

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content
       FROM lore_entities
       WHERE lower(id) = ?
          OR lower(canonical) = ?
          OR EXISTS (
               SELECT 1 FROM unnest(aliases) AS t(alias)
               WHERE lower(alias) = ?
             )
       LIMIT 1`,
      [needle, needle, needle],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;

    const entity = rowToEntity(rows[0]);

    // Outgoing
    const outgoing = await conn.runAndReadAll(
      `SELECT r.relation, r.notes,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r
       JOIN lore_entities e ON e.id = r.to_id
       WHERE r.from_id = ?`,
      [entity.id],
    );

    // Incoming
    const incoming = await conn.runAndReadAll(
      `SELECT r.relation, r.notes,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r
       JOIN lore_entities e ON e.id = r.from_id
       WHERE r.to_id = ?`,
      [entity.id],
    );

    const relations: LoreRelation[] = [];
    for (const row of outgoing.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "from",
        relation: String(row["relation"]),
        entity: {
          id: String(row["other_id"]),
          canonical: String(row["other_canonical"]),
          type: String(row["other_type"]) as LoreType,
        },
        notes: row["notes"] ? String(row["notes"]) : undefined,
      });
    }
    for (const row of incoming.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "to",
        relation: String(row["relation"]),
        entity: {
          id: String(row["other_id"]),
          canonical: String(row["other_canonical"]),
          type: String(row["other_type"]) as LoreType,
        },
        notes: row["notes"] ? String(row["notes"]) : undefined,
      });
    }

    entity.relations = relations;
    return entity;
  } finally {
    conn.closeSync();
  }
}
```

Note: the earlier Task 1 test asserts `entity!.aliases` and `entity!.content` but does not assert on `relations`. With the new code those tests still pass (`relations` is `[]` for an entity with no edges, optional in the interface).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all relation cases.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): typed relations between lore entities

linkLore creates idempotent edges between entities resolved by any
identifier (id/canonical/alias). getLore now returns both incoming
and outgoing relations on the target entity."
```

---

## Task 6: Multi-hop graph traversal via `getLoreGraph`

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts`:

```typescript
import { getLoreGraph } from "./lore.js";

describe("getLoreGraph", () => {
  it("returns root + immediate neighbors at depth 1", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await upsertLore(campaignDir, { canonical: "C", type: "concept", summary: "c" });
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await linkLore(campaignDir, { from: "B", to: "C", relation: "rel" });

    const graph = await getLoreGraph(campaignDir, "A", 1);
    expect(graph.root.id).toBe("a");
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(false);
    expect(graph.edges).toHaveLength(1);
  });

  it("traverses to depth 2", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await upsertLore(campaignDir, { canonical: "C", type: "concept", summary: "c" });
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await linkLore(campaignDir, { from: "B", to: "C", relation: "rel" });

    const graph = await getLoreGraph(campaignDir, "A", 2);
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
    expect(graph.edges).toHaveLength(2);
  });

  it("returns null when root cannot be resolved", async () => {
    if (!(await ollamaAvailable())) return;
    const graph = await getLoreGraph(campaignDir, "nope", 1);
    expect(graph).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `getLoreGraph` not exported.

- [ ] **Step 3: Implement `getLoreGraph`**

Add to `scribe/src/rag/lore.ts`:

```typescript
export interface LoreGraph {
  root: LoreEntity;
  nodes: LoreEntity[];
  edges: Array<{
    from_id: string;
    to_id: string;
    relation: string;
    notes?: string;
  }>;
}

export async function getLoreGraph(
  campaignPath: string,
  identifier: string,
  depth = 1,
): Promise<LoreGraph | null> {
  if (depth < 1) {
    throw new Error("getLoreGraph depth must be >= 1");
  }

  const root = await getLore(campaignPath, identifier);
  if (root === null) return null;

  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const visited = new Set<string>([root.id]);
    let frontier = new Set<string>([root.id]);
    const edges: LoreGraph["edges"] = [];

    for (let hop = 0; hop < depth; hop++) {
      if (frontier.size === 0) break;

      const placeholders = Array.from(frontier).map(() => "?").join(",");
      const params = Array.from(frontier);

      const result = await conn.runAndReadAll(
        `SELECT from_id, to_id, relation, notes
         FROM lore_relations
         WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
        [...params, ...params],
      );

      const next = new Set<string>();
      for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
        const fromId = String(row["from_id"]);
        const toId = String(row["to_id"]);
        const relation = String(row["relation"]);
        const notes = row["notes"] ? String(row["notes"]) : undefined;

        const edgeKey = `${fromId}|${toId}|${relation}`;
        if (!edges.some((e) => `${e.from_id}|${e.to_id}|${e.relation}` === edgeKey)) {
          edges.push({ from_id: fromId, to_id: toId, relation, notes });
        }

        for (const id of [fromId, toId]) {
          if (!visited.has(id)) {
            visited.add(id);
            next.add(id);
          }
        }
      }

      frontier = next;
    }

    // Fetch all visited entities (without their relations to keep payload small)
    const allIds = Array.from(visited);
    const placeholders = allIds.map(() => "?").join(",");
    const nodesResult = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content
       FROM lore_entities
       WHERE id IN (${placeholders})`,
      allIds,
    );
    const nodes = (nodesResult.getRowObjectsJS() as Record<string, unknown>[]).map(
      rowToEntity,
    );

    return { root, nodes, edges };
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all `getLoreGraph` cases.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): multi-hop graph traversal via getLoreGraph

BFS expansion of edges from a root entity to a configurable depth.
Returns root, node set, and edge set for visualization or context
building."
```

---

## Task 7: Metadata and provenance support (GraphRAG forward-compat)

**Files:**
- Modify: `scribe/src/rag/lore.ts`
- Modify: `scribe/src/rag/lore.test.ts`

**Why:** The schema already has `metadata` columns on entities and relations and a `lore_provenance` table (Task 1). This task wires those columns through the API so callers can attach arbitrary metadata (community IDs, extraction confidence, anything) and source provenance (this fact came from scene X, or this is a manual entry) to every fact. Future GraphRAG layers — entity extraction, community detection, hybrid retrieval — will read and write through these channels without further migrations.

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts`:

```typescript
import { listProvenance } from "./lore.js";

describe("metadata", () => {
  it("stores and returns metadata on entities", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      metadata: { community: "iron-economy", confidence: 0.92 },
    });

    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.metadata).toEqual({ community: "iron-economy", confidence: 0.92 });
  });

  it("preserves metadata across rename when not overwritten", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      metadata: { community: "iron-economy" },
    });

    // Rename without supplying metadata — existing metadata should remain
    await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const entity = await getLore(campaignDir, "veth-iron");
    expect(entity?.metadata).toEqual({ community: "iron-economy" });
  });

  it("stores metadata on relations", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await linkLore(campaignDir, {
      from: "a",
      to: "b",
      relation: "rel",
      metadata: { weight: 0.7 },
    });

    const a = await getLore(campaignDir, "a");
    expect(a!.relations![0].metadata).toEqual({ weight: 0.7 });
  });
});

describe("provenance", () => {
  it("records manual provenance by default for new entities", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const entries = await listProvenance(campaignDir, "entity", "elven-iron");
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("manual");
  });

  it("records explicit provenance with source and excerpt", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      provenance: {
        source_kind: "scene",
        source_id: "scene-uuid-123",
        excerpt: "She found the metal in the dig.",
        confidence: 0.85,
      },
    });

    const entries = await listProvenance(campaignDir, "entity", "elven-iron");
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("scene");
    expect(entries[0].source_id).toBe("scene-uuid-123");
    expect(entries[0].excerpt).toBe("She found the metal in the dig.");
    expect(entries[0].confidence).toBeCloseTo(0.85);
  });

  it("appends a new provenance entry on update (history retained)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First.",
      provenance: { source_kind: "manual" },
    });
    await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Elven Iron",
      type: "material",
      summary: "Second.",
      provenance: { source_kind: "scene", source_id: "s-1" },
    });

    const entries = await listProvenance(campaignDir, "entity", "elven-iron");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => e.source_kind).sort()).toEqual(["manual", "scene"]);
  });

  it("records provenance for relations using composite subject id", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await linkLore(campaignDir, {
      from: "a",
      to: "b",
      relation: "rel",
      provenance: { source_kind: "manual" },
    });

    const entries = await listProvenance(campaignDir, "relation", "a|b|rel");
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("manual");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: FAIL — `listProvenance` not exported, `metadata` parameter on `upsertLore`/`linkLore` ignored, `LoreEntity.metadata` and `LoreRelation.metadata` not surfaced.

- [ ] **Step 3: Wire metadata + provenance through the API**

In `scribe/src/rag/lore.ts`:

(a) Add the new types and extend existing ones:

```typescript
export interface ProvenanceInput {
  source_kind: "manual" | "scene" | "document" | "extraction";
  source_id?: string;
  excerpt?: string;
  confidence?: number;
}

export interface ProvenanceEntry {
  id: string;
  subject_kind: "entity" | "relation";
  subject_id: string;
  source_kind: string;
  source_id: string | null;
  excerpt: string | null;
  confidence: number | null;
  created_at: string;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;       // NEW
  aliases?: string[];
  provenance?: ProvenanceInput;             // NEW
}

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;        // NEW (always present, defaults to {})
  relations: LoreRelation[];                // non-optional: getLore always populates ([] if no edges)
}

export interface LoreRelation {
  direction: "from" | "to";
  relation: string;
  entity: { id: string; canonical: string; type: LoreType };
  notes?: string;
  metadata: Record<string, unknown>;        // NEW (always present, defaults to {})
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
  metadata?: Record<string, unknown>;       // NEW
  provenance?: ProvenanceInput;             // NEW
}
```

(b) Add a small JSON-parse helper used by both rows-to-entity and rows-to-relation paths (place it next to `rowToEntity`):

```typescript
function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
```

Then update `rowToEntity` to use it and to populate `metadata`:

```typescript
function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];

  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content: parseJsonObject(row["content"]),
    metadata: parseJsonObject(row["metadata"]),
  };
}
```

(c) Add an internal helper to insert a provenance row:

```typescript
async function recordProvenance(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  subjectKind: "entity" | "relation",
  subjectId: string,
  prov: ProvenanceInput | undefined,
): Promise<void> {
  const effective: ProvenanceInput = prov ?? { source_kind: "manual" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO lore_provenance
       (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      subjectKind,
      subjectId,
      effective.source_kind,
      effective.source_id ?? null,
      effective.excerpt ?? null,
      effective.confidence ?? null,
      now,
    ],
  );
}
```

(d) Update `upsertLore` to read/write `metadata` and append provenance. Replace the `upsertLore` body so the SELECT/INSERT/UPDATE all handle metadata, and so a provenance row is always recorded:

```typescript
export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }

  const [embedding, instance] = await Promise.all([
    getEmbedding(input.summary),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});

  const conn = await instance.connect();
  try {
    const existingResult = await conn.runAndReadAll(
      `SELECT canonical, aliases, metadata FROM lore_entities WHERE id = ?`,
      [id],
    );
    const existingRows = existingResult.getRowObjectsJS() as Record<string, unknown>[];
    const existing = existingRows[0];

    const incomingAliases = input.aliases ?? [];
    let mergedAliases: string[];
    let metadataJson: string;
    let updated = false;

    if (existing) {
      updated = true;
      const oldCanonical = String(existing["canonical"] ?? "");
      const oldAliases = Array.isArray(existing["aliases"])
        ? (existing["aliases"] as unknown[]).map(String)
        : [];

      const seen = new Set<string>();
      const acc: string[] = [];
      const push = (name: string) => {
        const key = name.toLowerCase();
        if (key.length === 0) return;
        if (key === input.canonical.toLowerCase()) return;
        if (seen.has(key)) return;
        seen.add(key);
        acc.push(name);
      };
      for (const a of oldAliases) push(a);
      if (oldCanonical.length > 0 && oldCanonical !== input.canonical) {
        push(oldCanonical);
      }
      for (const a of incomingAliases) push(a);
      mergedAliases = acc;

      // Metadata: incoming wins if provided; otherwise preserve existing.
      if (input.metadata !== undefined) {
        metadataJson = JSON.stringify(input.metadata);
      } else {
        metadataJson = typeof existing["metadata"] === "string"
          ? (existing["metadata"] as string)
          : "{}";
      }
    } else {
      const seen = new Set<string>();
      mergedAliases = [];
      for (const a of incomingAliases) {
        const key = a.toLowerCase();
        if (key.length === 0 || key === input.canonical.toLowerCase()) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedAliases.push(a);
      }
      metadataJson = JSON.stringify(input.metadata ?? {});
    }

    const aliasesLiteral = `[${mergedAliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

    if (existing) {
      await conn.run(
        `UPDATE lore_entities
         SET canonical = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
             content = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ?
         WHERE id = ?`,
        [input.canonical, input.type, input.summary, contentJson, metadataJson, now, id],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_entities
           (id, canonical, aliases, type, summary, content, metadata, embedding, created_at, updated_at)
         VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
        [id, input.canonical, input.type, input.summary, contentJson, metadataJson, now, now],
      );
    }

    await recordProvenance(conn, "entity", id, input.provenance);

    return { id, canonical: input.canonical, aliases: mergedAliases, updated };
  } finally {
    conn.closeSync();
  }
}
```

(e) Update `linkLore` to write metadata and append provenance:

```typescript
export async function linkLore(
  campaignPath: string,
  input: LinkLoreInput,
): Promise<{ from_id: string; to_id: string; relation: string }> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const fromId = await resolveId(conn, input.from);
    const toId = await resolveId(conn, input.to);
    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(input.metadata ?? {});

    await conn.run(
      `INSERT INTO lore_relations (from_id, to_id, relation, notes, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, relation) DO UPDATE SET
         notes = COALESCE(EXCLUDED.notes, lore_relations.notes),
         metadata = EXCLUDED.metadata`,
      [fromId, toId, input.relation, input.notes ?? null, metadataJson, now],
    );

    await recordProvenance(
      conn,
      "relation",
      `${fromId}|${toId}|${input.relation}`,
      input.provenance,
    );

    return { from_id: fromId, to_id: toId, relation: input.relation };
  } finally {
    conn.closeSync();
  }
}
```

(f) Update `getLore` so the relation queries include `metadata`. In both the outgoing and incoming relation SELECTs, replace the column list and the row mapping. The two relation SELECTs become:

```typescript
const outgoing = await conn.runAndReadAll(
  `SELECT r.relation, r.notes, r.metadata,
          e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
   FROM lore_relations r
   JOIN lore_entities e ON e.id = r.to_id
   WHERE r.from_id = ?`,
  [entity.id],
);

const incoming = await conn.runAndReadAll(
  `SELECT r.relation, r.notes, r.metadata,
          e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
   FROM lore_relations r
   JOIN lore_entities e ON e.id = r.from_id
   WHERE r.to_id = ?`,
  [entity.id],
);
```

And the two `relations.push({ ... })` calls each gain `metadata: parseJsonObject(row["metadata"])`:

```typescript
for (const row of outgoing.getRowObjectsJS() as Record<string, unknown>[]) {
  relations.push({
    direction: "from",
    relation: String(row["relation"]),
    entity: {
      id: String(row["other_id"]),
      canonical: String(row["other_canonical"]),
      type: String(row["other_type"]) as LoreType,
    },
    notes: row["notes"] ? String(row["notes"]) : undefined,
    metadata: parseJsonObject(row["metadata"]),
  });
}
for (const row of incoming.getRowObjectsJS() as Record<string, unknown>[]) {
  relations.push({
    direction: "to",
    relation: String(row["relation"]),
    entity: {
      id: String(row["other_id"]),
      canonical: String(row["other_canonical"]),
      type: String(row["other_type"]) as LoreType,
    },
    notes: row["notes"] ? String(row["notes"]) : undefined,
    metadata: parseJsonObject(row["metadata"]),
  });
}
```

(g) Update the SELECT in `getLore` to include `metadata` so `rowToEntity` can populate it:

```typescript
const result = await conn.runAndReadAll(
  `SELECT id, canonical, aliases, type, summary, content, metadata
   FROM lore_entities
   WHERE lower(id) = ?
      OR lower(canonical) = ?
      OR EXISTS (
           SELECT 1 FROM unnest(aliases) AS t(alias)
           WHERE lower(alias) = ?
         )
   LIMIT 1`,
  [needle, needle, needle],
);
```

Apply the same SELECT-list update to the node fetch in `getLoreGraph` (the `WHERE id IN (${placeholders})` query) so graph nodes also include metadata:

```typescript
const nodesResult = await conn.runAndReadAll(
  `SELECT id, canonical, aliases, type, summary, content, metadata
   FROM lore_entities
   WHERE id IN (${placeholders})`,
  allIds,
);
```

(h) Add the `listProvenance` function:

```typescript
export async function listProvenance(
  campaignPath: string,
  subjectKind: "entity" | "relation",
  subjectId: string,
): Promise<ProvenanceEntry[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id,
              excerpt, confidence, created_at
       FROM lore_provenance
       WHERE subject_kind = ? AND subject_id = ?
       ORDER BY created_at ASC`,
      [subjectKind, subjectId],
    );

    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]),
      subject_kind: String(row["subject_kind"]) as "entity" | "relation",
      subject_id: String(row["subject_id"]),
      source_kind: String(row["source_kind"]),
      source_id: row["source_id"] ? String(row["source_id"]) : null,
      excerpt: row["excerpt"] ? String(row["excerpt"]) : null,
      confidence:
        typeof row["confidence"] === "number"
          ? row["confidence"]
          : typeof row["confidence"] === "bigint"
            ? Number(row["confidence"])
            : null,
      created_at: String(row["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS for all `metadata` and `provenance` cases. Earlier tests (Tasks 1–6) should still pass — `metadata` defaults to `{}` and provenance is appended automatically with `source_kind = 'manual'`.

- [ ] **Step 5: Commit**

```bash
git add scribe/src/rag/lore.ts scribe/src/rag/lore.test.ts
git commit -m "feat(scribe): metadata and provenance support on lore graph

Wires the metadata column on entities and relations through the API
(input + output) so future GraphRAG layers can attach community ids,
confidence scores, edge weights, etc. without further migrations.

Adds an automatic provenance entry per upsert/link, defaulting to
source_kind='manual' but accepting explicit scene/document/extraction
sources with excerpt and confidence. listProvenance retrieves the
history of any subject (entity or relation)."
```

---

## Task 8: MCP tool wiring — `scribe/src/tools/lore.ts`

**Files:**
- Create: `scribe/src/tools/lore.ts`

- [ ] **Step 1: Write the file**

Create `scribe/src/tools/lore.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  upsertLore,
  getLore,
  searchLore,
  linkLore,
  getLoreGraph,
  type LoreType,
} from "../rag/lore.js";

const LORE_TYPES = [
  "material",
  "faction",
  "place",
  "concept",
  "creature",
  "event",
  "truth",
] as const;

export function register(server: McpServer, campaignPath: string): void {
  const provenanceSchema = z
    .object({
      source_kind: z.enum(["manual", "scene", "document", "extraction"]),
      source_id: z.string().optional(),
      excerpt: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .describe("Source of this fact (manual, scene, document, extraction). Defaults to 'manual' if omitted.");

  server.tool(
    "upsert_lore",
    "Create or update a lore entity. On rename (changed canonical), the old name is automatically appended to aliases.",
    {
      id: z.string().optional().describe("Stable ID; derived from canonical name if omitted"),
      canonical: z.string().describe("Current display name"),
      type: z.enum(LORE_TYPES).describe("Entity type"),
      summary: z.string().describe("Prose description; will be embedded for semantic search"),
      content: z.record(z.string(), z.unknown()).optional().describe("Flexible JSON properties"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("GraphRAG metadata: community ids, scores, etc."),
      aliases: z.array(z.string()).optional().describe("Additional aliases to merge in"),
      provenance: provenanceSchema.optional(),
    },
    async (input) => {
      try {
        const result = await upsertLore(campaignPath, {
          ...input,
          type: input.type as LoreType,
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_lore",
    "Retrieve a lore entity by id, canonical name, or any alias (case-insensitive). Includes incoming and outgoing relations.",
    {
      identifier: z.string().describe("ID, canonical name, or alias"),
    },
    async ({ identifier }) => {
      try {
        const entity = await getLore(campaignPath, identifier);
        return {
          content: [{ type: "text", text: entity ? JSON.stringify(entity) : "Lore not found" }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "search_lore",
    "Semantic search over lore entity summaries. Returns ranked matches.",
    {
      query: z.string().describe("Search query"),
      type: z.enum(LORE_TYPES).optional().describe("Optional type filter"),
      k: z.number().int().positive().optional().describe("Number of results (default 5)"),
    },
    async ({ query, type, k }) => {
      try {
        const results = await searchLore(campaignPath, query, k ?? 5, type as LoreType | undefined);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "link_lore",
    "Create a typed relationship between two lore entities. Idempotent on (from, to, relation).",
    {
      from: z.string().describe("Source entity (id, canonical, or alias)"),
      to: z.string().describe("Target entity (id, canonical, or alias)"),
      relation: z.string().describe("Relationship type (free-form, e.g. 'sworn_on', 'corrupts')"),
      notes: z.string().optional().describe("Optional prose context"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("GraphRAG metadata: edge weight, extraction scores, etc."),
      provenance: provenanceSchema.optional(),
    },
    async ({ from, to, relation, notes, metadata, provenance }) => {
      try {
        const result = await linkLore(campaignPath, { from, to, relation, notes, metadata, provenance });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_lore_graph",
    "Get a lore entity and its connected entities up to N hops away.",
    {
      identifier: z.string().describe("Root entity (id, canonical, or alias)"),
      depth: z.number().int().positive().optional().describe("Number of hops to traverse (default 1)"),
    },
    async ({ identifier, depth }) => {
      try {
        const graph = await getLoreGraph(campaignPath, identifier, depth ?? 1);
        return {
          content: [{ type: "text", text: graph ? JSON.stringify(graph) : "Lore not found" }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd scribe && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scribe/src/tools/lore.ts
git commit -m "feat(scribe): MCP tools for lore knowledge graph

Adds upsert_lore, get_lore, search_lore, link_lore, get_lore_graph
as thin wrappers over src/rag/lore.ts with Zod schemas."
```

---

## Task 9: Wire lore tools into the server

**Files:**
- Modify: `scribe/src/server.ts`

- [ ] **Step 1: Add the import and registration**

Edit `scribe/src/server.ts`. Add after line 6 (`import * as narrativeTools ...`):

```typescript
import * as loreTools from "./tools/lore.js";
```

Add after line 18 (`narrativeTools.register(server, CAMPAIGN_PATH);`):

```typescript
loreTools.register(server, CAMPAIGN_PATH);
```

The full file should look like:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as readTools from "./tools/read.js";
import * as mechanicsTools from "./tools/mechanics.js";
import * as mutationsTools from "./tools/mutations.js";
import * as narrativeTools from "./tools/narrative.js";
import * as loreTools from "./tools/lore.js";

const CAMPAIGN_PATH = process.env.SCRIBE_CAMPAIGN ?? "campaigns/default";

const server = new McpServer({
  name: "scribe",
  version: "0.0.1",
});

readTools.register(server, CAMPAIGN_PATH);
mechanicsTools.register(server, CAMPAIGN_PATH);
mutationsTools.register(server, CAMPAIGN_PATH);
narrativeTools.register(server, CAMPAIGN_PATH);
loreTools.register(server, CAMPAIGN_PATH);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Verify it typechecks and starts**

```bash
cd scribe && bun run typecheck
```

Expected: no errors.

```bash
cd scribe && timeout 2 bun run start || true
```

Expected: server starts with no immediate error (it will wait on stdio and be killed by timeout, which is fine).

- [ ] **Step 3: Commit**

```bash
git add scribe/src/server.ts
git commit -m "feat(scribe): register lore MCP tools in server"
```

---

## Task 10: End-to-end rename integration test

**Files:**
- Modify: `scribe/src/rag/lore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `scribe/src/rag/lore.test.ts`:

```typescript
describe("integration: rename preserves graph", () => {
  it("renaming an entity keeps relations intact and resolves both names", async () => {
    if (!(await ollamaAvailable())) return;

    // Build a small graph using the original name
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });
    await upsertLore(campaignDir, {
      canonical: "The Elves",
      type: "faction",
      summary: "Feral Firstborn.",
    });
    await linkLore(campaignDir, { from: "Iron Vow", to: "Elven Iron", relation: "sworn_on" });
    await linkLore(campaignDir, { from: "The Elves", to: "Elven Iron", relation: "left_behind" });

    // Rename
    await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    // Resolution by both names still works
    const byNew = await getLore(campaignDir, "Veth Iron");
    const byOld = await getLore(campaignDir, "Elven Iron");
    expect(byNew?.id).toBe("elven-iron");
    expect(byOld?.id).toBe("elven-iron");
    expect(byNew?.canonical).toBe("Veth Iron");
    expect(byNew?.aliases).toContain("Elven Iron");

    // Relations survive the rename — both incoming edges are still there
    expect(byNew?.relations).toHaveLength(2);
    const incomingFromIds = byNew!.relations!
      .filter((r) => r.direction === "to")
      .map((r) => r.entity.id)
      .sort();
    expect(incomingFromIds).toEqual(["iron-vow", "the-elves"]);

    // Graph traversal works from either name
    const graphByNew = await getLoreGraph(campaignDir, "Veth Iron", 1);
    const graphByOld = await getLoreGraph(campaignDir, "Elven Iron", 1);
    expect(graphByNew?.nodes.length).toBe(graphByOld?.nodes.length);
    expect(graphByNew?.edges.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd scribe && bun test src/rag/lore.test.ts
```

Expected: PASS — all prior tasks together should make this work without further code changes.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

```bash
cd scribe && bun test
```

Expected: all tests pass (or skip when Ollama unavailable).

- [ ] **Step 4: Commit**

```bash
git add scribe/src/rag/lore.test.ts
git commit -m "test(scribe): integration test — rename preserves lore graph

End-to-end check that renaming a lore entity keeps stable IDs in
relations, retains both names in the resolver, and surfaces the
same neighbourhood from getLoreGraph regardless of which name is
used as the root."
```

---

## Summary of Deliverables

After all tasks:

- `scribe/src/rag/lore.ts` — types, schema init, slugify, upsertLore, getLore, searchLore, linkLore, getLoreGraph, listProvenance
- `scribe/src/rag/lore.test.ts` — unit + integration coverage including metadata, provenance, and rename scenarios
- `scribe/src/tools/lore.ts` — five MCP tools registered against the lore module, with optional metadata + provenance on writes
- `scribe/src/server.ts` — wires the new tool module
- Per-campaign DB file: `<campaign>/lore.duckdb` (auto-created), schema includes `lore_entities`, `lore_relations`, `lore_provenance`

**GraphRAG forward-compatibility built in:**

| Capability | Where it lives | Status |
|------------|----------------|--------|
| Free-form entity types & relation labels | TEXT columns, no enums in storage | ✅ Day one |
| Stable IDs across renames | Slug-based `id` referenced by edges | ✅ Day one |
| Per-fact metadata (community ids, scores, weights) | `metadata JSON` on entities and relations | ✅ Task 7 |
| Source provenance (manual, scene, document, extraction) | `lore_provenance` table | ✅ Task 7 |
| Edge embeddings | Nullable `embedding FLOAT[768]` on `lore_relations` | 🟡 Column reserved, populated later |
| Community detection | Stored as `metadata.community` on entities | 🟡 No tooling yet, no migration needed |
| Auto-extraction pipeline | Reads scenes, writes via `upsert_lore` + `link_lore` with `provenance.source_kind = 'extraction'` | 🟡 Future task; no schema work needed |
| Hierarchical summaries | Could be a new table or a `type='community'` entity | 🟡 Deferred — pattern fits existing schema |

The session-zero world truths and the Zura Rhian campaign world we built earlier can then be recorded as `truth`-typed entities (one per topic) and linked to each other via `lore_relations` — that's the natural follow-up after this plan ships. When a future GraphRAG pass auto-extracts entities from scene text, it writes through the same MCP tools with `provenance.source_kind = 'extraction'` and an `excerpt` — no schema migration, no API changes.
