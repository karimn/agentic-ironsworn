# Unified World DB (#166)

How shared lore, per-campaign overlays, and scene memory live together in a
single DuckDB file. This is the design-of-record; the working spec is
`docs/superpowers/specs/2026-05-29-world-db-design.md`.

## Motivation

The original layout gave every campaign its own `lore.duckdb` + `scenes.duckdb`
under `campaigns/<id>/`. Lore was siloed: a place discovered in one campaign was
invisible to a sibling set in the same world, and there was no way to share
canon without copying data. Entities were also keyed by **slug** (a human
handle), so the same slug meaning two different things across campaigns was a
latent collision, and scene→entity links were name strings, not foreign keys.

The world DB collapses both stores into one **`world.duckdb`** that holds every
campaign in a world, keys everything by **UUID**, and uses a single nullable
`campaign_id` column to express visibility — shared canon vs. campaign-private
overlay — without moving any data.

## Directory layout

`world.duckdb` and `world.json` live **one level above** the campaign folder, so
sibling campaigns share them:

```
<world-root>/
  world.duckdb           # all tables, all campaigns
  world.json             # schema version + embedding pin + world name
  campaigns/
    <id>/
      campaign.json      # { "id": "...", "name": "..." }
      character.json
      state-journal.jsonl
```

`SCRIBE_CAMPAIGN` still points at a **campaign folder**. The server walks up to
find `world.duckdb` / `world.json` and reads the active `campaign_id` from
`campaign.json` (falling back to the folder name). This resolution lives in
`packages/core/src/world.ts` (`resolveWorldContext`).

A campaign may also be laid out flat (`world.duckdb` directly inside the campaign
folder) — the walk-up resolver treats the campaign folder as its own world root
when there is no enclosing `campaigns/` directory.

## The visibility model

Every entity, relation, community, and proximity edge carries a `campaign_id`:

- **`campaign_id IS NULL`** → **world canon**, visible to every campaign in the
  world.
- **`campaign_id = '<id>'`** → **campaign-scoped overlay**, visible only to that
  campaign.

Scenes, scene beats, and `scene_entity_refs` are **always** campaign-owned
(`campaign_id NOT NULL`) — they are play history, never canon.

Every read applies the visibility predicate:

```sql
WHERE (campaign_id IS NULL OR campaign_id = :current_campaign)
```

Scenes use the stricter `campaign_id = :current` (no canon scenes).

### Vector search must filter *before* ranking

For semantic search the predicate goes in the `WHERE` **before**
`ORDER BY array_cosine_similarity(...) LIMIT k`, so a sibling campaign's
high-similarity row can never leak into the active campaign's top-k. This is the
regression the issue calls "filter before RRF." (The lore/scene path is
vector-only; the static-rulebook RRF path is unaffected.)

### The sibling lens

Grounding read tools accept an optional `include_sibling_campaigns: boolean`
(default `false`). When `true`, the predicate widens to the whole world — the
deliberate "who else has been here / what else is true elsewhere" lens, opt-in
so it never leaks by default.

## Promotion to canon

Sharing lore is a **column flip**, not a copy:

```sql
UPDATE entities  SET campaign_id = NULL WHERE id = :id;  -- canonize_entity
UPDATE relations SET campaign_id = NULL WHERE id = :id;  -- canonize_relation
```

`decanonize_entity(id, into_campaign)` / `decanonize_relation(...)` set
`campaign_id` back to a named campaign. Both directions are reversible and move
no rows. The ritual: a campaign discovers something, it lives as a
campaign-scoped overlay, and the GM (or player) deliberately **canonizes** it
when it becomes true for the whole world. A freshly initialized sibling campaign
then sees it immediately, with no export/import.

## Fiction onramp: starting a new story in an existing world (FW3, #198)

The visibility model above was built specifically so a **second campaign in
the same world** is cheap: a new `campaign_id`, same `world.duckdb`, and every
read's `campaign_id IS NULL OR campaign_id = :current` predicate does the rest.
What was missing was the *workflow* for actually creating that second
campaign — this section is that workflow, user-facing docs live in
`plugins/ironsworn/README.md`'s "Starting a new story in an existing world".

