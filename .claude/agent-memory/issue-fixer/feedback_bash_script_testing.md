---
name: feedback_bash_script_testing
description: How to test changes to plugins/ironsworn/commands/*.sh (no bun-test harness exists for bash), plus a known pre-existing bug.
type: feedback
---

`plugins/ironsworn/commands/ironsworn-init.sh` (and any other command `.sh`
script) has no `bun test` coverage — bash logic isn't reachable from bun's
test runner, and there's no existing precedent in this repo for shelling out
to bash scripts from within a `.test.ts` file.

**How to apply:** when a change touches one of these scripts non-trivially
(new flags, new detection logic, new scaffolding branches), write a
self-checking bash integration test script instead
(`plugins/ironsworn/scripts/test-<name>.sh` — see
`test-ironsworn-init-onramp.sh` for the pattern: `mktemp -d` scratch root,
`assert()` helper that counts pass/fail and prints checkmarks, `trap ... EXIT`
for cleanup, exits non-zero if any assertion failed). Mention it explicitly
in the PR's Testing section since `bun test` won't pick it up automatically.
If any *pure* piece of the script's logic (path arithmetic, slugify, walk-up
detection) can be factored into a small TypeScript helper in `packages/core`,
do that too and unit-test it there — the bash script can still implement the
same logic natively (to avoid a runtime dependency on `bun install` /
workspace-linking having already happened before the script's own detection
step runs), with comments cross-referencing the TS module as the "spec."

**Known pre-existing bug (as of 2026-07-18, present on `main` before PR #205,
not fixed — out of scope for whatever you're working on unless the issue is
specifically about it):** running `ironsworn-init.sh` a *second* time in a
folder whose `.claude/settings.json` already exists fails with
`jq: parse error: Invalid numeric literal at ...` inside the block that
diffs the existing `statusLine` against `OLD_STATUS_LINE_JSON` to decide
whether to upsert it. Reproduced on a clean checkout of `main` (not
introduced by any FW-track PR). If you're asked to make `ironsworn-init.sh`
idempotent or fix a re-run bug, this is almost certainly what's meant.
