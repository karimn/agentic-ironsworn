# Point-of-Entry Structured Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the GM record world canon (entities + relations) on the beat at narration time, via `record_beat`, instead of reconstructing it from prose with batch extraction.

**Architecture:** A new core function `recordBeatCanon` resolves entity/relation names against the existing graph (exact-match reuse via `getLore`, else create) and writes them with beat provenance — the back half of `extractLoreFromScene` without the LLM. It rides the existing async beat queue: `BeatInput` gains optional `entities`/`relations`, the queue worker calls `recordBeatCanon` after writing the beat, and skipped items surface through the existing notice channel. The `record_beat` MCP tool gains the two params. Prompts make recording a habit; `extract_session_lore` is reframed as optional backfill.

**Tech Stack:** Bun, TypeScript, DuckDB (`@agentic-rpg/core`), MCP server (scribe), Ollama embeddings (`nomic-embed-text`).

## Global Constraints

- Greenfield only — no migration of existing worlds.
- Reliability is prompt discipline only — no enforcement hooks.
- Unresolved relation endpoints are **skipped with a notice**, never auto-stubbed.
- Point-of-entry dedup is **exact-match only** (`getLore` / `resolveExisting`) — no fuzzy/embedding dedup on this path.
- Entity provenance and relation provenance use `{ source_kind: "beat", source_id: <sceneId> }`.
- Relations carry `valid_at = <scene timestamp>`; `supersedes:true` calls `invalidateRelations` first.
- No further extraction-quality optimization is in scope.
- Run commands from `packages/core` (core) or `plugins/ironsworn/scribe` (scribe). Tests: `bun test`. Typecheck: `bun run tsc --noEmit`.
- Tests that exercise `upsertLore` need Ollama (it embeds the summary); guard them with an `ollamaAvailable()` early-return, mirroring `packages/core/src/rag/extraction.test.ts`.
- **Every PR bumps `plugins/ironsworn/.claude-plugin/plugin.json`** (Stop hook enforces it).

---

## File Structure

- **Create** `packages/core/src/rag/beat-canon.ts` — `recordBeatCanon()` + `BeatEntity`/`BeatRelation`/`BeatCanonResult` types. The resolution+write logic.
- **Create** `packages/core/src/rag/beat-canon.test.ts` — unit tests for the above.
- **Modify** `packages/core/src/rag/scenes.ts` — add optional `entities`/`relations` to `BeatInput`.
- **Modify** `packages/core/src/rag/beat-queue.ts` — worker calls `recordBeatCanon` after the beat write; queues skip-notices.
- **Modify** `packages/core/src/index.ts` — export `recordBeatCanon` + types.
- **Create** `packages/core/src/rag/graph-health.ts` + `graph-health.test.ts` — golden-free fragmentation + relation-coverage checks.
- **Modify** `plugins/ironsworn/scribe/src/tools/narrative.ts` — `record_beat` tool gains `entities`/`relations` params.
- **Modify** `plugins/ironsworn/agents/ironsworn-gm.md`, `plugins/ironsworn/skills/ironsworn-scene-craft/SKILL.md`, `plugins/ironsworn/commands/extract-session-lore.md` — protocol + backfill framing.
- **Modify** `docs/design/agentic-rpg-v1.md` — four reconciliation edits.
- **Modify** `plugins/ironsworn/.claude-plugin/plugin.json` — version bump.

---

## Task 1: `recordBeatCanon` core function

**Files:**
- Create: `packages/core/src/rag/beat-canon.ts`
- Test: `packages/core/src/rag/beat-canon.test.ts`

