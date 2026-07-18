#!/usr/bin/env bash
# ironsworn-init — scaffold an Ironsworn campaign folder
# Safe to run on an existing campaign: never overwrites any existing file.
#
# Two modes:
#   (no flags)                     Fresh world — scaffold world.json + campaigns/default here.
#   --in-world <path> [id] [name]  New campaign in an EXISTING world at <path> (FW3, #198):
#                                   creates <path>/campaigns/<id>/campaign.json, never touches
#                                   <path>/world.json or world.duckdb, and turns this folder into
#                                   a satellite project (a .mcp.json pointed at the new campaign,
#                                   plus the usual CLAUDE.md / .claude/settings.json / .gitignore).
#   (no flags, auto-detected)      Same as --in-world, but the existing world is found by walking
#                                   up from CWD — the common case when you mkdir'd campaigns/<id>
#                                   yourself under an existing world root and cd'd into it.
#
# See "Starting a new campaign in an existing world" in plugins/ironsworn/README.md
# and the "Fiction onramp" section of docs/design/world-db.md.
set -euo pipefail

CWD="$(pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

# Resolve plugin root from installed_plugins.json if CLAUDE_PLUGIN_ROOT is unset
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT=$(jq -r '(.plugins | to_entries[] | select(.key | startswith("ironsworn@")) | .value[0].installPath) // ""' ~/.claude/plugins/installed_plugins.json 2>/dev/null || true)
fi

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

# ── Argument parsing ───────────────────────────────────────────────────────────
IN_WORLD_PATH=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --in-world)
      IN_WORLD_PATH="${2:-}"
      shift 2
      ;;
    --in-world=*)
      IN_WORLD_PATH="${1#*=}"
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
CAMPAIGN_ID_ARG="${POSITIONAL[0]:-}"
CAMPAIGN_NAME_ARG="${POSITIONAL[1]:-}"

# ── New-campaign-in-existing-world detection (FW3, #198) ──────────────────────
# Mirrors resolveWorldContext's walk-up (packages/core/src/world.ts) and its
# pure, unit-tested counterpart packages/core/src/onramp.ts
# (findEnclosingWorldRoot / decideInitMode): walk up from CWD looking for
# world.json or world.duckdb, bounded so a deep or symlink-looped tree can't
# hang the script. Implemented natively in bash (not by shelling out to the
# TS helper) so detection has no runtime dependency on bun workspace linking
# being installed yet — this is meant to work on a bare-bones first run.
MAX_WALK_LEVELS=25

has_world_files() {
  [ -e "$1/world.json" ] || [ -e "$1/world.duckdb" ]
}

WORLD_ROOT=""
IS_SELF="false"

if [ -n "$IN_WORLD_PATH" ]; then
  if [ ! -d "$IN_WORLD_PATH" ]; then
    echo "✗ --in-world path '$IN_WORLD_PATH' does not exist." >&2
    exit 1
  fi
  RESOLVED_WORLD_ROOT="$(cd "$IN_WORLD_PATH" && pwd)"
  if ! has_world_files "$RESOLVED_WORLD_ROOT"; then
    echo "✗ --in-world path '$RESOLVED_WORLD_ROOT' has no world.json or world.duckdb — it is not an existing world root." >&2
    exit 1
  fi
  WORLD_ROOT="$RESOLVED_WORLD_ROOT"
else
  current="$CWD"
  level=0
  while [ "$level" -le "$MAX_WALK_LEVELS" ]; do
    if has_world_files "$current"; then
      WORLD_ROOT="$current"
      if [ "$current" = "$CWD" ]; then IS_SELF="true"; fi
      break
    fi
    parent="$(dirname "$current")"
    if [ "$parent" = "$current" ]; then break; fi
    current="$parent"
    level=$((level + 1))
  done
fi

