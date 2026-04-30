# ironsworn-init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/ironsworn-init` slash command and a `SessionStart` first-run hook that scaffold a new Ironsworn campaign folder safely, without ever overwriting existing files.

**Architecture:** A shell script command handles all file creation (guarded by existence checks) and environment verification. A separate `hooks/hooks.json` fires at `SessionStart`, checks for a marker file, and injects `additionalContext` to prompt the user if the folder isn't initialized yet. The marker file `.claude/.ironsworn-initialized` gates both the hook and is written by the command on success.

**Tech Stack:** bash, jq (for hooks.json output), Claude Code plugin commands + hooks system

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `plugins/ironsworn/commands/ironsworn-init.sh` | Create | Scaffold files, run env checks, write marker |
| `plugins/ironsworn/hooks/hooks.json` | Create | SessionStart hook — inject first-run prompt |
| `plugins/ironsworn/.claude-plugin/plugin.json` | Modify | Bump version to 0.2.0 |

---

## Task 1: Write the `ironsworn-init.sh` scaffold script

**Files:**
- Create: `plugins/ironsworn/commands/ironsworn-init.sh`

- [ ] **Step 1: Create the commands directory and script file**

```bash
mkdir -p /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/commands
```

- [ ] **Step 2: Write the script**

Create `plugins/ironsworn/commands/ironsworn-init.sh` with this exact content:

```bash
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

# ── Marker ────────────────────────────────────────────────────────────────────

mkdir -p "$CWD/.claude"
touch "$CWD/.claude/.ironsworn-initialized"

echo ""
echo "Campaign folder ready. Start the GM with @ironsworn-gm"
echo ""
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/commands/ironsworn-init.sh
```

- [ ] **Step 4: Smoke-test the script in a temp directory**

```bash
cd /tmp && mkdir -p ironsworn-test && cd ironsworn-test && bash /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/commands/ironsworn-init.sh
```

Expected output: created lines for all 4 targets, env checks print, no errors.

- [ ] **Step 5: Verify idempotency — run again, everything should be skipped**

```bash
cd /tmp/ironsworn-test && bash /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/commands/ironsworn-init.sh
```

Expected: all lines show `– skipped`, no files changed.

- [ ] **Step 6: Verify safety on a folder with existing campaigns/**

```bash
cd /tmp && mkdir -p ironsworn-existing/campaigns/default && echo '{"name":"Test"}' > ironsworn-existing/campaigns/default/character.json && bash /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/commands/ironsworn-init.sh
```

Expected: `campaigns/default/` line shows `– skipped`, `character.json` is untouched.

- [ ] **Step 7: Clean up temp directories**

```bash
rm -rf /tmp/ironsworn-test /tmp/ironsworn-existing
```

- [ ] **Step 8: Commit**

```bash
git add plugins/ironsworn/commands/ironsworn-init.sh
git commit -m "feat(ironsworn): add ironsworn-init scaffold command"
```

---

## Task 2: Write the `SessionStart` first-run hook

**Files:**
- Create: `plugins/ironsworn/hooks/hooks.json`

- [ ] **Step 1: Create the hooks directory**

```bash
mkdir -p /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/hooks
```

- [ ] **Step 2: Write hooks.json**

Create `plugins/ironsworn/hooks/hooks.json` with this exact content:

```json
{
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "if [ -f \"$(pwd)/.claude/.ironsworn-initialized\" ]; then exit 0; fi; printf '{\"additionalContext\": \"IMPORTANT: This folder has not been set up as an Ironsworn campaign yet. Before doing anything else, tell the user: This folder is not set up as an Ironsworn campaign yet. Would you like to run /ironsworn-init to set it up? If they say no or want to skip, create the file .claude/.ironsworn-initialized in the current directory so they are not asked again.\"}'"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Verify hooks.json is valid JSON**

```bash
jq . /Users/kmjq089/Code/personal/agentic-ironsworn/plugins/ironsworn/hooks/hooks.json
```

Expected: pretty-printed JSON with no errors.

- [ ] **Step 4: Commit**

```bash
git add plugins/ironsworn/hooks/hooks.json
git commit -m "feat(ironsworn): add SessionStart first-run hook"
```

---

## Task 3: Bump plugin version to 0.2.0

**Files:**
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json`

- [ ] **Step 1: Update version**

Edit `plugins/ironsworn/.claude-plugin/plugin.json`:

```json
{
  "name": "ironsworn",
  "version": "0.2.0",
  "description": "Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph",
  "author": {
    "name": "Karim Naguib"
  }
}
```

- [ ] **Step 2: Commit and push**

```bash
git add plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "chore(ironsworn): bump version to 0.2.0"
git push
```
