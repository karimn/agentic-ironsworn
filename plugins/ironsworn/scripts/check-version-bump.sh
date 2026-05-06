#!/bin/bash
set -euo pipefail

PLUGIN_JSON="plugins/ironsworn/.claude-plugin/plugin.json"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

cd "$PROJECT_DIR"

current_branch=$(git branch --show-current 2>/dev/null || echo "")

# Skip check on main/master or detached HEAD
if [[ -z "$current_branch" || "$current_branch" == "main" || "$current_branch" == "master" ]]; then
  exit 0
fi

# Use origin/main as the reference so worktrees and stale local main both work
base_ref="origin/main"
if ! git rev-parse --verify "$base_ref" &>/dev/null; then
  base_ref="main"
fi

# Check if plugin.json was modified on this branch vs base
if ! git diff "$base_ref" --name-only 2>/dev/null | grep -q "$PLUGIN_JSON"; then
  cat >&2 <<EOF
{"decision": "block", "reason": "plugin version not bumped. Update the version field in $PLUGIN_JSON before completing this branch."}
EOF
  exit 2
fi

# Verify the version actually increased (not just touched)
base_version=$(git show "$base_ref:$PLUGIN_JSON" 2>/dev/null | grep '"version"' | grep -o '[0-9]*\.[0-9]*\.[0-9]*' || echo "0.0.0")
current_version=$(grep '"version"' "$PLUGIN_JSON" | grep -o '[0-9]*\.[0-9]*\.[0-9]*' || echo "0.0.0")

if [[ "$base_version" == "$current_version" ]]; then
  cat >&2 <<EOF
{"decision": "block", "reason": "plugin version unchanged ($current_version). Bump the version in $PLUGIN_JSON — it must be higher than the base branch version."}
EOF
  exit 2
fi

exit 0