**Interfaces:**
- Consumes (existing, from `./lore.js`): `getLore(campaignPath, identifier) => Promise<LoreEntity | null>`; `upsertLore(campaignPath, { canonical, type, summary, aliases?, provenance? }) => Promise<UpsertLoreResult>`; `linkLore(campaignPath, { from, to, relation, notes?, valid_at?, provenance? })`; `invalidateRelations(campaignPath, fromId, toId, timestamp)`; `LORE_TYPES: readonly string[]`, `LoreType`. From `./scenes.js`: `getScene(campaignPath, sceneId) => Promise<{ timestamp: string } | null>`.
- Produces: `recordBeatCanon(campaignPath: string, sceneId: string, entities?: BeatEntity[], relations?: BeatRelation[]) => Promise<BeatCanonResult>`; types `BeatEntity { canonical, type, summary, aliases? }`, `BeatRelation { from, to, label, notes?, supersedes? }`, `BeatCanonResult { entities_created, entities_reused, relations_linked, skipped: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/rag/beat-canon.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordBeatCanon } from "./beat-canon.js";
import { upsertLore, getLore, exportLore } from "./lore.js";
import { recordScene } from "./scenes.js";

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

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "beat-canon-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("recordBeatCanon — entities", () => {
  it("reuses an existing entity by exact canonical match (no duplicate)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Lona", type: "person", summary: "A healer in Caldren." });
    const sceneId = await recordScene(dir, "Lona tends the sick.");

    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Lona", type: "person", summary: "A healer." }], []);

    expect(r.entities_reused).toBe(1);
    expect(r.entities_created).toBe(0);
    const { entities } = await exportLore(dir);
    expect(entities.filter((e) => e.canonical.toLowerCase() === "lona").length).toBe(1);
  });

  it("creates a new campaign-scoped entity when not found", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Vera guards the gate of Stonehaven.");

    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Stonehaven", type: "place", summary: "A fortified settlement." }], []);

    expect(r.entities_created).toBe(1);
    expect(await getLore(dir, "Stonehaven")).not.toBeNull();
  });

  it("skips an entity with an invalid type", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Something happens.");
    const r = await recordBeatCanon(dir, sceneId,
      [{ canonical: "Bogus", type: "notatype" as never, summary: "x" }], []);
    expect(r.entities_created).toBe(0);
    expect(r.skipped.length).toBe(1);
  });
});

describe("recordBeatCanon — relations", () => {
  it("links a relation when both endpoints already exist", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Vera", type: "person", summary: "A guard." });
    await upsertLore(dir, { canonical: "Stonehaven", type: "place", summary: "A settlement." });
    const sceneId = await recordScene(dir, "Vera guards Stonehaven.");

    const r = await recordBeatCanon(dir, sceneId, [],
      [{ from: "Vera", to: "Stonehaven", label: "GUARDS" }]);

    expect(r.relations_linked).toBe(1);
    const { relations } = await exportLore(dir);
    expect(relations.some((x) => x.relation === "GUARDS")).toBe(true);
  });

  it("resolves an endpoint created in the same call (entities then relations)", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Lona serves the Thornwood.");
    const r = await recordBeatCanon(dir, sceneId,
      [
        { canonical: "Lona", type: "person", summary: "A healer." },
        { canonical: "Thornwood", type: "faction", summary: "A faction." },
      ],
      [{ from: "Lona", to: "Thornwood", label: "MEMBER_OF" }]);
    expect(r.entities_created).toBe(2);
    expect(r.relations_linked).toBe(1);
  });

  it("skips a relation with an unresolved endpoint and reports it", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Oracle", type: "person", summary: "A seer." });
    const sceneId = await recordScene(dir, "The oracle serves the hidden god.");

    const r = await recordBeatCanon(dir, sceneId, [],
      [{ from: "Oracle", to: "Hidden God", label: "SERVES" }]);

    expect(r.relations_linked).toBe(0);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0]).toContain("Hidden God");
  });

  it("invalidates a prior relation when supersedes is true", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(dir, { canonical: "Caldren", type: "person", summary: "A warden." });
    await upsertLore(dir, { canonical: "Holtfen", type: "place", summary: "A village." });
    const scene1 = await recordScene(dir, "Caldren leads Holtfen.");
    await recordBeatCanon(dir, scene1, [], [{ from: "Caldren", to: "Holtfen", label: "HOLDS_TITLE" }]);
    const scene2 = await recordScene(dir, "Caldren is banished from Holtfen.");

    await recordBeatCanon(dir, scene2, [],
      [{ from: "Caldren", to: "Holtfen", label: "BANISHED_FROM", supersedes: true }]);

    const { relations } = await exportLore(dir);
    const prior = relations.find((x) => x.relation === "HOLDS_TITLE");
    expect(prior!.invalid_at).not.toBeNull();
  });

  it("is idempotent — re-recording the same canon adds no duplicates", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(dir, "Vera guards Stonehaven.");
    const beatEntities = [
      { canonical: "Vera", type: "person" as const, summary: "A guard." },
      { canonical: "Stonehaven", type: "place" as const, summary: "A settlement." },
    ];
    const beatRels = [{ from: "Vera", to: "Stonehaven", label: "GUARDS" }];
    await recordBeatCanon(dir, sceneId, beatEntities, beatRels);
    const r2 = await recordBeatCanon(dir, sceneId, beatEntities, beatRels);

    expect(r2.entities_created).toBe(0);
    expect(r2.entities_reused).toBe(2);
    const { entities, relations } = await exportLore(dir);
    expect(entities.filter((e) => e.canonical === "Vera").length).toBe(1);
    expect(relations.filter((x) => x.relation === "GUARDS").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test src/rag/beat-canon.test.ts`
