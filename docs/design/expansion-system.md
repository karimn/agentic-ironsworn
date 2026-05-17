# Expansion System (DRAFT SPEC)

Status: draft for review. Drives the work to add **Ironsworn: Delve** without
shipping its paid content in the public repo.

## Goal

Let the scribe server load optional, self-contained **expansions** (Delve
first) that contribute new moves, oracles, assets, MCP tools, DB schema,
character state, GM context, and skills — without:

- putting copyrighted/paid content in the public repo,
- duplicating scribe plumbing (DB, state, dice, RAG),
- making the base game depend on any expansion being present.

The base game must run identically whether zero or N expansions are
installed. Absence is the default and is never an error — this mirrors the
existing `existsSync(path) → return []` pattern in `moves.ts`/`oracles.ts`
and the per-section `try/catch` in `context/build.ts`.

## Why not a sibling Claude Code plugin

Delve is an *expansion*, not an independent capability. It mutates the same
character (momentum, health, progress tracks) the scribe server already
owns, and the GM must reason about base + Delve rules in the same turn. Two
plugins means two MCP namespaces, two servers racing on the same campaign
files, and a base GM agent that can't see Delve tools. So: **one scribe
server, a component loader, expansions register into it.** CC's plugin model
stays single-plugin; the expansion boundary lives inside scribe.

## Distribution / licensing boundary

The plugin is distributed via the CC marketplace
(`/plugin marketplace add …`), which clones the **public** repo into
`~/.claude/plugins/cache/…`. Marketplace installs do not fetch private
submodules — so a private Delve repo is simply absent for the public, which
is exactly the desired outcome for paid content.

What lives where:

| Artifact | Public repo (`agentic-rpg`) | Private Delve repo |
|---|---|---|
| Expansion loader, manifest schema, data-source merger, migration namespacing, context extension point | yes | — |
| Stub/example expansion with **no** copyrighted text (for tests/docs) | yes | — |
| Delve move text, oracle tables, asset cards, site/threat content | no | yes |
| Delve-specific server code, migrations, context section | no | yes |

Resolution order for where expansions are found (first hit wins per
expansion name; all discovered expansions load):

1. `SCRIBE_EXPANSIONS_DIR` — explicit external path. The user already keeps
   RPG rules at an allow-listed path
   (`settings.json` → `sandbox.filesystem.allowWrite`), so this is the
   natural home for a local working copy.
2. `${SCRIBE_PLUGIN_ROOT}/expansions/<name>/` — co-located, for a developer
   who clones the private repo here (gitignored; **no `.gitmodules` in the
   public repo** so the private URL is never leaked — see Decision D1).
3. none found → base game only.

An expansion is *active* only if discovered **and** allow-listed via
`SCRIBE_EXPANSIONS=delve,...` (or a campaign config key). Files present but
not allow-listed = inert. This lets a purchaser toggle Delve per campaign.

## Expansion package layout

A directory whose contents are entirely self-describing:

```
<root>/delve/
  expansion.json            # manifest (see schema below)
  data/
    moves.yaml              # same shape as core data/moves.yaml
    oracles.yaml            # same shape as core data/oracles.yaml
    assets.yaml             # same shape as core data/assets.yaml
  server/                   # optional
    index.ts                # export register(server, campaignPath, ctx)
    migrations/lore.ts      # export DbMigration[] (namespaced)
    migrations/scenes.ts
    character.ts            # export CharacterMigration[] (namespaced)
  context/
    section.ts              # export buildSection(campaignPath): Promise<string>
  skills/
    ironsworn-delve-site/SKILL.md
  README.md  LICENSE        # purchaser's own-copy notice
```

### Manifest: `expansion.json`

```jsonc
{
  "name": "delve",                 // unique key; MCP tool + migration namespace
  "version": "1.0.0",              // expansion's own semver
  "ironswornCompat": ">=0.18.0",   // semver range against plugin.json version
  "contributes": {
    "data":       ["moves", "oracles", "assets"],
    "server":     true,
    "migrations": { "lore": true, "scenes": false, "character": true },
    "context":    true,
    "skills":     ["ironsworn-delve-site"]
  },
  "agentBriefing": "Delve is active. Sites are progress tracks of kind 'delve-site'..."
}
```

Loader refuses (warns to stderr, treats as inert) if `ironswornCompat`
doesn't satisfy the running `plugin.json` version.

## Required core changes

### 1. Data merge — moves / oracles / assets

Today `moves.ts`, `oracles.ts`, `assets.ts` each resolve **one** path from
`SCRIBE_PLUGIN_ROOT` and `parse` a single YAML into a lazily-cached
singleton. They must instead read an **ordered list** of sources: core file
first, then each active expansion's file, concatenated.

Proposal: a shared `scribe/src/data/sources.ts`:

```ts
// Returns ordered absolute paths for a dataset, core first then expansions.
export function dataSources(dataset: "moves" | "oracles" | "assets"): string[]
```

`moves.ts` etc. switch from `resolve*Path()` (one path) to
`dataSources("moves")` (many), iterate + concat, keep the singleton cache.

**Conflict policy:** an expansion entry whose `name` collides with a core
entry is a hard error at load (fail fast, logged to stderr) — expansions
must not silently shadow core rules. Cross-expansion collisions: same rule.
(Open question D3: namespace instead of error?)

### 2. Component loader — `server.ts`

New `scribe/src/expansions/loader.ts` exposes the **public interface** every
expansion implements against. Nothing Delve-specific ever lives here.

