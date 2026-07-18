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

## Starting a new story in an existing world

A world's canon (places, factions, truths blessed via `/canonize`) is meant to
outlive any one campaign. To start a **second story in the same world** —
inheriting its established canon but none of the first campaign's private
scenes, threads, or party-local NPCs — run `/ironsworn-init` again with
`--in-world`:

```bash
# From a fresh folder next to your existing world:
mkdir my-ironsworn-sandbox && cd my-ironsworn-sandbox
/ironsworn-init --in-world ../my-ironsworn sandbox "Sandbox"
```

- `../my-ironsworn` is the path to the **existing** world root (the folder
  with `world.json`/`world.duckdb` — i.e. wherever you first ran
  `/ironsworn-init`). It is never modified: no new database, no new
  `world.json`.
- `sandbox` / `"Sandbox"` are the new campaign's id/name (both optional —
  derived from the current folder name if omitted).
- This folder becomes a small satellite project: its own `CLAUDE.md`,
  `.claude/settings.json`, and a `.mcp.json` that points the scribe server at
  `../my-ironsworn/campaigns/sandbox`.

If you'd rather create the new campaign's folder directly under the existing
world (instead of a separate satellite project), that also works without any
flag — `ironsworn-init` auto-detects it:

```bash
cd my-ironsworn
mkdir campaigns/sandbox && cd campaigns/sandbox
/ironsworn-init
```

Either way, invoke the GM as usual (`@ironsworn-gm`). On the very first
session — before any scene has been recorded for this campaign — it presents
a **canon briefing**: the world's established entities, relations, and
community summaries, so you can situate the new character in inherited
fiction rather than starting from nothing. See `docs/design/world-db.md` for
the full visibility model this rests on.

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

## License & Attribution

The plugin code is released under the [MIT License](../../LICENSE).

This plugin includes content from **Ironsworn** by Shawn Tomkin
(www.ironswornrpg.com), licensed under the Creative Commons
Attribution-NonCommercial-ShareAlike 4.0 International License
(https://creativecommons.org/licenses/by-nc-sa/4.0/).

> This work is based on Ironsworn (found at www.ironswornrpg.com), created by
> Shawn Tomkin, and licensed for our use under the Creative Commons
> Attribution-NonCommercial-ShareAlike 4.0 International license
> (creativecommons.org/licenses/by-nc-sa/4.0/).

This is **not** an official Ironsworn product.

## Caveats

- `@duckdb/node-api` uses a native addon. If `bun install` fails on your OS,
  see the DuckDB project's native-bindings docs. On macOS and Linux x86_64
  and arm64 it should just work.