Expected: FAIL with `Cannot find module './beat-canon.js'`.

- [ ] **Step 3: Implement `recordBeatCanon`**

Create `packages/core/src/rag/beat-canon.ts`:

```ts
import {
  upsertLore,
  getLore,
  linkLore,
  invalidateRelations,
  LORE_TYPES,
  type LoreType,
} from "./lore.js";
import { getScene } from "./scenes.js";

export interface BeatEntity {
  canonical: string;
  type: LoreType;
  summary: string;
  aliases?: string[];
}

export interface BeatRelation {
  from: string;
  to: string;
  label: string;
  notes?: string;
  supersedes?: boolean;
}

export interface BeatCanonResult {
  entities_created: number;
  entities_reused: number;
  relations_linked: number;
  skipped: string[];
}

// Resolve + write the structured canon a beat establishes. Entities first
// (exact-match reuse via getLore, else create campaign-scoped), then relations
// (both endpoints must resolve against the graph, which now includes the
// just-created entities). Unresolved relation endpoints are skipped with a
// notice — never auto-stubbed — to preserve the exact-match cleanliness that
// makes point-of-entry recording fragmentation-free.
export async function recordBeatCanon(
  campaignPath: string,
  sceneId: string,
  entities: BeatEntity[] = [],
  relations: BeatRelation[] = [],
): Promise<BeatCanonResult> {
  const result: BeatCanonResult = {
    entities_created: 0,
    entities_reused: 0,
    relations_linked: 0,
    skipped: [],
  };

  const scene = await getScene(campaignPath, sceneId);
  const validAt = scene?.timestamp;

  for (const e of entities) {
    if (!LORE_TYPES.includes(e.type)) {
      result.skipped.push(`entity "${e.canonical}": invalid type "${e.type}"`);
      continue;
    }
    const existing = await getLore(campaignPath, e.canonical);
    if (existing !== null) {
      result.entities_reused++;
      continue;
    }
    await upsertLore(campaignPath, {
      canonical: e.canonical,
      type: e.type,
      summary: e.summary,
      aliases: e.aliases,
      provenance: { source_kind: "beat", source_id: sceneId },
    });
    result.entities_created++;
  }

  for (const r of relations) {
    const fromEntity = await getLore(campaignPath, r.from);
    const toEntity = await getLore(campaignPath, r.to);
    if (fromEntity === null || toEntity === null) {
      const missing = fromEntity === null ? r.from : r.to;
      result.skipped.push(
        `relation ${r.from} -[${r.label}]-> ${r.to}: "${missing}" not found — ground it or add it to entities`,
      );
      continue;
    }
    if (r.supersedes && validAt) {
      await invalidateRelations(campaignPath, fromEntity.id, toEntity.id, validAt);
    }
    await linkLore(campaignPath, {
      from: fromEntity.id,
      to: toEntity.id,
      relation: r.label,
      notes: r.notes,
      valid_at: validAt,
      provenance: { source_kind: "beat", source_id: sceneId },
    });
    result.relations_linked++;
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/rag/beat-canon.test.ts`
Expected: PASS (all cases; or trivially pass/return early if Ollama is unreachable).

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/core && bun run tsc --noEmit
git add packages/core/src/rag/beat-canon.ts packages/core/src/rag/beat-canon.test.ts
git commit -m "feat: recordBeatCanon — resolve + write beat canon (entities + relations)"
```

---

## Task 2: Wire structured canon into the beat pipeline

**Files:**
- Modify: `packages/core/src/rag/scenes.ts` (the `BeatInput` interface)
- Modify: `packages/core/src/rag/beat-queue.ts` (the worker loop, `_runWorker`)
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/rag/beat-queue.test.ts` (existing file — add a case)

