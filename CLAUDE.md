# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All scribe commands run from `plugins/ironsworn/scribe/`:

```bash
bun test                        # run all tests
bun test src/rules/dice.test.ts # run a single test file
bun test --watch                # watch mode
bun run tsc --noEmit            # typecheck
bun run src/server.ts           # start MCP server locally
```

## Architecture

This repo ships a single Claude Code plugin: the **Ironsworn solo GM companion**. It has three layers:

### Plugin layer (`plugins/ironsworn/`)
- **`agents/ironsworn-gm.md`** — the GM agent system prompt; the core of gameplay
- **`skills/`** — 11 invocable skills (combat, oracle, scene-craft, etc.); each is a directory with a `SKILL.md`
- **`commands/`** — slash commands: `ironsworn-init` (scaffold a campaign folder) and `extract-session-lore`
- **`scribe/`** — MCP server that backs the agent with persistence and rules logic
- **`.claude-plugin/plugin.json`** — version field; must be bumped on every PR (Stop hook enforces this)
- **`settings.json`** — sandbox permissions and the Stop hook that runs `scripts/check-version-bump.sh`
- **`.mcp.json`** — wires the scribe server; key env vars:
  - `SCRIBE_CAMPAIGN` — campaign directory
  - `OLLAMA_BASE_URL` — Ollama endpoint for embeddings
  - `ANTHROPIC_API_KEY` — required for `recompute_communities` (Claude writes the cluster summaries)
  - `SCRIBE_SUMMARY_MODEL` — optional model override for community summaries (default: `claude-haiku-4-5-20251001`)

### Scribe MCP server (`plugins/ironsworn/scribe/src/`)
Entry point: `server.ts`. Tools are registered from six modules:

| Module | What it exposes |
|--------|----------------|
| `tools/read.ts` | Read-only queries (character, tracks, NPCs, lore, assets) |
| `tools/mechanics.ts` | Dice, move resolution, oracles |
| `tools/mutations.ts` | All character state changes (health, momentum, assets, companions, XP) |
| `tools/narrative.ts` | Scene recording, NPC upserts, thread management |
| `tools/lore.ts` | Knowledge graph CRUD, semantic search, and proximity edges (`link_proximity`, `proximity_distance`, `proximity_within`) |
| `tools/campaign.ts` | Checkpoint, export/import |

Supporting modules:
- `state/` — JSON-backed persistence for character, NPCs, threads
- `rag/scenes.ts` + `rag/lore.ts` — DuckDB + Ollama embedding stores
- `rag/lore-db.ts` — shared DuckDB schema/connection + Ollama embedding client (used by `lore.ts` and `communities.ts`)
- `rag/communities.ts` — GraphRAG community detection + Claude summarization
- `rag/proximity.ts` — weighted spatial/temporal proximity edges with Dijkstra distance + radius queries
- `rag/extraction.ts` — LLM-driven entity/relation extraction from scenes into the lore graph
- `rag/query.ts` — hybrid BM25 + vector search with Reciprocal Rank Fusion
- `rules/` — pure Ironsworn logic (dice, moves, progress, assets, momentum, oracles)
- `context/build.ts` — assembles GM session context from all sources
- `checkpoint.ts` — periodic DuckDB WAL flush (every 5 min or 20 writes)

### Campaign data (lives outside this repo)
A campaign lives in its own directory (default: `campaigns/default/`):
- `character.json` — full character state
- `scenes.duckdb` / `lore.duckdb` — DuckDB stores (require Ollama for embeddings)
- `npcs/`, `threads/` — per-entity markdown/JSON files
- `state-journal.jsonl` — append-only mutation audit log

## Schema migrations

The scribe server has a lightweight migration system in `scribe/src/migrations/`.

**DuckDB (lore + scenes):** Each DB gets a `_schema_migrations` table tracking applied version numbers. `runDbMigrations` is called at the end of each `initDb` in `rag/lore-db.ts` and `rag/scenes.ts` — migrations run automatically on first DB access after server start. Add new entries to `migrations/lore.ts` or `migrations/scenes.ts`:

```ts
{
  version: 1,
  description: "add source_url column to lore_entities",
  async up(conn) {
    await conn.run("ALTER TABLE lore_entities ADD COLUMN IF NOT EXISTS source_url TEXT");
  },
}
```

Also update the corresponding `CREATE TABLE` statement in `initDb` so fresh installs get the column without running the migration.

**Character JSON:** `character.json` carries a `schemaVersion` field. `runCharacterMigrations` is called in `loadCharacter`; if migrations run, the file is saved immediately. `saveCharacter` always stamps the current version. Add entries to `CHARACTER_MIGRATIONS` in `state/character.ts` and bump `CURRENT_CHARACTER_VERSION`:

