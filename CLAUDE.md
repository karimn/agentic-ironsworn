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
- **`.mcp.json`** — wires the scribe server; key env vars: `SCRIBE_CAMPAIGN` (campaign dir), `OLLAMA_BASE_URL`

### Scribe MCP server (`plugins/ironsworn/scribe/src/`)
Entry point: `server.ts`. Tools are registered from six modules:

| Module | What it exposes |
|--------|----------------|
| `tools/read.ts` | Read-only queries (character, tracks, NPCs, lore, assets) |
| `tools/mechanics.ts` | Dice, move resolution, oracles |
| `tools/mutations.ts` | All character state changes (health, momentum, assets, companions, XP) |
| `tools/narrative.ts` | Scene recording, NPC upserts, thread management |
| `tools/lore.ts` | Knowledge graph CRUD and semantic search |
| `tools/campaign.ts` | Checkpoint, export/import |

Supporting modules:
- `state/` — JSON-backed persistence for character, NPCs, threads
- `rag/scenes.ts` + `rag/lore.ts` — DuckDB + Ollama embedding stores
- `rules/` — pure Ironsworn logic (dice, moves, progress, assets, momentum, oracles)
- `context/build.ts` — assembles GM session context from all sources
- `checkpoint.ts` — periodic DuckDB WAL flush (every 5 min or 20 writes)

### Campaign data (lives outside this repo)
A campaign lives in its own directory (default: `campaigns/default/`):
- `character.json` — full character state
- `scenes.duckdb` / `lore.duckdb` — DuckDB stores (require Ollama for embeddings)
- `npcs/`, `threads/` — per-entity markdown/JSON files
- `state-journal.jsonl` — append-only mutation audit log

## Plugin versioning

**Every PR must bump `plugins/ironsworn/.claude-plugin/plugin.json`** — the Stop hook blocks completion otherwise. Use semver: bump minor for new tools/features, patch for fixes. The hook compares against `origin/main` and also verifies the version actually increased.

## Parallel agent work

When spawning multiple agents to work on independent issues/PRs in parallel, always pass `isolation: "worktree"` to each `Agent` call. Without it, concurrent agents share the working tree and will conflict on branch checkouts and file edits.

## Prerequisites

- **Bun** — runtime for the scribe server and tests
- **Ollama** with `nomic-embed-text` — required for scene/lore embedding (tests that need it are skipped if Ollama is unreachable)
- **DuckDB** native bindings — included via `duckdb` npm package
