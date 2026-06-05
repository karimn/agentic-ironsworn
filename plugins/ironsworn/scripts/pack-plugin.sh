#!/usr/bin/env bash
# pack-plugin.sh — package the ironsworn plugin for marketplace distribution
#
# Usage: bash scripts/pack-plugin.sh [output-dir]
#
# Produces a self-contained copy of plugins/ironsworn/ where scribe's
# @agentic-rpg/core workspace dependency is resolved to a real directory,
# so `bun install` works outside the monorepo (fixes #170, #171).
#
# The script must be run from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../" && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugins/ironsworn"
CORE_SRC="$REPO_ROOT/packages/core"
OUTPUT_DIR="${1:-$REPO_ROOT/dist/ironsworn}"

echo "[pack] Cleaning output dir: $OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "[pack] Copying plugin sources..."
# Copy everything except scribe/node_modules (re-installed below)
rsync -a --exclude='scribe/node_modules' "$PLUGIN_SRC/" "$OUTPUT_DIR/"

echo "[pack] Copying @agentic-rpg/core into scribe/node_modules..."
CORE_DEST="$OUTPUT_DIR/scribe/node_modules/@agentic-rpg/core"
mkdir -p "$(dirname "$CORE_DEST")"
rsync -a --exclude='node_modules' "$CORE_SRC/" "$CORE_DEST/"

echo "[pack] Rewriting workspace:* dep in scribe/package.json..."
cd "$OUTPUT_DIR/scribe"
# Replace workspace:* reference with the bundled local copy
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.dependencies['@agentic-rpg/core'] = 'file:node_modules/@agentic-rpg/core';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "[pack] Running bun install in scribe (external packages only)..."
bun install

echo "[pack] Done. Plugin packaged at: $OUTPUT_DIR"
echo "[pack] Test with: SCRIBE_CAMPAIGN=<path> bun run $OUTPUT_DIR/scribe/src/server.ts"