```ts
{
  toVersion: 1,
  description: "rename bonds to bondCount",
  up(data) { data["bondCount"] = data["bonds"]; delete data["bonds"]; return data; },
}
```

**Rules:** migrations are append-only — never edit or reorder existing entries. Version 0 is the implicit baseline (existing campaigns get the tracking table created but no migrations applied). To squash old migrations: update `initDb` / `CHARACTER_MIGRATIONS` to reflect the current schema, delete the old entries, and bump a baseline version constant in the runner so it skips past them.

## Expansion system

The scribe server supports optional **expansion plugins** — separate CC plugins (typically private repos) that contribute new moves, oracles, assets, MCP tools, DB migrations, and GM context sections without touching this public repo. This is how paid content like Ironsworn: Delve is added.

### How it works

At server startup, `loadExpansions()` in `scribe/src/expansions/loader.ts` reads `~/.claude/plugins/installed_plugins.json`, finds any installed plugin whose name starts with `ironsworn-`, filters by the `SCRIBE_EXPANSIONS` allow-list, and dynamically loads its `server/index.ts`. The loaded expansion receives an `ExpansionContext` with character I/O, dice, DB handles, and the migration runner — it never reimplements scribe plumbing.

### Enabling an expansion

In `.mcp.json`, add to the scribe server env:
```json
"SCRIBE_EXPANSIONS": "delve"
```
Multiple expansions: `"SCRIBE_EXPANSIONS": "delve,other"`. The expansion must be installed as a CC plugin (via `/plugin install <private-url>`) for the loader to find it.

For local dev without a CC install, set `SCRIBE_PLUGINS_JSON` to a JSON file that mimics `installed_plugins.json`:
```json
{
  "version": 2,
  "plugins": {
    "ironsworn-delve@your-private-repo": [{ "installPath": "/path/to/delve", "version": "1.0.0", "scope": "user" }]
  }
}
```

### Building an expansion

The stub at `scribe/src/expansions/stub/` is the canonical example — it shows every contribution type:

| File | Purpose |
|---|---|
| `expansion.json` | Manifest: name, version, `ironswornCompat` range, `contributes` |
| `data/moves.yaml` | Additional moves (same shape as `data/moves.yaml`) |
| `data/oracles.yaml` | Additional oracle tables |
| `data/assets.yaml` | Additional assets |
| `server/index.ts` | `export function register(server, ctx)` — registers MCP tools |
| `context/section.ts` | `export async function buildSection(campaignPath)` — injects GM context |

The `ExpansionContext` type (exported from `loader.ts`) is the full API surface available to expansions. Expansion migrations use `ctx.runDbMigrations(conn, migrations, "your-name")` — a named namespace so version numbers never collide with core.

Full design rationale: `docs/design/expansion-system.md`.

## Plugin versioning

**Every PR must bump `plugins/ironsworn/.claude-plugin/plugin.json`** — the Stop hook blocks completion otherwise. Use semver: bump minor for new tools/features, patch for fixes. The hook compares against `origin/main` and also verifies the version actually increased.

## Parallel agent work

When spawning multiple agents to work on independent issues/PRs in parallel, always pass `isolation: "worktree"` to each `Agent` call. Without it, concurrent agents share the working tree and will conflict on branch checkouts and file edits.

For multi-issue batches (4+ independent issues that benefit from shared learnings), use the **agent-teams** workflow instead of parallel subagents — see `docs/process/team-of-agents-playbook.md`. It documents the full lifecycle: enabling the experimental feature, pre-creating worktrees, shared learnings file, TeamCreate + spawn, lead-as-coordinator pattern, sequenced merge, single follow-up version bump, and cleanup. Proven on umbrella #104 (PRs #109–#112).

## GitHub / gh CLI

- Active account: `karimn` (personal). The enterprise account `kmjq089_azu` is also present but inactive for this repo.
- Git protocol: SSH via the `github-personal` host alias in `~/.ssh/config`
- If `gh` complains about auth, run `gh auth refresh` — the token is stored in keychain and occasionally needs a refresh, not a full re-login
- Do NOT suggest switching to HTTPS or re-running `gh auth login` unless the token is actually missing

## Prerequisites

- **First-time setup:** `cd plugins/ironsworn/scribe && bun install`
- **Bun** — runtime for the scribe server and tests
- **Ollama** with `nomic-embed-text` — required for scene/lore embedding (tests that need it are skipped if Ollama is unreachable)
- **DuckDB** native bindings — included via `duckdb` npm package
