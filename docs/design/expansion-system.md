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

## Plugin architecture

Delve is a **CC plugin with no MCP server of its own**. This sidesteps the
original objections to sibling plugins (namespace collision, racing writes,
agent blindness) because there is only ever one MCP server — the core
scribe. Delve's tools register into it at startup via the expansion loader.

CC handles what it's good at for the Delve plugin: installation, versioning,
updates, and skill loading. Scribe handles what it must own: state, tools,
and DB. The two roles don't overlap.

## Distribution / licensing boundary

What lives where:

| Artifact | Public repo (`agentic-rpg`) | Private Delve CC plugin |
|---|---|---|
| Expansion loader, manifest schema, data-source merger, migration namespacing, context extension point | yes | — |
| Stub/example expansion with **no** copyrighted text (for tests/docs) | yes | — |
| Delve move text, oracle tables, asset cards, site/threat content | no | yes |
| Delve-specific server code, migrations, context section, skills | no | yes |

**Delve is a separate CC plugin** installed from a private repo via
`/plugin install <private-url>`. CC places it in
`~/.claude/plugins/cache/<repo>/ironsworn-delve/<version>/` and tracks it in
`~/.claude/plugins/installed_plugins.json` with an `installPath` field.

**Discovery:** the expansion loader reads `installed_plugins.json` at server
startup, finds any entry whose key matches `ironsworn-delve@*`, and uses
`installPath` directly — no path construction, no hardcoded repo name.
Users without the private plugin simply have no matching entry; discovery
returns nothing and the base game runs unaffected.

```ts
const json = JSON.parse(readFileSync(join(homedir(), ".claude/plugins/installed_plugins.json"), "utf-8"));
const entry = Object.entries(json.plugins).find(([k]) => k.startsWith("ironsworn-delve@"));
const installPath = entry?.[1][0].installPath; // absolute, ready to use
```

**Skills** declared in Delve's `skills/` directory are loaded by CC
automatically when the plugin is installed — no symlinks, no enable command,
version-tracked alongside the plugin itself.

An expansion is *active* only if discovered **and** allow-listed via
`SCRIBE_EXPANSIONS=delve,...` (or a campaign config key), so a purchaser can
toggle Delve per campaign without uninstalling it.

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
entry is a hard error at load (fail fast, logged to stderr, expansion treated
as inert) — expansions must not silently shadow core rules. Cross-expansion
collisions: same rule.

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

**Implemented.** Core migrations track applied versions in `_schema_migrations`
(single `version INTEGER PRIMARY KEY`). Expansion migrations use a parallel
`_schema_migrations_ns (namespace TEXT, version INTEGER, PRIMARY KEY(namespace,
version))` table so their `version: 1` never collides with a core `version: 1`
or with another expansion's `version: 1`.

The internal `runDbMigrations(conn, migrations, namespace)` dispatcher routes
to the correct table based on whether `namespace` is empty (core) or non-empty
(expansion). `ExpansionContext.runDbMigrations` is a bound closure that
automatically passes the expansion's manifest `name` as the namespace — expansion
authors call `ctx.runDbMigrations(conn, myMigrations)` and never need to know
their own name. The binding is constructed in `loadExpansions()` in `loader.ts`.


### 4. Character state

`saveCharacter` serializes the typed `Character`; unknown keys are dropped,
so expansions can't just stash fields. Two escape hatches already exist:
`character.customState` and per-asset `customState`. Delve sites are
naturally `progressTracks` — `ProgressTrack.kind` is
`"vow"|"combat"|"journey"|"bond"|"other"`; `"other"` already absorbs them,
or a core migration adds `"delve-site"`.

Core character migration v1 adds `"delve-site"` to `ProgressTrack.kind`.
Sites are first-class progress tracks; the Delve expansion creates them with
this kind and can query/filter them directly. `CURRENT_CHARACTER_VERSION`
bumps to 1; the migration is a no-op on existing data (just widens the
allowed enum, no field changes needed).

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

CC loads skills from every installed plugin automatically. Delve's `skills/`
directory is part of the Delve CC plugin, so CC handles delivery, versioning,
and loading with no extra machinery. `ironsworn-gm.md` stays
expansion-agnostic — it uses whatever MCP tools exist and reads the "Active
Expansions" context section injected by step 5, rather than hardcoding Delve.

The Delve plugin's `.claude-plugin/plugin.json` declares no `.mcp.json`,
so CC never tries to start a second MCP server for it.

## Graceful absence checklist

- data merge: missing expansion file → skipped (existing `existsSync` path)
- loader: dir absent / not allow-listed / compat mismatch → inert, stderr note
- migrations: not run if expansion inactive; namespaced so re-activation resumes
- context: `try/catch` → section omitted
- skills: Delve plugin not installed → CC never loads its skills
- `plugin.json` Stop-hook version bump still required for **core** loader
  changes; the private expansion versions independently.

## Decisions (settled)

- **D1** Delve is a separate CC plugin installed from a private repo URL.
  Discovered at runtime via `~/.claude/plugins/installed_plugins.json`
  (`installPath` field). No submodule, no symlinks, no hardcoded paths.
  Version tracking and skill loading handled by CC for free.
- **D2** All Delve code (logic, migrations, context, skills) lives in the
  private plugin repo. The public repo exposes only the SDK interfaces.
- **D3** Name collisions between expansion entries and core: hard error at
  load (logged to stderr, expansion treated as inert).
- **D4** Shared DBs with namespaced migrations.
- **D5** `"delve-site"` added to the core `ProgressTrack.kind` union via a
  core character migration. Sites are first-class progress tracks.
- **D6** Skill delivery: CC-native; no install step needed.

## Build order

1. Manifest schema + `expansions/loader.ts` + `ExpansionContext` (no
   behavior change; nothing to load yet). Loader reads
   `installed_plugins.json` to discover installed expansion plugins.
2. `data/sources.ts`; refactor moves/oracles/assets to multi-source +
   conflict policy + tests.
3. Migration namespacing core change + tests.
4. `"delve-site"` character migration + tests.
5. `buildContext` extension point + tests.
6. Wire `loadExpansions` into `server.ts`.
7. Stub expansion in public repo exercising every contribution type
   (test fixture and documentation example).
8. Private Delve CC plugin repo authored against the stub's contract.