# Explicit --in-world always means "new campaign", even if CWD happens to
# already be some other world's root. Auto-detection only counts when the
# match was a strict ancestor (IS_SELF=false) — a match at CWD itself means
# CWD already IS the world root, so this is the existing idempotent re-run,
# not a new sibling campaign.
NEW_CAMPAIGN_MODE="false"
if [ -n "$WORLD_ROOT" ] && { [ -n "$IN_WORLD_PATH" ] || [ "$IS_SELF" != "true" ]; }; then
  NEW_CAMPAIGN_MODE="true"
fi

# Compute a relative path from $1 (absolute base dir) to $2 (absolute target
# dir) — pure string arithmetic, portable across macOS/Linux (unlike
# `realpath --relative-to`, which is GNU-only). Mirrors
# packages/core/src/onramp.ts's planCampaignOnramp (backed by node:path's
# `relative()`, unit-tested there).
relative_path() {
  local base="$1" target="$2"
  if [ "$base" = "$target" ]; then
    printf '.'
    return
  fi
  local IFS='/'
  local base_parts=($base)
  local target_parts=($target)
  local i=0
  while [ "$i" -lt "${#base_parts[@]}" ] && [ "$i" -lt "${#target_parts[@]}" ] && [ "${base_parts[$i]}" = "${target_parts[$i]}" ]; do
    i=$((i + 1))
  done
  local up="" rest="" j
  j=$i
  while [ "$j" -lt "${#base_parts[@]}" ]; do
    if [ -n "${base_parts[$j]}" ]; then up="${up}../"; fi
    j=$((j + 1))
  done
  j=$i
  while [ "$j" -lt "${#target_parts[@]}" ]; do
    if [ -n "${target_parts[$j]}" ]; then rest="${rest}${target_parts[$j]}/"; fi
    j=$((j + 1))
  done
  local result="${up}${rest}"
  result="${result%/}"
  if [ -z "$result" ]; then result="."; fi
  printf '%s' "$result"
}

# Slugify free text into a filesystem/campaign-id-safe slug. Mirrors
# packages/core/src/onramp.ts's slugifyCampaignId (unit-tested there); the
# "campaign" fallback for an all-symbolic input is applied by the caller,
# same as the TS version.
slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

# Title-case a dash-separated slug, e.g. "iron-sandbox" -> "Iron Sandbox".
# Mirrors packages/core/src/onramp.ts's titleCaseFromSlug.
titlecase() {
  printf '%s' "$1" | awk -F'-' '{ out=""; for (i=1;i<=NF;i++) { if ($i != "") { w=$i; out = out (out=="" ? "" : " ") toupper(substr(w,1,1)) substr(w,2) } } print out }'
}

if [ "$NEW_CAMPAIGN_MODE" = "true" ]; then
  RAW_ID="${CAMPAIGN_ID_ARG:-$(basename "$CWD")}"
  NEW_CAMPAIGN_ID="$(slugify "$RAW_ID")"
  if [ -z "$NEW_CAMPAIGN_ID" ]; then NEW_CAMPAIGN_ID="campaign"; fi
  NEW_CAMPAIGN_NAME="${CAMPAIGN_NAME_ARG:-$(titlecase "$NEW_CAMPAIGN_ID")}"
  if [ -z "$NEW_CAMPAIGN_NAME" ]; then NEW_CAMPAIGN_NAME="New Campaign"; fi

  CAMPAIGN_DIR="$WORLD_ROOT/campaigns/$NEW_CAMPAIGN_ID"
  SCRIBE_CAMPAIGN_VALUE="$(relative_path "$CWD" "$CAMPAIGN_DIR")"
fi

echo ""
echo "Ironsworn Campaign Init"
echo "─────────────────────────────────────────"
if [ "$NEW_CAMPAIGN_MODE" = "true" ]; then
  echo "Mode: new campaign in an existing world"
  echo "  World root:    $WORLD_ROOT"
  echo "  Campaign id:   $NEW_CAMPAIGN_ID"
  echo "  Campaign name: $NEW_CAMPAIGN_NAME"
