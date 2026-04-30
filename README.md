# agentic-ironsworn

A small [Claude Code](https://claude.com/claude-code) marketplace for
tabletop RPG play companions. Each plugin bundles the agent, skills, and
MCP server needed to play a specific game system inside any Claude Code
session.

## Plugins

| Plugin | Description |
|---|---|
| [`ironsworn`](./plugins/ironsworn/) | Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph |

## Install

```
/plugin marketplace add https://github.com/karimn/agentic-ironsworn
/plugin install ironsworn
```

## Development

This repo is structured so that everything shipped to users lives under
`plugins/<plugin-name>/`, and everything at the top level (`skill-evals/`,
`scripts/`, `docs/`) is for plugin development only and is never installed.

The rulebook RAG ingestion pipeline used to build
`plugins/ironsworn/data/ironsworn.duckdb` is a separate Julia project:
[TomeRAG.jl](https://github.com/karimn/tomerag-jl).
