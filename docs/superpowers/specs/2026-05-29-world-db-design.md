# Unified World DB — Design Spec (#166)

**Issue:** [#166](https://github.com/karimn/agentic-rpg/issues/166)
**Parent design:** `docs/design/agentic-rpg-v1.md` (D3, D7, D9, D10, D16, D26)
**Status:** Spec
**Supersedes:** #162 (auto-mirror `upsert_npc` → lore). Strengthens the
#72 fix (auto-stub becomes FK-backed by construction).

## Motivation

The scribe server keeps a campaign's knowledge in three disjoint places
that cannot join:

| Store today | Path | Holds |
|---|---|---|
| Lore graph | `campaigns/<id>/lore.duckdb` | `lore_entities`, `lore_relations`, `lore_provenance`, `lore_communities`, `lore_extraction_log`, `lore_proximity_edges` |
| Scene journal | `campaigns/<id>/scenes.duckdb` | `scenes`, `scene_beats` |
| Loose files | `campaigns/<id>/npcs/*.md`, `threads.yaml` | NPCs (append-only markdown), narrative threads (YAML) |

Consequences we have already filed bugs for: scene↔entity links are
name-matched warnings, not joins (#72); NPCs and lore entities are
unrelated records (#162); cross-store joins are impossible. The deeper
cost is that **starting a second campaign in the same setting** requires
an export/filter/import pipeline — there is no shared world, only frozen
copies.

The fix is the one #166 argues for: **one world DB; campaign membership
is a column, not a database boundary.** A single visibility predicate —
`campaign_id IS NULL OR campaign_id = :current` — becomes the entire
answer to "what carries over to a new campaign," and promotion to canon
becomes one column flip.

## Goals

1. Collapse the two DuckDB files and the loose NPC/thread files into one
   **`world.duckdb`**, with `campaign_id` as the partition column
   (`NULL` = world canon, visible to all campaigns).
2. Apply the visibility filter to **every read** the server performs.
3. Move entity identity to **UUID primary keys** (see Decision 1), so
   canon and campaign-scoped rows coexist without slug collisions.
4. Collapse NPCs into `entities(type='person')` and threads into
   `entities(type='thread')`.
5. Replace name-warning scene refs with an **FK-backed
   `scene_entity_refs`** table; auto-stub unknown names at
   `record_scene` time, scoped to the active campaign.
6. Ship `canonize` / `decanonize` — the explicit promotion ritual.
7. Pin the embedding model in **`world.json`** and refuse to load on
   mismatch (silent-corruption guard, D16).
8. Provide a one-time, CLI-gated migration from the legacy layout, and a
   bumped portable export/import format.
9. Reserve the future-proofing conventions #166 calls out:
   `metadata.coordinates` on places (D9) and per-campaign overlay state
   as `campaign_id`-scoped relations (D10).

## Non-goals (explicitly out of scope for #166)

Carried verbatim from the issue, plus clarifications:

- **`recall` unified retrieval tool.** `search_lore`, `search_scenes`,
  `get_npc`, `search_lore_global`, etc. stay as distinct tools; they only
  gain the visibility filter and (where noted) an
  `include_sibling_campaigns` flag. The `recall` collapse is separate v1
  work.
- **Bun workspace restructure / npm package extraction.** The world DB
  lands on the current `@agentic-rpg/core` workspace package; the
  per-world Bun-project layout from the v1 doc is later work.
- **`/remember` → `preferences.md`** migration.
- **Path A (Graphiti/FalkorDB) spike.** This ships on DuckDB. The schema
  and visibility model are path-agnostic by design.
- **World-clock / faction-turn mechanics**, cross-world references,
  bi-temporal relation validity.
- **Spatial coordinate *queries*.** We reserve the `metadata.coordinates`
  convention and the `near` parameter *shape*; we do not implement
  spatial distance in this issue.

## Decisions

### Decision 1 — UUID primary keys (confirmed)

Entities move from slug IDs (`slugify(canonical)`) to `UUID` primary
keys. Rationale: under one shared table a slug like `the-iron` can exist
both as world canon and as a campaign-local row; a slug PK cannot
represent both. UUIDs make identity campaign-independent and make the
canonize column-flip safe (no PK rewrite on promotion).

Consequences the migration must absorb:

- Every FK that referenced an entity by slug — `lore_relations.from_id`
  / `to_id`, `lore_proximity_edges.from_id` / `to_id`,
  `lore_provenance.subject_id`, `entities.metadata.community` — is
  rewritten through a `slug → uuid` map built during migration.
- Human-facing resolution is **unchanged**: `get_lore` / `link_lore` /
  proximity still accept id, canonical, or alias, because resolution
  already does `lower(id) = ? OR lower(canonical) = ? OR alias match`.
  The old slug is preserved as an entry in `aliases` (and stored in a
  `slug` column) so existing references by slug keep resolving.
- New entity IDs are minted with `crypto.randomUUID()`; `upsert_entity`
  resolves an existing row by `(campaign_id-visible) canonical/alias`
  before creating, preserving today's upsert-by-name semantics.

### Decision 2 — one `world.duckdb` file (confirmed)

`lore.duckdb` + `scenes.duckdb` merge into a single `world.duckdb`
holding all tables. DuckDB handles many tables per file; cross-table
joins (scene→entity) become possible. The file lives **one level above
the campaign folder** so sibling campaigns share it:

```
<world-root>/
  world.duckdb
  world.json
  campaigns/
    <id>/
      campaign.json        # { "id": "...", "name": "..." }
      character.json
      threads.yaml         # legacy; migrated into entities (kept until migration runs)
      state-journal.jsonl
```

`SCRIBE_CAMPAIGN` still points at a campaign folder; the server walks up
to find `world.duckdb` / `world.json` and reads the active `campaign_id`
from `campaign.json`.

### Decision 3 — embedding pin in `world.json` (confirmed)

`world.json` is created with `world.duckdb` and carries:

```jsonc
{
  "schemaVersion": 1,
  "embedding": { "model": "nomic-embed-text", "version": "1.5", "dim": 768 },
  "name": "<world name>"
}
```

On load, if the active embedder's `{model, version, dim}` differs from
the pin, the server refuses to start with an actionable error (restore
the model, or run a future re-embed migration). This guards the
known silent-corruption failure mode (D16).

### Decision 4 — delivery as one PR, phased commits (confirmed)

#166 lands as a **single PR to `main`**, developed as an ordered commit
sequence (Phase 1→4 below). `main` is never left half-migrated; the
phasing is review structure, not merge boundaries.

## Target schema

```sql
CREATE TABLE entities (
  id              UUID PRIMARY KEY,
  slug            TEXT NOT NULL,            -- legacy/human handle; not unique across campaigns
  canonical       TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT [],
  type            TEXT NOT NULL,            -- place|person|faction|material|concept|creature|event|truth|thread
  summary         TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}',  -- may carry coordinates:{x,y,system} for places (D9)
  embedding       FLOAT[768] NOT NULL,
  campaign_id     TEXT,                     -- NULL = world canon
  created_in_campaign TEXT NOT NULL,        -- provenance, always set
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE relations (
  id          UUID PRIMARY KEY,
  from_entity UUID NOT NULL,
  to_entity   UUID NOT NULL,
  label       TEXT NOT NULL,
  notes       TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',
  embedding   FLOAT[768],
  campaign_id TEXT,                          -- NULL = world-level; used for overlay state (D10)
  created_at  TEXT NOT NULL,
  UNIQUE (from_entity, to_entity, label, campaign_id)
);

CREATE TABLE scenes (
  id            UUID PRIMARY KEY,
  campaign_id   TEXT NOT NULL,               -- scenes are always campaign-owned
  place_entity  UUID,                        -- shared geospatial anchor (nullable)
  text          TEXT NOT NULL,
  embedding     FLOAT[768] NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'scene',
  complication_theme TEXT,
  quality_notes TEXT,
  timestamp     TEXT NOT NULL
);

CREATE TABLE scene_entity_refs (
  scene_id   UUID NOT NULL,
  entity_id  UUID NOT NULL,
  role       TEXT NOT NULL DEFAULT 'present',  -- present | mentioned | affected
  PRIMARY KEY (scene_id, entity_id)
);

-- scene_beats, lore_provenance, lore_communities, lore_proximity_edges,
-- lore_extraction_log: retained, with entity references rewritten to UUID
-- and a campaign_id column added to communities and proximity_edges.
```

`scene_beats` keeps its shape (FK `scene_id` now UUID). `lore_communities`
and `lore_proximity_edges` gain `campaign_id`. `lore_provenance.subject_id`
holds UUIDs (and `from|to|label` composite for relations is replaced by the
relation UUID).

### Visibility rule

Every read query the GM context builder and read tools run gains:

```sql
WHERE (campaign_id IS NULL OR campaign_id = :current_campaign)
```

- Entities, relations, communities, proximity edges: filtered by the
  predicate above.
- Scenes, beats, scene_entity_refs: filtered by `campaign_id = :current`
  (scenes are never canon).
- **Vector search** (`searchLore`, `searchScenes`, `searchCommunities`,
  `searchBeats`): the predicate goes in the `WHERE` **before**
  `ORDER BY array_cosine_similarity(...) LIMIT k`, so a sibling
  campaign's high-similarity row can never leak into top-k. This is the
  regression test the issue calls "before RRF" — note the lore/scene side
  is vector-only today; the static-rulebook RRF path is untouched.
- **Sibling override:** read tools that ground fiction accept an optional
  `include_sibling_campaigns: boolean` (default false). When true, the
  predicate widens to all campaigns in the world — the deliberate "who
  else has been here" lens.

### Promotion to canon

```sql
UPDATE entities  SET campaign_id = NULL WHERE id = :id;  -- canonize_entity
UPDATE relations SET campaign_id = NULL WHERE id = :id;  -- canonize_relation
```

`decanonize_entity(id, into_campaign)` / `decanonize_relation(...)` set
`campaign_id` back to a named campaign. Both are reversible, no data
movement.

## Tool surface changes

| Tool | Change |
|---|---|
| `upsert_entity` | **New.** `{ type, canonical, summary, content?, metadata?, aliases?, provenance? }`. Writes with `campaign_id = current`, `created_in_campaign = current`. |
| `upsert_npc` | **Alias** → `upsert_entity(type='person', ...)`, mapping description/impression into `metadata`. Kept one release. |
| `upsert_lore` | **Alias** → `upsert_entity`. Kept one release. |
| `record_scene` | Resolves `npcs` / `lore_ids` to entity UUIDs via FK; **auto-stubs** unknown names as `entities(type='person'|'concept', campaign_id=current)` and writes `scene_entity_refs`. Optional `place` anchor. The name-warning fallback is removed. |
| `search_lore` / `search_lore_global` / `search_scenes` / `search_beats` / `get_lore` / `get_lore_graph` / `get_npc` / `list_threads` / `proximity_*` | Apply the visibility filter. Grounding tools add `include_sibling_campaigns`. |
| `link_lore` / `link_proximity` | Write `campaign_id = current` (overlay state, D10) unless linking two canon entities. |
| `canonize_entity` / `canonize_relation` | **New.** Column flip to `NULL`. |
| `decanonize_entity` / `decanonize_relation` | **New.** Column flip to a named campaign. |
| `extract_lore_from_scene` / `extract_session_lore` | Write extracted entities/relations with `campaign_id = current` by default. Canonization is the separate gate. |
| `get_npc` | Reads `entities(type='person')` and renders markdown-compatible output (back-compat shape). |
| `open_thread` / `close_thread` | Operate on `entities(type='thread')`. `threads.yaml` is migrated; tools no longer read the YAML after migration. |

`recompute_communities` clusters the **visible** subgraph for the active
campaign and stamps resulting community rows with the active
`campaign_id` (canon-only clustering when run from a fresh sibling).

## Migration

A one-time, CLI-gated migration: `scribe migrate-to-world-db` (not run
silently on first start — the directory restructure is user-visible).

1. Detect legacy layout (`campaigns/<id>/{lore,scenes}.duckdb`, `npcs/`,
   `threads.yaml`).
2. Create `world.duckdb` + `world.json` one level up (the world root).
3. Build a `slug → uuid` map for all `lore_entities`; insert them into
   `entities` with `campaign_id = '<id>'`, `created_in_campaign = '<id>'`,
   `slug` preserved, old slug appended to `aliases`.
4. Rewrite `lore_relations`, `lore_proximity_edges`,
   `lore_provenance.subject_id`, and `metadata.community` through the map;
   insert with `campaign_id = '<id>'`.
5. Import `npcs/*.md` as `entities(type='person', campaign_id='<id>')`:
   `canonical` from the `# Name` heading, latest description/impression
   folded into `summary` + `metadata.history`, summary embedded.
6. Import `threads.yaml` as `entities(type='thread', campaign_id='<id>')`,
   open/closed/resolution carried in `metadata`.
7. Import `scenes` + `scene_beats` with `campaign_id = '<id>'`; resolve any
   recorded scene refs into `scene_entity_refs` FKs (name → UUID via the
   visible entity table; unresolved names auto-stub as `person`).
8. Write `campaign.json` (`{ id, name }`) into the campaign folder.
9. Verify counts (entities/relations/scenes/edges in == out), then move
   the legacy `.duckdb` files and loose stores aside (`*.legacy`) rather
   than hard-deleting on the first pass.

Idempotent and re-runnable: detects an already-migrated world and no-ops.
Embeddings: rows are re-embedded from `summary`/`text` (requires Ollama),
matching today's import path.

## Export / import

Bump `CampaignExport` to **version 3**: entity rows carry `id` (UUID),
`slug`, `campaign_id`, `created_in_campaign`; relations carry `id` and
`campaign_id`; scenes carry `campaign_id` + `place_entity`;
`scene_entity_refs` is a new top-level array. Import remains idempotent on
UUID. v1/v2 imports continue to work: they land as
`campaign_id = <target>` with freshly minted UUIDs (slug → uuid map built
on import, same as migration).

## Testing

Synthetic fixtures only — **no Zura corpus in CI** (campaign data is
gitignored). A deterministic stub embedder lets the bulk of tests run
without Ollama; Ollama-gated tests stay behind the existing
`ollamaAvailable()` guard.

- **`migrations/world.test.ts`** — build a tiny legacy layout
  (hand-written `lore.duckdb` + `scenes.duckdb` + two `npcs/*.md` + a
  `threads.yaml`), run the migration, assert: `world.duckdb` exists;
  slug→uuid map is bijective; relations/proximity/provenance references
  resolve; NPCs and threads appear as entities; `scene_entity_refs` is
  FK-backed; counts match; re-run is a no-op.
- **Visibility tests** (per read module) — seed canon (`campaign_id NULL`)
  + two campaigns; assert each campaign sees canon + its own only;
  `include_sibling_campaigns` widens correctly.
- **Embedding-leakage regression** — seed a sibling-campaign entity with
  an embedding identical to the query; assert it never appears in
  `search_lore` top-k for the active campaign, and *does* with the
  sibling flag.
- **Canonize round-trip** — `canonize_entity` flips to `NULL`; a fresh
  sibling campaign sees it with no export; `decanonize` reverses.
- **Auto-stub** — `record_scene` with an unknown NPC name creates a
  `person` entity scoped to the active campaign and an FK ref; no warning.
- **`world.json` guard** — load with a mismatched embedding pin refuses
  with an actionable error.
- **Export v3 round-trip** — export → fresh world → import → identical
  visible graph; v2 import still lands.

Smoke: `bun test` green, `bun run tsc --noEmit` clean across the
workspace, `bun run src/server.ts` starts and lists the new tools.

## Acceptance criteria (from #166)

- [ ] Migration runs on a campaign and produces a working `world.duckdb`
      (CI: synthetic fixture; manual: Zura, local).
- [ ] Existing GM workflows (record scene, search lore, get NPC) work
      unchanged after migration, all reads filtered to the active campaign.
- [ ] `canonize_entity` flips `campaign_id` to `NULL`; a freshly
      initialized sibling campaign sees the canonized entity with no export.
- [ ] A new campaign in the same world boots via `ironsworn-init` and
      immediately sees world canon but no sibling scenes / campaign-scoped
      NPCs.
- [ ] Vector search applies the visibility filter before ranking
      (embedding-leakage regression test).
- [ ] `scene_entity_refs` is FK-backed, not name-matched; #72-style
      warnings no longer occur.
- [ ] Auto-stub of unknown names at `record_scene`, scoped to the active
      campaign.
- [ ] `docs/design/world-db.md` covers the model, the canonize ritual, and
      the migration path.
- [ ] `world.json` embedding pin + load-time mismatch guard.
- [ ] Plugin version bumped in `plugins/ironsworn/.claude-plugin/plugin.json`.

## Open questions (deferred, not blocking)

- **Community scope under canon.** v1 here: communities are stamped with
  the active `campaign_id` and clustered over the visible graph. A pure
  canon-only community pass is possible later; not required by #166.
- **`created_in_campaign` for canon-seed imports.** Setting seeds (v1 doc)
  will set `campaign_id = NULL` with `created_in_campaign = '<seed>'`;
  harmless here, finalized when settings ship.
- **CLAUDE.md drift.** CLAUDE.md still documents the pre-#155
  `scribe/src/...` layout; refresh it alongside this work.