fi

# ── Phase 1: Scaffold ─────────────────────────────────────────────────────────

# .claude/settings.json
# The statusLine command uses \\033 (double-escaped) so ANSI codes survive JSON embedding.
STATUS_LINE_JSON='{
    "type": "command",
    "command": "input=$(cat); cwd=$(echo \"$input\" | jq -r '"'"'.workspace.project_dir'"'"'); char=\"$cwd/campaigns/default/character.json\"; if [ ! -f \"$char\" ]; then exit 0; fi; name=$(jq -r '"'"'.name // \"Hero\"'"'"' \"$char\"); fe=$(jq -r '"'"'.stats.iron // \"?\"'"'"' \"$char\"); ed=$(jq -r '"'"'.stats.edge // \"?\"'"'"' \"$char\"); sh=$(jq -r '"'"'.stats.shadow // \"?\"'"'"' \"$char\"); ht=$(jq -r '"'"'.stats.heart // \"?\"'"'"' \"$char\"); wt=$(jq -r '"'"'.stats.wits // \"?\"'"'"' \"$char\"); hp=$(jq -r '"'"'.health'"'"' \"$char\"); sp=$(jq -r '"'"'.spirit'"'"' \"$char\"); su=$(jq -r '"'"'.supply'"'"' \"$char\"); mo=$(jq -r '"'"'.momentum'"'"' \"$char\"); xp=$(jq -r '"'"'.experience // 0'"'"' \"$char\"); pv=$(jq -r '"'"'(.plugins | to_entries[] | select(.key | startswith("ironsworn@")) | .value[0].version) // "?"'"'"' ~/.claude/plugins/installed_plugins.json 2>/dev/null || echo '"'"'?'"'"'); colorval(){ v=$1; if [ \"$v\" -le 1 ] 2>/dev/null; then printf '"'"'\\033[31m%s\\033[0m'"'"' \"$v\"; elif [ \"$v\" -le 3 ] 2>/dev/null; then printf '"'"'\\033[38;5;208m%s\\033[0m'"'"' \"$v\"; else printf '"'"'\\033[32m%s\\033[0m'"'"' \"$v\"; fi; }; echo \"$name | Fe:$fe Ed:$ed Sh:$sh Ht:$ht Wt:$wt | HP:$(colorval $hp) Sp:$(colorval $sp) Su:$(colorval $su) Mo:$mo XP:$xp | is:$pv\""
  }'
# In new-campaign mode, character.json never lives at "campaigns/default"
# relative to this folder — rewrite the statusLine to read this satellite's
# own campaign path (same one written into .mcp.json's SCRIBE_CAMPAIGN below)
# so stats still render instead of silently going blank.
if [ "$NEW_CAMPAIGN_MODE" = "true" ]; then
  STATUS_LINE_JSON="${STATUS_LINE_JSON//campaigns\/default\/character.json/${SCRIBE_CAMPAIGN_VALUE}\/character.json}"
fi
# The old default (stats, no XP/version) — used to detect an un-customized statusLine on upsert.
OLD_STATUS_LINE_JSON='{
    "type": "command",
    "command": "input=$(cat); cwd=$(echo \"$input\" | jq -r '"'"'.workspace.project_dir'"'"'); char=\"$cwd/campaigns/default/character.json\"; if [ ! -f \"$char\" ]; then exit 0; fi; name=$(jq -r '"'"'.name // \"Hero\"'"'"' \"$char\"); fe=$(jq -r '"'"'.stats.iron // \"?\"'"'"' \"$char\"); ed=$(jq -r '"'"'.stats.edge // \"?\"'"'"' \"$char\"); sh=$(jq -r '"'"'.stats.shadow // \"?\"'"'"' \"$char\"); ht=$(jq -r '"'"'.stats.heart // \"?\"'"'"' \"$char\"); wt=$(jq -r '"'"'.stats.wits // \"?\"'"'"' \"$char\"); hp=$(jq -r '"'"'.health'"'"' \"$char\"); sp=$(jq -r '"'"'.spirit'"'"' \"$char\"); su=$(jq -r '"'"'.supply'"'"' \"$char\"); mo=$(jq -r '"'"'.momentum'"'"' \"$char\"); colorval(){ v=$1; if [ \"$v\" -le 1 ] 2>/dev/null; then printf '"'"'\\033[31m%s\\033[0m'"'"' \"$v\"; elif [ \"$v\" -le 3 ] 2>/dev/null; then printf '"'"'\\033[38;5;208m%s\\033[0m'"'"' \"$v\"; else printf '"'"'\\033[32m%s\\033[0m'"'"' \"$v\"; fi; }; echo \"$name | Fe:$fe Ed:$ed Sh:$sh Ht:$ht Wt:$wt | HP:$(colorval $hp) Sp:$(colorval $sp) Su:$(colorval $su) Mo:$mo\""
  }'