**Scaffolding.** `ironsworn-init.sh` detects whether the current directory is
already inside an established world in one of two ways:

- **Auto-detect** — walking up from cwd (bounded, mirrors
  `resolveWorldContext`'s walk-up in `world.ts`) looking for
  `world.json`/`world.duckdb`. A match at cwd itself means cwd already IS a
  world root (the existing idempotent re-run case); a match at a strict
  ancestor means cwd is nested inside one (e.g. the user `mkdir`'d
  `campaigns/<id>` under an existing world root and `cd`'d in) — that's a new
  sibling campaign.
- **Explicit `--in-world <path>`** — for a satellite project folder that
  isn't nested under the world root at all. The script computes the relative
  path from cwd to `<path>/campaigns/<id>` and writes it as `SCRIBE_CAMPAIGN`
  in a project-level `.mcp.json` at cwd, so a session opened there points its
  scribe server at the right campaign without ever touching `<path>`'s
  `world.json`/`world.duckdb`.

Either path creates `<world-root>/campaigns/<new-id>/campaign.json` and
**never** writes a second `world.json` or `world.duckdb` — one database,
every sibling campaign. The walk-up/slugify/relative-path algorithm this
implements natively in bash is unit-tested as pure TypeScript in
`packages/core/src/onramp.ts` (`findEnclosingWorldRoot`, `decideInitMode`,
`planCampaignOnramp`); an end-to-end integration test exercising the actual
script lives at `plugins/ironsworn/scripts/test-ironsworn-init-onramp.sh`.

**Canon briefing.** A fresh sibling campaign's first GM session — detected as
zero rows in `scenes` for the active `campaign_id`, combined with non-empty
world canon (so a genuinely brand-new world, which also has zero scenes on
session one, produces an empty briefing and nothing renders) — gets a
**Canon Briefing** context section: world-scoped (`campaign_id IS NULL`)
entities ranked by relation degree, their active relations, and the broadest
community summaries from `recomputeCommunities`. `getCanonBriefing()` in
`packages/core/src/rag/canon-briefing.ts` fetches the data;
`buildCanonBriefingSection()` in `scribe/src/context/build.ts` is the pure
trigger-plus-render half, following the same DB-fetch/pure-render split
`buildContradictionsSection` established for FW1. It's also exposed directly
as the `get_canon_briefing` MCP tool, for re-checking later in the same
campaign. This is the natural complement to the canonize ritual (FW2, #197):
what one campaign blesses into canon is exactly what the next campaign
started in the same world is briefed on.

## Setting seed: inheriting a published setting's canon (FW4, #199)

The onramp above covers *a second campaign in a world you already have*.
"Setting as world seed" (`docs/design/agentic-rpg-v1.md`, "The bridge:
setting as world seed") covers the other direction: packaging a world's
canon as a portable, reusable seed and starting a **brand-new** world from
it. This section is the fiction-facing implementation; the full
npm-installable "setting package" contract (`agenticRpg.kind: "setting"`,
`peerDependencies` on a system) is deferred to the platform work (#7) — the
seed here is a plain JSON file, not a distributable package.

**Format.** A setting seed is `{ schemaVersion, sourceWorld, exportedAt,
entities[], relations[], communities[] }` — the world's `campaign_id IS
NULL` rows, with embeddings and per-campaign columns (`campaign_id`,
`created_in_campaign`, timestamps) stripped since they're re-derived or
irrelevant on import. `packages/core/src/rag/setting-seed.ts` defines the
type and the export/import functions; `SETTING_SEED_SCHEMA_VERSION` gates
compatibility the same way `world.json.schemaVersion` does.

**Export.** `exportSettingSeed()` filters `entities`, `relations` (excluding
invalidated ones), and `lore_communities` to `campaign_id IS NULL` and
serializes them. Exposed as the `export_setting_seed` MCP tool
(`output_path`) — "publish this world as a setting."

**Import.** `importSettingSeed()` reuses the existing per-campaign write
path rather than inserting rows directly: each entity goes through
`upsertLore` (which needs an active campaign context) and is immediately
promoted with `canonizeEntity` — the same primitive the canonize ritual
(FW2) uses. Once both endpoints of a relation are canon, `linkLore` already
resolves the relation's `campaign_id` to `NULL` on its own (its "both
endpoints canon" check), so relations need no separate canonize step. Only
`lore_communities` rows are inserted directly with `campaign_id = NULL`,
since community summaries have no per-campaign write path to reuse. Entity
and community ids are preserved from the seed — safe because this is meant
to run against a freshly-scaffolded, still-empty world. Exposed as the
`import_setting_seed` MCP tool (`input_path`) for merging a setting into an
already-established world on demand.

**World-init round trip.** `ironsworn-init.sh --from-setting <seed.json>`
(fresh-world mode only — mutually exclusive with `--in-world`, since an
existing world already has its own canon) stages the seed file at
`<world-root>/setting-seed.pending.json`. The scribe server has no chance to
run TypeScript at scaffold time (the bash script never touches
`world.duckdb` — it's lazily created on first DB access, same as every other
`ironsworn-init` path), so the actual import happens the first time
`buildContext()` runs: `maybeImportPendingSettingSeed()` in
`scribe/src/context/build.ts` checks for the pending file, imports it, and
renames it to `setting-seed.imported.json` so it runs exactly once. No
separate step for the player or GM to remember — and because the import
lands canon before `getCanonBriefing`/`campaignSceneCount` run in the same
`buildContext` call, a world seeded this way gets the FW3 **Canon Briefing**
on its very first session for free, with no changes needed to that trigger
(`campaignSceneCount === 0` and non-empty canon already covers it).

## Schema (essentials)

```sql
CREATE TABLE entities (
  id              UUID PRIMARY KEY,
  slug            TEXT NOT NULL,        -- legacy/human handle; NOT unique across campaigns
  canonical       TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT [],
  type            TEXT NOT NULL,        -- place|person|faction|material|concept|creature|event|truth|thread
  summary         TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}',
  embedding       FLOAT[768] NOT NULL,
  campaign_id         TEXT,             -- NULL = world canon
  created_in_campaign TEXT NOT NULL,    -- provenance, always set
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
  campaign_id TEXT,                      -- NULL = world-level; set = overlay state
  created_at  TEXT NOT NULL,
  UNIQUE (from_entity, to_entity, label, campaign_id)
);

CREATE TABLE scenes (
  id            UUID PRIMARY KEY,
  campaign_id   TEXT NOT NULL,           -- scenes are always campaign-owned
  place_entity  UUID,                    -- shared geospatial anchor (nullable)
  text          TEXT NOT NULL,
  embedding     FLOAT[768] NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'scene',
  complication_theme TEXT,
  quality_notes TEXT,
  timestamp     TEXT NOT NULL
);

CREATE TABLE scene_entity_refs (
  scene_id  UUID NOT NULL,
  entity_id UUID NOT NULL,
  role      TEXT NOT NULL DEFAULT 'present',  -- present | mentioned | affected
  PRIMARY KEY (scene_id, entity_id)
);
```

`scene_beats`, `lore_provenance`, `lore_communities`, `lore_proximity_edges`,
and `lore_extraction_log` are retained; entity references are UUIDs, and
`lore_communities` / `lore_proximity_edges` gain a `campaign_id` column.
`lore_provenance.subject_id` holds the entity/relation/proximity **UUID** (the
old `from|to|label` composite for relations is replaced by the relation UUID).

NPCs and threads are no longer loose files — they are entities of
`type='person'` and `type='thread'` respectively, with their former fields
folded into `metadata`.

### `world.json` embedding pin

`world.json` is created alongside `world.duckdb`:

```jsonc
{
  "schemaVersion": 1,
  "embedding": { "model": "nomic-embed-text", "version": "1.5", "dim": 768 },
  "name": "<world name>"
}
```

On load, if the active embedder's `{model, version, dim}` differs from the pin,
the server refuses to start with an actionable error. Embeddings from different
models share a vector space only by accident; this guard turns a silent
corruption mode into a loud, recoverable one.

## Migration

A one-time, CLI-gated migration (the directory restructure is user-visible, so
it never runs silently on first start):

```bash
bun run plugins/ironsworn/scribe/src/migrate.ts [campaignPath]
# campaignPath defaults to $SCRIBE_CAMPAIGN, then campaigns/default
```

The SDK entry is `migrateToWorldDb(campaignPath, opts)` in
`packages/core/src/migrations/world-migrate.ts`. Steps:

1. Resolve the world root (one level above the campaign folder) and the
   `campaign_id`; create `world.json` + `world.duckdb` with the full schema.
2. Build a `slug → uuid` map for all `lore_entities`; insert into `entities`
   with `campaign_id = '<id>'`, `created_in_campaign = '<id>'`, `slug`
   preserved, old slug appended to `aliases`.
3. Rewrite `lore_relations`, `lore_proximity_edges`,
   `lore_provenance.subject_id`, and `metadata.community` through the map (a
   second `from|to|label → relation-uuid` map and an `old-prox-id → uuid` map
   drive the provenance rewrite); carry communities and the extraction log.
4. Import `npcs/*.md` as `entities(type='person')` and `threads.yaml` as
   `entities(type='thread')`, scoped to the campaign.
5. Import `scenes` + `scene_beats`, preserving ids and `campaign_id`.
6. Write `campaign.json` if absent.
7. **Count-verify** (`in == out` for entities/relations/proximity/scenes/beats)
   *before* touching any file; throw on mismatch.
8. On success, rename legacy stores to `*.legacy` (Decision 6 — reversible, not
   deleted). The user removes them manually once satisfied.

**Embeddings:** entity/relation/scene/beat embeddings are **copied directly**
from the legacy rows (no re-embed). Only NPC and thread summaries — which had no
stored embedding — are embedded, via Ollama (or an injected embedder in tests).

**Idempotent:** if no legacy `*.duckdb` remain (already migrated), the call
no-ops and returns `alreadyMigrated: true`.

**Known limitation:** a run that fails *after* inserting rows but *before*
moving legacy files cannot be cleanly re-run — the count-verify will mismatch
and throw (it never loses data). Clear the partial `world.duckdb` and retry.

**Legacy scenes** stored no entity references, so migrated scenes start with an
empty `scene_entity_refs`; references accrue going forward via `record_scene`.

## Export / import

`CampaignExport` is **version 3**: entity rows carry `id`/`slug`/`campaign_id`/
`created_in_campaign`; relations carry `id`/`campaign_id`; scenes carry
`campaign_id`/`place_entity`; `scene_entity_refs` is a new top-level array.
Import is idempotent on UUID. v1/v2 exports still import — they land under the
target `campaign_id` with freshly minted UUIDs (slug→uuid map built on import,
same as migration).

## Per-campaign overlay state (reserved)

Per-campaign relations ("the PC has met X", a discovery, a faction shift) anchor
on the **PC entity** (the `type='person'` row for the character), carried by the
`campaign_id` column on `relations` (Decision 7). #166 reserves this mechanism;
it does not yet build overlay-producing features. Multi-PC parties are deferred.

## Tool surface

| Tool | Change |
|---|---|
| `upsert_entity` | **New.** Writes with `campaign_id = current`, `created_in_campaign = current`. |
| `upsert_npc` / `upsert_lore` | **Aliases** of `upsert_entity`, kept one release. |
| `canonize_entity` / `canonize_relation` | **New.** Column flip to `NULL`. |
| `decanonize_entity` / `decanonize_relation` | **New.** Column flip to a named campaign. |
| `search_lore` / `search_lore_global` / `get_lore` / `get_lore_graph` (and other grounding reads) | Apply the visibility filter; accept `include_sibling_campaigns`. |
| `record_scene` | Resolves names to entity UUIDs, auto-stubs unknowns as campaign-scoped entities, writes `scene_entity_refs`. |
| `recompute_communities` | Clusters the **visible** subgraph and stamps results with the active `campaign_id`. |
| `export_setting_seed` / `import_setting_seed` | **New (FW4, #199).** Round-trip `campaign_id IS NULL` canon as a portable JSON setting seed. See "Setting seed" above. |
