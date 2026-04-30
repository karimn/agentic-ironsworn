# Design: `/ironsworn-init` Campaign Scaffolding Command

**Date:** 2026-04-30  
**Status:** Approved

---

## Overview

A slash command and first-run prompt that sets up a folder as an Ironsworn campaign. Safe to run in an existing campaign — only creates what's missing, never overwrites.

---

## Components

### 1. `/ironsworn-init` slash command

**File:** `plugins/ironsworn/commands/ironsworn-init.sh`

A shell script invoked in the current working directory. Two phases:

#### Phase 1 — Scaffold missing files

Each file/directory is only created if it does not already exist (`-e` / `-d` check before every write — no exceptions, no merging).

| Path | Contents |
|------|----------|
| `.claude/settings.json` | `statusLine` (reads `campaigns/default/character.json`), `agent: "ironsworn-gm"`, scribe MCP permissions |
| `CLAUDE.md` | Setup and play instructions |
| `campaigns/default/` | Empty directory (created with `mkdir -p` only if absent) |
| `.gitignore` | Ignores `node_modules`, `*.duckdb-wal`, `.env` |
| `.claude/.ironsworn-initialized` | Marker file — written last, signals setup is complete |

**Safety invariant:** The script never uses `>` to overwrite. Every write is guarded by `if [ ! -e "$path" ]`. If `campaigns/` already exists in any form, the entire directory is left untouched.

#### Phase 2 — Environment checks

Informational only. Each check prints a status line; none block or modify anything.

| Check | Command | Action if failing |
|-------|---------|-------------------|
| `bun` installed | `which bun` | Warn, print install URL |
| scribe `node_modules` | `[ -d <plugin-scribe>/node_modules ]` | Warn, print `bun install` command |
| Ollama reachable | `curl -s -o /dev/null localhost:11434` | Warn, print `ollama serve` |
| `nomic-embed-text` pulled | `ollama list \| grep nomic-embed-text` | Warn, print `ollama pull nomic-embed-text` |

Output example:
```
✓ bun 1.1.x
✓ scribe dependencies installed
✗ Ollama not running — start with: ollama serve
✗ nomic-embed-text not found — run: ollama pull nomic-embed-text
```

---

### 2. `SessionStart` first-run hook

**File:** `plugins/ironsworn/hooks/hooks.json`

Fires at the start of every session. Checks for `.claude/.ironsworn-initialized` in `$PWD`.

- **Marker present:** hook exits silently (no output, no context injection)
- **Marker absent:** hook returns `additionalContext` instructing Claude to open the session with a direct prompt:

> *"This folder isn't set up as an Ironsworn campaign yet. Would you like to run `/ironsworn-init` to set it up?"*

If the user declines, Claude writes `.claude/.ironsworn-initialized` immediately so the prompt never appears again. If the user accepts, `/ironsworn-init` writes the marker at the end of its run.

The hook does **not** use `AskUserQuestion` or any interactive mechanism — it injects context and lets Claude handle the conversation naturally.

---

## File layout

```
plugins/ironsworn/
├── commands/
│   └── ironsworn-init.sh       # slash command implementation
├── hooks/
│   └── hooks.json              # SessionStart hook
└── .claude-plugin/
    └── plugin.json             # version bump to 0.2.0
```

---

## Out of scope

- Character creation / stat entry (handled by `ironsworn-gm` agent)
- Multiple campaign support (always targets `campaigns/default/`)
- Automatic Ollama start or bun install (checks are advisory only)