SETTINGS_TEMPLATE='{
  "statusLine": '"$STATUS_LINE_JSON"',
  "agent": "ironsworn-gm",
  "permissions": {
    "allow": [
      "Bash(bun run *)",
      "Bash(bun install*)"
    ]
  }
}'
SETTINGS_PATH="$CWD/.claude/settings.json"
if [ -e "$SETTINGS_PATH" ]; then
  # File already exists — only touch statusLine if it matches the old default or is absent.
  # User-customized statusLines are left intact.
  mkdir -p "$(dirname "$SETTINGS_PATH")"
  existing_status=$(jq -c '.statusLine' "$SETTINGS_PATH")
  old_default=$(echo "$OLD_STATUS_LINE_JSON" | jq -c '.')
  if [ "$existing_status" = "$old_default" ] || [ "$existing_status" = "null" ]; then
    jq --argjson newval "$STATUS_LINE_JSON" '.statusLine = $newval' "$SETTINGS_PATH" > "$SETTINGS_PATH.tmp" && mv "$SETTINGS_PATH.tmp" "$SETTINGS_PATH"
    created+=("$SETTINGS_PATH (statusLine updated to include stats)")
  else
    skipped+=("$SETTINGS_PATH (statusLine customized — not overwritten)")
  fi
else
  mkdir -p "$(dirname "$SETTINGS_PATH")"
  printf '%s' "$SETTINGS_TEMPLATE" > "$SETTINGS_PATH"
  created+=("$SETTINGS_PATH")
fi

if [ "$NEW_CAMPAIGN_MODE" = "true" ]; then
  # ── New-campaign-in-existing-world scaffold (FW3, #198) ────────────────────

  # CLAUDE.md — satellite-flavored: explains this folder is a new story in an
  # established world, not a world root of its own.
  CLAUDE_MD_CONTENT='# Ironsworn Campaign — '"$NEW_CAMPAIGN_NAME"'

This folder is a new story in an existing Ironsworn world, powered by the
[agentic-ironsworn](https://github.com/karimn/agentic-ironsworn) plugin.

- World root: `'"$WORLD_ROOT"'`
- Campaign id: `'"$NEW_CAMPAIGN_ID"'`

This campaign sees the world'"'"'s established canon (places, factions, truths
blessed via `/canonize` in any sibling campaign) but none of another
campaign'"'"'s private scenes, threads, or party-local NPCs — one shared
world.duckdb, per-campaign overlays. See `docs/design/world-db.md` in the
agentic-ironsworn repo for the full model.

## Playing

Start the GM: `@ironsworn-gm`