**Interfaces:**
- Consumes: `recordBeatCanon`, `BeatEntity`, `BeatRelation` from Task 1 (`./beat-canon.js`).
- Produces: `BeatInput` now has optional `entities?: BeatEntity[]` and `relations?: BeatRelation[]`. When a beat carries them, the queue worker writes the canon after the beat row and queues any `skipped` notices (drainable via `drainNotices`). `recordBeatCanon` + types are re-exported from `@agentic-rpg/core`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/rag/beat-queue.test.ts` (import `recordScene`, `getLore`, `drainNotices`, `pushBeat`, and an `ollamaAvailable()` guard as in Task 1):

```ts
describe("pushBeat — structured canon", () => {
  it("writes a beat's entities and relations, surfacing skips as notices", async () => {
    if (!(await ollamaAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "beat-queue-canon-"));
    const sceneId = await recordScene(dir, "Vera guards Stonehaven; a stranger watches.");

    const entry = await pushBeat(dir, sceneId, {
      kind: "narration",
      text: "Vera guards Stonehaven.",
      entities: [
        { canonical: "Vera", type: "person", summary: "A guard." },
        { canonical: "Stonehaven", type: "place", summary: "A settlement." },
      ],
      relations: [
        { from: "Vera", to: "Stonehaven", label: "GUARDS" },
        { from: "Vera", to: "The Stranger", label: "WATCHED_BY" }, // unresolved → skipped
      ],
    });
    await entry.settled;

    expect(await getLore(dir, "Vera")).not.toBeNull();
    expect(await getLore(dir, "Stonehaven")).not.toBeNull();
    const notices = drainNotices(dir);
    expect(notices.some((n) => n.includes("The Stranger"))).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test src/rag/beat-queue.test.ts`
Expected: FAIL — `entities`/`relations` are not a known `BeatInput` field (tsc error) and no canon is written.

- [ ] **Step 3: Extend `BeatInput`**

In `packages/core/src/rag/scenes.ts`, find the `BeatInput` interface and add the two optional fields (import the types at the top of the file: `import type { BeatEntity, BeatRelation } from "./beat-canon.js";`):

```ts
export interface BeatInput {
  kind: string;
  text: string;
  speaker?: string;
  metadata?: Record<string, unknown>;
  // Structured canon this beat establishes (point-of-entry recording).
  entities?: BeatEntity[];
  relations?: BeatRelation[];
}
```

(Keep any existing fields on `BeatInput`; only add `entities`/`relations`.)

- [ ] **Step 4: Write the canon in the worker**

In `packages/core/src/rag/beat-queue.ts`, add the import and call `recordBeatCanon` after the beat row is written, inside `_runWorker`'s try-block. Replace:

```ts
      entry.beatIndex = await _recordBeat(campaignPath, entry.sceneId, entry.beat);
      entry._resolve();
```

with:

```ts
      entry.beatIndex = await _recordBeat(campaignPath, entry.sceneId, entry.beat);
      const { entities, relations } = entry.beat;
      if ((entities && entities.length > 0) || (relations && relations.length > 0)) {
        const canon = await recordBeatCanon(campaignPath, entry.sceneId, entities, relations);
        for (const skip of canon.skipped) {
          _queueNotice(campaignPath, `[core] beat canon skipped: ${skip}`);
        }
      }
      entry._resolve();
```

Add at the top of `beat-queue.ts`:

```ts
import { recordBeatCanon } from "./beat-canon.js";
```

- [ ] **Step 5: Export from core**

In `packages/core/src/index.ts`, add:

```ts
export {
  recordBeatCanon,
  type BeatEntity,
  type BeatRelation,
  type BeatCanonResult,
} from "./rag/beat-canon.js";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/core && bun test src/rag/beat-queue.test.ts && bun run tsc --noEmit`
Expected: PASS; clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/scenes.ts packages/core/src/rag/beat-queue.ts packages/core/src/index.ts packages/core/src/rag/beat-queue.test.ts
git commit -m "feat: write beat canon through the async beat queue + notices"
```

---

## Task 3: `record_beat` MCP tool — `entities` + `relations` params

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/narrative.ts` (the `record_beat` tool registration)

**Interfaces:**
- Consumes: the extended `BeatInput` (Task 2) — `pushBeat` accepts `entities`/`relations` on the beat.
- Produces: the `record_beat` MCP tool accepts optional `entities` and `relations` arrays and forwards them to `pushBeat`; on `wait=true`, any skip-notices are drained into the response (the handler already drains notices).

- [ ] **Step 1: Add the Zod params**

In `plugins/ironsworn/scribe/src/tools/narrative.ts`, in the `record_beat` registration's parameter object (alongside `scene_id`, `kind`, `text`, `speaker`, `metadata`, `wait`), add (import `LORE_TYPES` from `@agentic-rpg/core` at the top if not already imported):

```ts
      entities: z
        .array(
          z.object({
            canonical: z.string(),
            type: z.enum(LORE_TYPES),
            summary: z.string(),
            aliases: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe("Canon this beat establishes. Reuse exact canonical names from grounding; new names create campaign-scoped entities."),
      relations: z
        .array(
          z.object({
            from: z.string(),
            to: z.string(),
            label: z.string(),
            notes: z.string().optional(),
            supersedes: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Relationships this beat asserts between known entities (existing or in this beat's `entities`). Endpoints that resolve to neither are skipped with a notice."),
```

- [ ] **Step 2: Forward them to `pushBeat`**

In the same handler, the `pushBeat` call currently passes `{ kind, text, speaker, metadata }`. Change it to include the new fields:

```ts
      const entry = await pushBeat(campaignPath, scene_id, { kind, text, speaker, metadata, entities, relations });
```

and add `entities`, `relations` to the handler's destructured argument list (`async ({ scene_id, kind, text, speaker, metadata, wait, entities, relations }) => {`).

- [ ] **Step 3: Typecheck + run scribe tests**

Run: `cd plugins/ironsworn/scribe && bun run tsc --noEmit && bun test`
Expected: clean typecheck; existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/narrative.ts
git commit -m "feat: record_beat MCP tool accepts entities + relations"
```

---

## Task 4: Golden-free graph-health checks

**Files:**
- Create: `packages/core/src/rag/graph-health.ts`
- Test: `packages/core/src/rag/graph-health.test.ts`

**Interfaces:**
- Produces two pure functions over an entity/relation list (no golden, no DB):
  `fragmentationClusters(entities: { canonical: string; type: string; aliases: string[] }[]) => { type: string; names: string[] }[]` — groups **same-type** entities whose canonical token sets are in a strict subset relation (`Lago ⊂ Lago Rhian`), the signature of a fragmented node; and
  `relationCoverage(entities: { id: string }[], relations: { from_id: string; to_id: string }[]) => { withRelation: number; total: number; ratio: number }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/rag/graph-health.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { fragmentationClusters, relationCoverage } from "./graph-health.js";

describe("fragmentationClusters", () => {
  it("groups same-type entities whose names are in a subset relation", () => {
    const clusters = fragmentationClusters([
      { canonical: "Lago Rhian", type: "person", aliases: [] },
      { canonical: "Lago", type: "person", aliases: [] },
      { canonical: "Ashfen Settlement", type: "place", aliases: [] },
      { canonical: "Ashfen", type: "place", aliases: [] },
      { canonical: "Caldren", type: "person", aliases: [] },
    ]);
    const flat = clusters.map((c) => c.names.sort());
    expect(flat).toContainEqual(["Lago", "Lago Rhian"]);
    expect(flat).toContainEqual(["Ashfen", "Ashfen Settlement"]);
    expect(flat.flat()).not.toContain("Caldren"); // stands alone
  });

  it("does not cluster distinct same-pattern names (neither is a subset)", () => {
    const clusters = fragmentationClusters([
      { canonical: "Ashfen Harvest Vow", type: "thread", aliases: [] },
      { canonical: "Greyhollow Harvest Vow", type: "thread", aliases: [] },
    ]);
    expect(clusters.length).toBe(0); // each has a unique discriminator token
  });

  it("does not cluster a subset-named entity of a different type", () => {
    // "Caldren" (person) must not merge with "Caldren's Wardenship" (thread).
    const clusters = fragmentationClusters([
      { canonical: "Caldren", type: "person", aliases: [] },
      { canonical: "Caldren Wardenship", type: "thread", aliases: [] },
    ]);
    expect(clusters.length).toBe(0);
  });
});

describe("relationCoverage", () => {
  it("reports the fraction of entities with at least one relation", () => {
    const cov = relationCoverage(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [{ from_id: "a", to_id: "b" }],
    );
    expect(cov.total).toBe(4);
    expect(cov.withRelation).toBe(2); // a and b
    expect(cov.ratio).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test src/rag/graph-health.test.ts`
Expected: FAIL — `Cannot find module './graph-health.js'`.

- [ ] **Step 3: Implement**

Create `packages/core/src/rag/graph-health.ts`:

```ts
// Golden-free graph-health indicators, runnable against any world's graph.
// Fragmentation: candidate duplicate nodes detected among the graph's OWN
// entities — same type, and one canonical's token set a strict subset of the
// other ("Lago" ⊂ "Lago Rhian"). Relation coverage: how connected the graph is.
// Indicators, not scores.

const STOPWORDS = new Set(["of", "the", "a", "at", "for"]);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

// True when one token set is a strict subset of the other (different sizes).
function subsetMerge(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0 || a.size === b.size) return false;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export function fragmentationClusters(
  entities: { canonical: string; type: string; aliases: string[] }[],
): { type: string; names: string[] }[] {
  const toks = entities.map((e) => tokens(e.canonical));
  const parent = entities.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[i]!.type !== entities[j]!.type) continue; // same-type only
      if (subsetMerge(toks[i]!, toks[j]!)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < entities.length; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(entities[i]!.canonical);
  }
  return [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => ({ type: entities.find((e) => names.includes(e.canonical))!.type, names }));
}

export function relationCoverage(
  entities: { id: string }[],
  relations: { from_id: string; to_id: string }[],
): { withRelation: number; total: number; ratio: number } {
  const connected = new Set<string>();
  for (const r of relations) {
    connected.add(r.from_id);
    connected.add(r.to_id);
  }
  const withRelation = entities.filter((e) => connected.has(e.id)).length;
  const total = entities.length;
  return { withRelation, total, ratio: total === 0 ? 0 : withRelation / total };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/rag/graph-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add to `packages/core/src/index.ts`:

```ts
export { fragmentationClusters, relationCoverage } from "./rag/graph-health.js";
```

```bash
cd packages/core && bun run tsc --noEmit
git add packages/core/src/rag/graph-health.ts packages/core/src/rag/graph-health.test.ts packages/core/src/index.ts
git commit -m "feat: golden-free graph-health checks (fragmentation + relation coverage)"
```

---

## Task 5: Protocol & prompt updates

**Files:**
- Modify: `plugins/ironsworn/agents/ironsworn-gm.md` (Fiction Grounding Protocol)
- Modify: `plugins/ironsworn/skills/ironsworn-scene-craft/SKILL.md` (protocol reminder)
- Modify: `plugins/ironsworn/commands/extract-session-lore.md` (backfill framing)

**Interfaces:** none (content only). No code; verified by reading the rendered protocol.

- [ ] **Step 1: Rewrite the Fiction Grounding Protocol**

In `plugins/ironsworn/agents/ironsworn-gm.md`, replace the numbered Fiction Grounding Protocol list (currently: search → weave → invent+`upsert_entity` → never contradict) with:

```markdown
1. **Ground first** — Call `recall` (or `search_lore` for a specific scope) for the subject before you name it.
2. **Narrate** the beat.
3. **Record the beat with its canon** — call `record_beat` carrying:
   - `entities`: any new canon the beat established, **using the exact canonical names that grounding returned** (reuse them; never coin a variant like "Lago" when canon says "Lago Rhian");
   - `relations`: the relationships the beat asserted between those entities (`{ from, to, label }`).
   **MANDATORY:** a beat that establishes a new entity or a relationship MUST carry it in that same `record_beat` call. Recording the prose without its structured canon is forbidden, exactly like a summary-only scene.
4. **Never contradict** established canon — if a roll or oracle conflicts with it, treat the conflict itself as the complication.
```

- [ ] **Step 2: Update the scene-craft reminder**

In `plugins/ironsworn/skills/ironsworn-scene-craft/SKILL.md`, find the fiction-grounding reminder and add a line: "Record the canon a beat establishes **on the beat** — `record_beat` with `entities` and `relations`, reusing exact grounded names. Don't leave relations for later extraction."

- [ ] **Step 3: Reframe the extract command**

In `plugins/ironsworn/commands/extract-session-lore.md`, change the description/body to position it as a backfill: replace the opening line with "Optional backfill. The GM records canon on the beat during play; run this only to catch lore from scenes where structured recording was missed. It dedups against already-recorded entities and relations." Keep the tool call instruction.

- [ ] **Step 4: Commit**

```bash
git add plugins/ironsworn/agents/ironsworn-gm.md plugins/ironsworn/skills/ironsworn-scene-craft/SKILL.md plugins/ironsworn/commands/extract-session-lore.md
git commit -m "docs: protocol records relations on the beat; extraction reframed as backfill"
```

---

## Task 6: v1 design-doc reconciliation + version bump

**Files:**
- Modify: `docs/design/agentic-rpg-v1.md` (four edits)
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json` (version bump)

**Interfaces:** none (docs + version).

- [ ] **Step 1: Invert failure-mode #1**

In `docs/design/agentic-rpg-v1.md`, in the "Why coherence is the hard problem" section, rewrite failure mode #1 (currently "**Extraction quality.** ... Highest-leverage component; currently treated as carry-forward.") to:

```markdown
1. **Capture at point of entry.** The highest-leverage fix is *not* better
   extraction — batch extraction is a lossy prose→structure reconstruction that
   lacks the author's knowledge of what is canonical and reliable name grounding.
   The GM, at narration time, has both. Canon (entities **and relations**) should
   be recorded on the beat via `record_beat`; extraction is demoted to optional
   backfill. (Established 2026-06 after measurement: relation recall caps because
   relations were never recorded where known; a two-pass extractor was a measured
   negative result; the dedup regression was largely name fragmentation from
   re-deriving names independently. See
   `docs/superpowers/specs/2026-06-27-point-of-entry-recording-design.md`.)
```

- [ ] **Step 2: Update priorities + status header**

In the "v1 priorities, in order" section, add a new priority for point-of-entry recording as the primary canon-capture path, and reframe the extraction-eval priority (#2) as *backfill-quality measurement, not the primary quality lever*. Update the status header line to note point-of-entry recording as the active item.

- [ ] **Step 3: Update the fiction-grounding protocol + tool surface**

In the doc's "The fiction-grounding protocol" section, extend the steps to record **relations on the beat** (not just `upsert_entity`). In the "Tool surface" section, note that `record_scene`/`record_beat` now carry structured canon, and reposition `extract_session_lore` as optional backfill.

- [ ] **Step 4: Bump the plugin version**

In `plugins/ironsworn/.claude-plugin/plugin.json`, bump the `version` field by a minor increment (new feature).

- [ ] **Step 5: Commit**

```bash
git add docs/design/agentic-rpg-v1.md plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "docs: reconcile v1 design with point-of-entry recording; bump plugin version"
```

---

## Final verification

- [ ] Run the full core suite: `cd packages/core && bun test` — all pass.
- [ ] Run the scribe suite: `cd plugins/ironsworn/scribe && bun test` — all pass.
- [ ] Typecheck both packages: `bun run tsc --noEmit` in each.
- [ ] Confirm `plugin.json` version increased vs `origin/main`.
