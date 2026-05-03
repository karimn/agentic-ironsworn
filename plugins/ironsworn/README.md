# Ironsworn — Solo GM companion for Claude Code

A Claude Code plugin that lets you play solo Ironsworn with a full rules engine:
dice, oracle tables, momentum, debilities, progress tracks, and a living lore
graph that remembers the places, people, and factions you build as you play.

## Prerequisites

- [bun](https://bun.sh) — runs the scribe MCP server
- [ollama](https://ollama.ai) with the embedding model pulled:
  ```bash
  ollama pull nomic-embed-text
  ```
  Ollama must be running locally (default `http://localhost:11434`) whenever
  scribe needs to embed scenes, lore, or rules queries.

## Install

```
/plugin marketplace add https://github.com/karimn/agentic-rpg
/plugin install ironsworn
```

## One-time setup

Scribe has native dependencies (DuckDB). Install them once after the plugin
lands on disk:

```bash
cd ~/.claude/plugins/cache/agentic-rpg/ironsworn/*/scribe
bun install
```

## Starting a campaign

1. Create (or `cd` into) a host repo — this is where your save lives:
   ```bash
   mkdir my-ironsworn && cd my-ironsworn && git init
   ```
2. Start Claude Code in that directory.
3. Invoke the GM: `@ironsworn-gm`.
   - On first run the agent will bootstrap a character and walk you through
     the world truths.
   - On subsequent runs it resumes from `campaigns/default/`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SCRIBE_CAMPAIGN` | `campaigns/default` | Campaign directory, relative to cwd |
| `SCRIBE_PLUGIN_ROOT` | set by Claude Code | Plugin install root (auto-wired) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP endpoint |

## What scribe writes to your cwd

Everything under `<SCRIBE_CAMPAIGN>/`:

- `character.json` — character sheet
- `scenes.duckdb` — embedded scene summaries (created on first record_scene)
- `lore.duckdb` — lore entity graph (created on first upsert_lore)
- `npcs/*.json`, `threads/*.json` — narrative state

Version-control these if you want a replayable save.

## Caveats

- `@duckdb/node-api` uses a native addon. If `bun install` fails on your OS,
  see the DuckDB project's native-bindings docs. On macOS and Linux x86_64
  and arm64 it should just work.