On the first session, the GM presents a **canon briefing**: what'"'"'s already
true in this world, to help situate your new character — where they start,
which established factions/places are in reach, an inciting vow grounded in
existing canon.

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

  # campaigns/<id>/ + campaign.json — created under the EXISTING world root.
  # world.json / world.duckdb there are never touched: one DB, one more sibling.
  safe_mkdir "$CAMPAIGN_DIR"
  CAMPAIGN_JSON_CONTENT='{ "id": "'"$NEW_CAMPAIGN_ID"'", "name": "'"$NEW_CAMPAIGN_NAME"'" }'
  safe_write "$CAMPAIGN_DIR/campaign.json" "$CAMPAIGN_JSON_CONTENT"

  # Project-level .mcp.json — points this session's scribe server at the new
  # campaign folder (SCRIBE_CAMPAIGN relative to this project's cwd). Never
  # overwritten if this project already has its own .mcp.json.
  MCP_JSON_CONTENT='{
  "mcpServers": {
    "scribe": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/scribe/src/server.ts"],
      "env": {
        "SCRIBE_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}",
        "SCRIBE_CAMPAIGN": "'"$SCRIBE_CAMPAIGN_VALUE"'",
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "SCRIBE_SUMMARY_MODEL": "claude-haiku-4-5-20251001",
        "SCRIBE_EXPANSIONS": ""
      }
    }
  }
}'
  safe_write "$CWD/.mcp.json" "$MCP_JSON_CONTENT"

  # .gitignore
  GITIGNORE_CONTENT='node_modules/
*.duckdb-wal
.env
'
  safe_write "$CWD/.gitignore" "$GITIGNORE_CONTENT"
else
  # ── Fresh-world scaffold (existing behavior, unchanged) ────────────────────

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

  # world.json — embedding pin for world.duckdb (if absent; never overwrite)
  WORLD_JSON_CONTENT='{
  "schemaVersion": 1,
  "embedding": { "model": "nomic-embed-text", "version": "1.5", "dim": 768 },
  "name": "'"$(basename "$CWD")"'"
}'
  safe_write "$CWD/world.json" "$WORLD_JSON_CONTENT"

  # campaigns/default/ + campaign.json
  safe_mkdir "$CWD/campaigns/default"

  # campaign.json — campaign identity (if absent; never overwrite)
  CAMPAIGN_JSON_CONTENT='{ "id": "default", "name": "Default Campaign" }'
  safe_write "$CWD/campaigns/default/campaign.json" "$CAMPAIGN_JSON_CONTENT"

  # .gitignore
  GITIGNORE_CONTENT='node_modules/
*.duckdb-wal
.env
'
  safe_write "$CWD/.gitignore" "$GITIGNORE_CONTENT"
fi

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
elif [ -n "$PLUGIN_ROOT" ] && [ -d "$PLUGIN_ROOT/scribe" ]; then
  echo "  → running bun install in scribe..."
  if bun install --cwd "$PLUGIN_ROOT/scribe" 2>&1; then
    echo "✓ scribe dependencies installed"
  else
    echo "✗ bun install failed — run manually: cd \"$PLUGIN_ROOT/scribe\" && bun install"
  fi
elif [ -n "$PLUGIN_ROOT" ]; then
  echo "✗ scribe directory not found at $PLUGIN_ROOT/scribe"
else
  echo "? scribe path unknown (CLAUDE_PLUGIN_ROOT not set and plugin not found in installed_plugins.json)"
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

for f in "${created[@]:-}"; do [ -n "$f" ] && echo "  ✓ created  $f"; done
for f in "${skipped[@]:-}"; do [ -n "$f" ] && echo "  – skipped  $f  (already exists)"; done

echo ""
if [ "$NEW_CAMPAIGN_MODE" = "true" ]; then
  echo "Campaign '$NEW_CAMPAIGN_ID' ($NEW_CAMPAIGN_NAME) ready under the world at $WORLD_ROOT."
  echo "This project's .mcp.json points its scribe server at SCRIBE_CAMPAIGN=$SCRIBE_CAMPAIGN_VALUE."
  echo "Start the GM with @ironsworn-gm — it will present a canon briefing for what's"
  echo "already true in this world before your first scene."
else
  echo "Campaign folder ready. Start the GM with @ironsworn-gm"
fi
echo ""
