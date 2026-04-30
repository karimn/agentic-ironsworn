#!/usr/bin/env bash
# ironsworn-init — scaffold an Ironsworn campaign folder
# Safe to run on an existing campaign: never overwrites any existing file.
set -euo pipefail

CWD="$(pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

created=()
skipped=()

safe_write() {
  local path="$1"
  local content="$2"
  if [ -e "$path" ]; then
    skipped+=("$path")
  else
    mkdir -p "$(dirname "$path")"
    printf '%s' "$content" > "$path"
    created+=("$path")
  fi
}

safe_mkdir() {
  local path="$1"
  if [ -d "$path" ]; then
    skipped+=("$path/")
  else
    mkdir -p "$path"
    created+=("$path/")
  fi
}

echo ""
echo "Ironsworn Campaign Init"
echo "─────────────────────────────────────────"

# ── Phase 1: Scaffold ─────────────────────────────────────────────────────────

# .claude/settings.json
SETTINGS_CONTENT='{
  "statusLine": {
    "type": "command",
    "command": "input=$(cat); cwd=$(echo \"$input\" | jq -r '"'"'.workspace.project_dir'"'"'); char=\"$cwd/campaigns/default/character.json\"; if [ ! -f \"$char\" ]; then exit 0; fi; name=$(jq -r '"'"'.name // \"Hero\"'"'"' \"$char\"); hp=$(jq -r '"'"'.health'"'"' \"$char\"); sp=$(jq -r '"'"'.spirit'"'"' \"$char\"); su=$(jq -r '"'"'.supply'"'"' \"$char\"); mo=$(jq -r '"'"'.momentum'"'"' \"$char\"); echo \"$name | HP:$hp Sp:$sp Su:$su Mo:$mo\""
  },
  "agent": "ironsworn-gm",
  "permissions": {
    "allow": [
      "Bash(bun run *)",
      "Bash(bun install*)"
    ]
  }
}'
safe_write "$CWD/.claude/settings.json" "$SETTINGS_CONTENT"

# CLAUDE.md
CLAUDE_MD_CONTENT='# Ironsworn Campaign

This folder is an Ironsworn solo campaign powered by the [agentic-ironsworn](https://github.com/karimn/agentic-ironsworn) plugin.

## Playing

Start the GM: `@ironsworn-gm`

The agent will resume from the last saved state automatically.

## First-time setup

1. Install the Ironsworn plugin if you have not already:
   ```
   /plugin marketplace add https://github.com/karimn/agentic-ironsworn
   /plugin install ironsworn
   ```

2. Install scribe dependencies (one-time):
   ```bash
   cd ~/.claude/plugins/cache/agentic-ironsworn/ironsworn/*/scribe && bun install
   ```

3. Start Ollama with the embedding model:
   ```bash
   ollama pull nomic-embed-text
   ollama serve
   ```

## Campaign state

Update this section as the campaign evolves.

- **Character:** (not yet created)
- **Open vows:** (none)
'
safe_write "$CWD/CLAUDE.md" "$CLAUDE_MD_CONTENT"

# campaigns/default/
safe_mkdir "$CWD/campaigns/default"

# .gitignore
GITIGNORE_CONTENT='node_modules/
*.duckdb-wal
.env
'
safe_write "$CWD/.gitignore" "$GITIGNORE_CONTENT"

# ── Phase 2: Environment checks ───────────────────────────────────────────────

echo ""
echo "Environment"
echo "─────────────────────────────────────────"

# bun
if command -v bun &>/dev/null; then
  echo "✓ bun $(bun --version)"
else
  echo "✗ bun not found — install from https://bun.sh"
fi

# scribe node_modules
if [ -n "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT/scribe/node_modules" ]; then
  echo "✓ scribe dependencies installed"
elif [ -n "$PLUGIN_ROOT" ]; then
  echo "✗ scribe dependencies missing — run: cd \"$PLUGIN_ROOT/scribe\" && bun install"
else
  echo "? scribe path unknown (CLAUDE_PLUGIN_ROOT not set)"
fi

# Ollama reachable
if curl -s -o /dev/null -w "%{http_code}" http://localhost:11434 2>/dev/null | grep -q "200"; then
  echo "✓ Ollama running"
else
  echo "✗ Ollama not running — start with: ollama serve"
fi

# nomic-embed-text
if command -v ollama &>/dev/null && ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
  echo "✓ nomic-embed-text available"
else
  echo "✗ nomic-embed-text not found — run: ollama pull nomic-embed-text"
fi

# ── Marker ────────────────────────────────────────────────────────────────────

safe_write "$CWD/.claude/.ironsworn-initialized" ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Scaffold"
echo "─────────────────────────────────────────"

for f in "${created[@]+"${created[@]}"}"; do
  echo "  ✓ created  $f"
done
for f in "${skipped[@]+"${skipped[@]}"}"; do
  echo "  – skipped  $f  (already exists)"
done

echo ""
echo "Campaign folder ready. Start the GM with @ironsworn-gm"
echo ""
