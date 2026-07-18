---
description: Scaffold the current folder as an Ironsworn campaign, start a new campaign in an existing world, or seed a fresh world from a published setting (safe to re-run — never overwrites existing files)
argument-hint: "[--in-world <path-to-existing-world-root>] [--from-setting <seed.json>] [campaign-id] [campaign-name]"
allowed-tools: ["Bash"]
---

Run the ironsworn-init scaffold script using Bash, passing through any arguments the user gave:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/commands/ironsworn-init.sh" $ARGUMENTS
```

Three modes:
- **No arguments** — scaffolds the current folder as a fresh world (or, if the current folder is already nested inside an existing world's `campaigns/` tree, auto-detects that and scaffolds a new sibling campaign there instead — see below).
- **`--in-world <path> [campaign-id] [campaign-name]`** — starts a *new campaign in an existing world*: a second (or third, ...) story that inherits the world's established canon without a new database and without touching the prior campaign's private scenes/threads/NPCs. `<path>` must point at a directory that already has `world.json`/`world.duckdb` (the world root of an existing campaign). If `campaign-id`/`campaign-name` are omitted, they're derived from the current folder name.
- **`--from-setting <seed.json>`** — fresh-world mode only, seeds the new world from a published setting's canon (a JSON file produced by the `export_setting_seed` MCP tool). The scribe server imports it as world canon automatically on the world's first session; nothing further to do. Mutually exclusive with `--in-world`.

Show the script output verbatim to the user without summarizing it. If the script exits non-zero (e.g. `--in-world` pointed at a path that isn't an existing world root, or `--from-setting` was combined with `--in-world` or given a nonexistent/malformed file), surface the error message plainly rather than retrying with guessed arguments.
