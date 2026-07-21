#!/bin/bash
# Referee Stop hook (#211) — fail-open wrapper around the referee CLI.
#
# Exit 2 (an intentional block, JSON decision relayed on stderr) passes
# through; every other outcome — CLI crash, missing bun, timeout — exits 0
# so a broken referee can never interrupt play. Blocking policy and rollout:
# docs/design/runtime-observability.md §6, §8.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../scribe/src/referee/cli.ts"

if ! command -v bun >/dev/null 2>&1; then
  exit 0
fi
if [ ! -f "$CLI" ]; then
  exit 0
fi

out=$(timeout 8 bun run "$CLI" 2>/dev/null)
code=$?

if [ "$code" -eq 2 ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
