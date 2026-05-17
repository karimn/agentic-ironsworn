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
- **`skills/`** — invocable skills (journey, character builder, world truths); each has a `SKILL.md`
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

- **Bun** — runtime for the scribe server and tests
- **Ollama** with `nomic-embed-text` — required for scene/lore embedding (tests that need it are skipped if Ollama is unreachable)
- **DuckDB** native bindings — included via `duckdb` npm package
