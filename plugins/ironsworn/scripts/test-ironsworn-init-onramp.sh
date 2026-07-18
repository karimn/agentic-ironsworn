#!/usr/bin/env bash
# Integration test for the new-campaign-in-existing-world onramp (FW3, #198)
# in commands/ironsworn-init.sh. Bash-script scaffolding logic isn't reachable
# from `bun test`, so this exercises the actual script end-to-end against a
# scratch directory tree and asserts on the resulting files. The pure
# detection/path-arithmetic algorithm this mirrors (walk-up, slugify,
# relative-path) is separately unit-tested in
# packages/core/src/onramp.test.ts.
#
# Usage: bash plugins/ironsworn/scripts/test-ironsworn-init-onramp.sh
# Exits non-zero on the first failed assertion.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_SH="$SCRIPT_DIR/../commands/ironsworn-init.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

pass_count=0
fail_count=0

assert() {
  local desc="$1"
  shift
  if "$@"; then
    pass_count=$((pass_count + 1))
    echo "  ✓ $desc"
  else
    fail_count=$((fail_count + 1))
    echo "  ✗ $desc"
  fi
}

run_init() {
  (cd "$1" && shift && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" "$@" >/tmp/onramp-test-out.$$  2>&1)
}

# ---------------------------------------------------------------------------
# Setup: a fresh world at zura-world/ (campaign "default"), plain fresh-world
# scaffold — unchanged behavior, exercised first as a sanity baseline.
# ---------------------------------------------------------------------------
mkdir -p "$SCRATCH/zura-world"
(cd "$SCRATCH/zura-world" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" >/dev/null 2>&1) || true

echo "== Fresh world baseline =="
assert "world.json created at world root" test -f "$SCRATCH/zura-world/world.json"
assert "campaigns/default/campaign.json created" test -f "$SCRATCH/zura-world/campaigns/default/campaign.json"
assert "no world.duckdb created by init (lazy-created by the scribe server, not the scaffold script)" \
  bash -c "! test -e '$SCRATCH/zura-world/world.duckdb'"

WORLD_JSON_CHECKSUM_BEFORE="$(md5sum "$SCRATCH/zura-world/world.json" | awk '{print $1}')"

# ---------------------------------------------------------------------------
# Mode 1: auto-detect — mkdir a campaign folder under the existing world root
# and cd into it, no flags.
# ---------------------------------------------------------------------------
echo "== Auto-detected new-campaign-in-existing-world (nested folder) =="
mkdir -p "$SCRATCH/zura-world/campaigns/sandbox"
(cd "$SCRATCH/zura-world/campaigns/sandbox" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" >/dev/null 2>&1)

assert "sibling campaign.json created with the derived id" \
  bash -c "grep -q '\"id\": \"sandbox\"' '$SCRATCH/zura-world/campaigns/sandbox/campaign.json'"
assert "sibling gets its own project .mcp.json" test -f "$SCRATCH/zura-world/campaigns/sandbox/.mcp.json"
assert "SCRIBE_CAMPAIGN is '.' when cwd already IS the campaign dir" \
  bash -c "jq -r '.mcpServers.scribe.env.SCRIBE_CAMPAIGN' '$SCRATCH/zura-world/campaigns/sandbox/.mcp.json' | grep -qx '\\.'"
assert "no second world.json was written under campaigns/sandbox" \
  bash -c "! test -e '$SCRATCH/zura-world/campaigns/sandbox/world.json'"
assert "the original world.json is untouched (identical checksum)" \
  bash -c "[ \"\$(md5sum '$SCRATCH/zura-world/world.json' | awk '{print \$1}')\" = '$WORLD_JSON_CHECKSUM_BEFORE' ]"
assert "campaigns/default (the sibling's data) still exists, untouched" \
  test -f "$SCRATCH/zura-world/campaigns/default/campaign.json"
assert "still exactly one world.json in the whole tree (one DB, many campaigns)" \
  bash -c "[ \"\$(find '$SCRATCH/zura-world' -name world.json | wc -l | tr -d ' ')\" = '1' ]"

# ---------------------------------------------------------------------------
# Mode 2: explicit --in-world from a satellite folder that is NOT nested
# under the world root at all.
# ---------------------------------------------------------------------------
echo "== Explicit --in-world from a sibling satellite folder =="
mkdir -p "$SCRATCH/zura-satellite"
(cd "$SCRATCH/zura-satellite" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" --in-world "../zura-world" myquest "My Quest" >/dev/null 2>&1)

assert "new campaign folder created under the EXISTING world root, not at cwd" \
  test -f "$SCRATCH/zura-world/campaigns/myquest/campaign.json"
assert "campaign.json has the requested id and name" \
  bash -c "grep -q '\"id\": \"myquest\"' '$SCRATCH/zura-world/campaigns/myquest/campaign.json' && grep -q '\"name\": \"My Quest\"' '$SCRATCH/zura-world/campaigns/myquest/campaign.json'"
assert "satellite folder never got its own world.json" \
  bash -c "! test -e '$SCRATCH/zura-satellite/world.json'"
assert "satellite's .mcp.json SCRIBE_CAMPAIGN resolves to the right absolute campaign dir" \
  bash -c "
    rel=\$(jq -r '.mcpServers.scribe.env.SCRIBE_CAMPAIGN' '$SCRATCH/zura-satellite/.mcp.json')
    resolved=\$(cd '$SCRATCH/zura-satellite' && cd \"\$rel\" && pwd)
    [ \"\$resolved\" = \"\$(cd '$SCRATCH/zura-world/campaigns/myquest' && pwd)\" ]
  "
assert "still exactly one world.json in the whole tree after the satellite onramp" \
  bash -c "[ \"\$(find '$SCRATCH' -name world.json | wc -l | tr -d ' ')\" = '1' ]"

# ---------------------------------------------------------------------------
# Guard: --in-world pointed at a directory with no world.json/world.duckdb
# must fail loudly rather than silently scaffolding a nonsense sibling.
# ---------------------------------------------------------------------------
echo "== --in-world guard against a non-world path =="
mkdir -p "$SCRATCH/not-a-world" "$SCRATCH/another-satellite"
set +e
(cd "$SCRATCH/another-satellite" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" --in-world "../not-a-world" >/tmp/onramp-guard-out.$$ 2>&1)
guard_exit=$?
set -e
assert "--in-world against a non-world path exits non-zero" bash -c "[ $guard_exit -ne 0 ]"
assert "--in-world against a non-world path prints an explanatory error" \
  bash -c "grep -qi 'not an existing world root' /tmp/onramp-guard-out.$$"
rm -f "/tmp/onramp-guard-out.$$"

# ---------------------------------------------------------------------------
# --from-setting (FW4, #199): stages a setting-seed JSON at the new world root.
# ---------------------------------------------------------------------------
echo "== --from-setting stages a pending setting seed in fresh-world mode =="
SEED_JSON="$SCRATCH/setting-seed.json"
cat > "$SEED_JSON" <<'SEEDEOF'
{"schemaVersion":1,"sourceWorld":"Zura","exportedAt":"2026-01-01T00:00:00Z","entities":[{"id":"11111111-1111-1111-1111-111111111111","canonical":"The Sundered Hold","type":"place","summary":"a ruined fortress","content":{},"metadata":{},"aliases":[]}],"relations":[],"communities":[]}
SEEDEOF
mkdir -p "$SCRATCH/seeded-world"
(cd "$SCRATCH/seeded-world" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" --from-setting "$SEED_JSON" >/dev/null 2>&1)

assert "setting-seed.pending.json staged at the new world root" \
  test -f "$SCRATCH/seeded-world/setting-seed.pending.json"
assert "staged seed content matches the source file (mod trailing newline)" \
  bash -c "[ \"\$(cat '$SEED_JSON')\" = \"\$(cat '$SCRATCH/seeded-world/setting-seed.pending.json')\" ]"
assert "re-running init does not clobber the staged seed (safe_write idempotency)" \
  bash -c "(cd '$SCRATCH/seeded-world' && CLAUDE_PLUGIN_ROOT='' bash '$INIT_SH' >/dev/null 2>&1); [ \"\$(cat '$SEED_JSON')\" = \"\$(cat '$SCRATCH/seeded-world/setting-seed.pending.json')\" ]"

echo "== --from-setting guards =="
mkdir -p "$SCRATCH/from-setting-guard-1"
set +e
(cd "$SCRATCH/from-setting-guard-1" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" --in-world "../zura-world" --from-setting "$SEED_JSON" >/tmp/from-setting-guard-1.$$ 2>&1)
guard1_exit=$?
set -e
assert "--from-setting + --in-world exits non-zero" bash -c "[ $guard1_exit -ne 0 ]"
assert "--from-setting + --in-world prints an explanatory error" \
  bash -c "grep -qi 'cannot be combined with --in-world' /tmp/from-setting-guard-1.$$"
rm -f "/tmp/from-setting-guard-1.$$"

mkdir -p "$SCRATCH/from-setting-guard-2"
set +e
(cd "$SCRATCH/from-setting-guard-2" && CLAUDE_PLUGIN_ROOT="" bash "$INIT_SH" --from-setting "$SCRATCH/not-a-real-seed.json" >/tmp/from-setting-guard-2.$$ 2>&1)
guard2_exit=$?
set -e
assert "--from-setting against a nonexistent file exits non-zero" bash -c "[ $guard2_exit -ne 0 ]"
assert "--from-setting against a nonexistent file prints an explanatory error" \
  bash -c "grep -qi 'does not exist' /tmp/from-setting-guard-2.$$"
rm -f "/tmp/from-setting-guard-2.$$"

echo ""
echo "─────────────────────────────────────────"
echo "$pass_count passed, $fail_count failed"
if [ "$fail_count" -ne 0 ]; then
  exit 1
fi
