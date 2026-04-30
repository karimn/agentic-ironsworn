# Agentic-Ironsworn Marketplace + Ironsworn Plugin — Design

**Date:** 2026-04-29
**Branch:** `feature/marketplace-plugin`
**Status:** Approved

## Goal

Convert `agentic-ironsworn` from a single playable repo into a **Claude Code marketplace** that hosts game plugins. The first plugin, `ironsworn`, bundles everything needed to play solo Ironsworn (GM agent, skills, MCP server, rulebook data) so it can be installed into any Claude Code session in any repo and run end-to-end.

## Non-goals (v1)

- Migrating `TomeRAG.jl` to TypeScript (stays Julia; moves to its own repo).
- Adding additional game plugins beyond `ironsworn`.
- Publishing on a community marketplace directory.
- Automating `bun install` or Ollama model pulls.
- Bundling scribe's runtime dependencies (`node_modules`) or shipping a precompiled binary.

## Architecture at a glance

```
agentic-ironsworn/                     ← marketplace repo root
├── .claude-plugin/
│   └── marketplace.json               ← lists plugins (1 today: ironsworn)
├── plugins/
│   └── ironsworn/                     ← the only plugin, shipped to users
│       ├── .claude-plugin/plugin.json
│       ├── .mcp.json                  ← scribe MCP config
│       ├── README.md
│       ├── agents/ironsworn-gm.md
│       ├── skills/
│       │   ├── ironsworn-world-truths/
│       │   └── ironsworn-character-builder/
│       ├── scribe/                    ← bun+ts MCP server (tests co-located)
│       ├── scripts/sheet.ts
│       └── data/ironsworn/
│           ├── moves.yaml
│           ├── oracles.yaml
│           └── ironsworn.duckdb       ← committed binary (rules RAG)
├── skill-evals/                       ← dev-only, stays at root
├── scripts/import_datasworn.py        ← dev-only
├── docs/
└── README.md                          ← marketplace overview + install cmd
```

### Two runtime anchors

Scribe has to resolve two kinds of paths in different roots once installed:

| Anchor | What it anchors | Source |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Static plugin assets: `data/ironsworn/moves.yaml`, `oracles.yaml`, `ironsworn.duckdb` | Provided by Claude Code at MCP launch |
| Host CWD (via `SCRIBE_CAMPAIGN`) | Mutable campaign state: `character.json`, `scenes.duckdb`, `lore.duckdb`, `npcs/`, `threads/` | Env var, defaults to `campaigns/default` relative to CWD |

This gives users a single design: "the plugin holds the rulebook, your cwd holds your save."

### Plugin `.mcp.json`

```json
{
  "mcpServers": {
    "scribe": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/scribe/src/server.ts"],
      "env": {
        "SCRIBE_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}",
        "SCRIBE_CAMPAIGN": "campaigns/default",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

### Agent frontmatter change

`agents/ironsworn-gm.md` no longer declares its own `mcpServers` block. The plugin-level `.mcp.json` registers scribe; the agent only declares permissions:

```yaml
---
name: ironsworn-gm
description: Solo GM companion for Ironsworn RPG with full rules engine
permissions:
  allow:
    - "mcp__scribe__*"