```ts
// Public contract — expansions import these types, not scribe internals.
export interface ExpansionContext {
  campaignPath: string;
  loadCharacter: typeof import("../state/character.js").loadCharacter;
  saveCharacter: typeof import("../state/character.js").saveCharacter;
  appendJournal:  typeof import("../state/character.js").appendJournal;
  roll:           typeof import("../rules/dice.js").roll;
  getLoreDb:      typeof import("../rag/lore-db.js").getLoreDb;
}
export interface ExpansionModule {
  register(server: McpServer, ctx: ExpansionContext): void;
}
export async function loadExpansions(server, campaignPath): Promise<LoadedExpansion[]>
```

`server.ts` calls `loadExpansions` after the six static
`*.register(server, CAMPAIGN_PATH)` calls. For each active expansion with
`contributes.server`, the loader dynamic-`import()`s the expansion's
`server/index.ts` and calls `register(server, ctx)`.

**`ctx` is the answer to "won't expansions duplicate plumbing?"** — they
borrow scribe's character I/O, dice, and DB handles via the context object
rather than re-implementing or re-importing internals. All expansion tools
land in the single scribe MCP namespace, so the GM agent sees them with no
prompt edit. The private expansion depends on the public plugin's types but
never ships code that belongs in the public repo.

### 3. DB migrations — namespacing

`runDbMigrations(conn, migrations)` tracks a single integer in
`_schema_migrations`. Expansions need their own version line so their
`version: 1` doesn't collide with a future core `version: 1`.

Proposal: add an optional `namespace` param; track `(namespace, version)`.
Core namespace = `""`. This requires one **core** lore/scenes migration
(v1) that adds a `namespace TEXT NOT NULL DEFAULT ''` column (or a parallel
`_schema_migrations_ns` table) — additive, append-only, honors the
"never edit existing entries" rule in CLAUDE.md. Expansion migration arrays
are passed through the same runner under their manifest `name`.

Decision D4: shared DBs with namespaced migrations **vs** a separate
`expansion-<name>.duckdb` per expansion (full isolation, zero core schema
change, but cross-store joins become app-level).

### 4. Character state

`saveCharacter` serializes the typed `Character`; unknown keys are dropped,
so expansions can't just stash fields. Two escape hatches already exist:
`character.customState` and per-asset `customState`. Delve sites are
naturally `progressTracks` — `ProgressTrack.kind` is
`"vow"|"combat"|"journey"|"bond"|"other"`; `"other"` already absorbs them,
or a core migration adds `"delve-site"`.

Proposal: one core character migration introducing a typed passthrough bag
`expansions: Record<string, unknown>` (round-trips untouched), plus keep
sites as `progressTracks` with `kind:"other"` and a discriminator in
`customState`. Avoids leaking Delve concepts into core enums.
(Decision D5: typed `"delve-site"` enum value vs opaque bag.)

### 5. GM context injection

`buildContext` builds fixed sections, each `try/catch` → omit on failure.
Add, after core sections: for each active expansion with
`contributes.context`, dynamic-import `context/section.ts`, call
`buildSection(campaignPath)`, push non-empty result (same graceful pattern).
Also inject the manifest `agentBriefing`. **This is what makes the GM
"aware" of Delve every turn without editing the static
`ironsworn-gm.md`** — active site, its progress, Delve move availability all
arrive in `userPrefix`.

### 6. Skills + agent (CC-visible layer)

CC scans `plugins/ironsworn/skills/*` once at load. An expansion ships its
skills under `skills/`; enabling an expansion **symlinks** them into
`plugins/ironsworn/skills/` (gitignored). `ironsworn-gm.md` stays
expansion-agnostic — it's instructed to use whatever MCP tools exist and to
read the "Active Expansions" context section, rather than hardcoding Delve.

Delivery mechanism: extend `ironsworn-init.sh`, or a new
`/ironsworn-expansion <name> [enable|disable]` command, to (a) verify the
expansion dir, (b) symlink skills, (c) write the allow-list entry.
(Decision D6: symlink-on-enable vs a thin sibling plugin that carries only
the CC-visible skill files.)

## Graceful absence checklist

- data merge: missing expansion file → skipped (existing `existsSync` path)
- loader: dir absent / not allow-listed / compat mismatch → inert, stderr note
- migrations: not run if expansion inactive; namespaced so re-activation resumes
- context: `try/catch` → section omitted
- skills: symlinks absent → CC just doesn't show them
- `plugin.json` Stop-hook version bump still required for **core** loader
  changes; the private expansion versions independently.

## Open decisions (need your call)

- **D1** Private repo as a real git submodule (convenient, but `.gitmodules`
  leaks the private URL) vs gitignored manual clone / `SCRIBE_EXPANSIONS_DIR`
  (no leak). Spec currently assumes the latter.
- **D3** Name collisions: hard error vs auto-namespace expansion entries.
- **D4** Shared DBs + namespaced migrations vs per-expansion `.duckdb`.
- **D5** Sites as core `"delve-site"` track kind vs opaque `expansions` bag.
- **D6** Skill delivery: symlink-on-enable vs sibling skills-only plugin.

## Build order (once decisions land)

1. Manifest schema + `expansions/loader.ts` + `ExpansionContext` (no
   behavior change; nothing to load yet).
2. `data/sources.ts`; refactor moves/oracles/assets to multi-source +
   conflict policy + tests.
3. Migration namespacing core change + tests.
4. Character passthrough bag migration + tests.
5. `buildContext` extension point + tests.
6. Wire `loadExpansions` into `server.ts`.
7. Skill symlink + `/ironsworn-expansion` command + `ironsworn-init.sh`.
8. Stub expansion in public repo exercising every contribution type
   (the test fixture and the documentation example).
9. Private Delve repo authored against the stub's contract.
