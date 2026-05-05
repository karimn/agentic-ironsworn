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

# Check if plugin.json was modified on this branch vs main
if git diff main --name-only 2>/dev/null | grep -q "$PLUGIN_JSON"; then
  exit 0
fi

# Version not bumped — block
cat >&2 <<EOF
{"decision": "block", "reason": "plugin version not bumped. Update the version field in $PLUGIN_JSON before completing this branch."}
EOF
exit 2