---
```

## Scribe code changes

Scribe currently resolves static data paths by walking `..` up from `import.meta.url`. That works when scribe lives in the repo it was developed in. Once installed, scribe lives under `~/.claude/plugins/cache/…`, and those relative walks no longer land on the plugin's data dir.

Four files change. The first three follow the **env-var with local fallback** pattern so `bun test` still works with zero config; the fourth (`scripts/sheet.ts`) switches to cwd-relative:

1. **`scribe/src/rules/ironsworn/moves.ts`** (around lines 65–75) — replace the `fileURLToPath`/`..` walk with:
   ```ts
   const MOVES_PATH = process.env.SCRIBE_PLUGIN_ROOT
     ? resolve(process.env.SCRIBE_PLUGIN_ROOT, "data/ironsworn/moves.yaml")
     : <existing relative resolution>;
   ```
2. **`scribe/src/rules/ironsworn/oracles.ts`** — same treatment for `oracles.yaml`.
3. **`scribe/src/rag/query.ts`** (around line 12–23) — same treatment for `ironsworn.duckdb`. Keep the existing `DB_PATH` env override too; `SCRIBE_PLUGIN_ROOT` is a higher-level fallback.
4. **`scripts/sheet.ts`** (lines 12–15) — currently resolves `repoRoot = import.meta.dir + ".."`. After the move to `plugins/ironsworn/scripts/sheet.ts`, that resolves inside the plugin cache, which would make the script read a campaign dir that doesn't exist. Change `repoRoot` to `process.cwd()` so the script reads from the user's host repo when invoked. Usage note in the script's top comment needs a matching update (remove the `scribe/`-relative alias).

`scribe/src/server.ts` **does not change**. `SCRIBE_CAMPAIGN` stays relative to CWD — this is deliberate (confirmed: campaign data lives in the host repo, version-controlled alongside the user's play history).

Campaign-internal DBs (`scenes.duckdb`, `lore.duckdb`) are created on first write by scribe itself — no plugin-bundled artifacts needed.

## Manifests

### `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agentic-ironsworn",
  "description": "Tabletop RPG plugins for Claude Code — solo play companions with full rules engines",
  "owner": { "name": "Karim Naguib" },
  "plugins": [
    {
      "name": "ironsworn",
      "description": "Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph",
      "category": "games",
      "source": "./plugins/ironsworn",
      "homepage": "https://github.com/<owner>/agentic-ironsworn/tree/main/plugins/ironsworn"
    }
  ]
}
```

The `homepage` GitHub URL is filled in once the repo is pushed. Until then it can be omitted.

### `plugins/ironsworn/.claude-plugin/plugin.json`

```json
{
  "name": "ironsworn",
  "version": "0.1.0",
  "description": "Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph",
  "author": { "name": "Karim Naguib" }
}
```

Semver starting at `0.1.0`. Bump per user-facing change.

## TomeRAG.jl extraction

- `TomeRAG.jl/` is build-time only — it generates `ironsworn.duckdb` from markdown rulebook sources. Zero runtime references in `scribe/`, `.claude/`, or `scripts/`.
- Extract to a new standalone repo (`tomerag-jl` or similar), preserving history via `git subtree split` (or `git filter-repo`) so the commit chain is intact.
- After extraction, remove `TomeRAG.jl/` from the marketplace repo.
- Mention the extracted repo in the marketplace-level `README.md` under "Related tools — rulebook RAG ingestion" with a link, so the provenance of `ironsworn.duckdb` is discoverable.

## Dev content — stays at root

`skill-evals/`, `scripts/import_datasworn.py`, and `docs/` are development artifacts — evals, data-regeneration scripts, specs/plans. They stay at the marketplace root and never ship to users. This keeps the plugin directory as the clean "what users install" boundary, and avoids any risk of eval workspaces (`*-workspace/`) being picked up by Claude Code's plugin-component auto-discovery.

## Data in git

- `moves.yaml`, `oracles.yaml` — already tracked, move with `git mv` preserving blame.
- `ironsworn.duckdb` — copy from the user's other machine (it lives in `~/.rpg-data/` there), commit directly into `plugins/ironsworn/data/ironsworn/`. Expected size: tens of MB, comfortably under GitHub's 100 MB per-file limit and under a healthy clone size. If the size measurement on sync turns out materially larger (>50 MB), revisit whether git-lfs is needed before committing.

## Install UX

`plugins/ironsworn/README.md` documents:

1. **Prerequisites**
   - [bun](https://bun.sh) (scribe runtime)
   - [ollama](https://ollama.ai) running locally with `ollama pull nomic-embed-text` (embeddings)
2. **One-time setup after install**
   - `cd ~/.claude/plugins/cache/agentic-ironsworn/ironsworn/*/scribe && bun install`
3. **Starting a campaign**
   - Create a host repo (e.g. `mkdir my-ironsworn && cd my-ironsworn && git init`).
   - Run Claude Code from that repo.
   - `@ironsworn-gm` — agent bootstraps character + world truths on first session.
4. **Env vars** (with defaults):
   - `SCRIBE_CAMPAIGN` — relative to cwd, default `campaigns/default`.
   - `OLLAMA_BASE_URL` — default `http://localhost:11434`.

No auto-install hooks, no startup doctor commands. If Ollama is unavailable or `nomic-embed-text` isn't pulled, scribe returns a clear error at the tool layer — that's enough signal.

The marketplace-level `README.md` lists the install commands:

```
/plugin marketplace add https://github.com/<owner>/agentic-ironsworn
/plugin install ironsworn
```

## Testing & verification

Three checkpoints before calling the migration complete:

1. **Scribe unit tests still pass in place** — `cd plugins/ironsworn/scribe && bun install && bun test`. The env-var-with-fallback pattern means tests run with no env set. Any failure points to a path-resolution regression.
2. **End-to-end plugin install in a scratch repo**:
   - `mkdir /tmp/ironsworn-smoke && cd /tmp/ironsworn-smoke && git init`.
   - `/plugin marketplace add <path-to-agentic-ironsworn>` (local path).
   - `/plugin install ironsworn`.
   - Run `bun install` in the installed scribe dir.
   - Start Claude Code in `/tmp/ironsworn-smoke`, invoke `@ironsworn-gm`, confirm:
     - scribe MCP process starts cleanly
     - `get_character_digest` works against an empty `campaigns/default`
     - `resolve_move` loads from bundled `moves.yaml`
     - `roll_oracle` loads from bundled `oracles.yaml`
     - `search_rules` hits the bundled `ironsworn.duckdb`
     - writes to `campaigns/default/` in `/tmp/ironsworn-smoke`, not in the plugin cache
3. **TomeRAG extraction integrity** — the new standalone repo's log matches the TomeRAG-touching commits in this repo, verified by `git log --oneline -- TomeRAG.jl` comparison.

## Cutover sequence (high level)

Order the implementation plan should follow:

1. Create `plugins/ironsworn/.claude-plugin/plugin.json` skeleton.
2. `git mv` content into place:
   - `.claude/agents/` → `plugins/ironsworn/agents/`
   - `.claude/skills/ironsworn-world-truths/` → `plugins/ironsworn/skills/ironsworn-world-truths/`
   - `.claude/skills/ironsworn-character-builder/` → `plugins/ironsworn/skills/ironsworn-character-builder/`
   - `scribe/` → `plugins/ironsworn/scribe/`
   - `data/ironsworn/moves.yaml`, `oracles.yaml` → `plugins/ironsworn/data/ironsworn/`
   - `scripts/sheet.ts` → `plugins/ironsworn/scripts/sheet.ts`
   - (Leave `skill-evals/`, `scripts/import_datasworn.py`, `docs/` in place.)
3. Write `plugins/ironsworn/.mcp.json`.
4. Strip the inline `mcpServers:` block from `agents/ironsworn-gm.md` frontmatter.
5. Patch the three scribe path-resolution sites to read `SCRIBE_PLUGIN_ROOT` with fallback, and patch `scripts/sheet.ts` to use `process.cwd()` in place of `import.meta.dir + ".."`.
6. Run `bun test` in the new scribe location — must pass unchanged.
7. Sync `ironsworn.duckdb` from the other machine; verify size; commit it into `plugins/ironsworn/data/ironsworn/`.
8. Write `plugins/ironsworn/README.md`.
9. Write `.claude-plugin/marketplace.json` at repo root.
10. Rewrite root `README.md` to describe the marketplace.
11. Extract `TomeRAG.jl/` to a new repo via `git subtree split`; push to GitHub; remove from this repo.
12. Prune root `.gitignore`: drop `data/ironsworn/classic.json` and `data/ironsworn/*.duckdb` entries — the `data/` directory is gone. `campaigns/`, `.worktrees/`, and `LocalPreferences.toml` stay (still relevant at the marketplace root).
13. Run end-to-end plugin-install smoke test per Section "Testing & verification."

## Risks and open questions

- **`ironsworn.duckdb` size on sync** — if it's significantly larger than expected once copied from the other machine, we may need git-lfs. This surfaces at step 7 of cutover; easy to adjust before committing.
- **DuckDB native bindings** — `@duckdb/node-api` uses a native addon. If bun on a different OS/arch can't build it, install fails. Not specific to this migration (same risk today), but the README should mention a supported-platform caveat or a link to the DuckDB native-build docs.
- **Homepage URL** — the final GitHub location is unknown until the repo is pushed. Marketplace.json `homepage` can be filled in post-push.
