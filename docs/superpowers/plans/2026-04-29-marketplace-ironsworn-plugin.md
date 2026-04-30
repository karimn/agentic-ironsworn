# Agentic-Ironsworn Marketplace + Ironsworn Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `agentic-ironsworn` from a playable single-repo into a Claude Code marketplace whose first plugin (`ironsworn`) bundles the GM agent, skills, scribe MCP server, and rulebook data — installable into any Claude Code session anywhere.

**Architecture:** The repo root becomes the marketplace (with `.claude-plugin/marketplace.json`). Everything that ships to users lives under `plugins/ironsworn/`. Scribe gets a `SCRIBE_PLUGIN_ROOT` env knob so it can find bundled rulebook assets (YAMLs + duckdb) regardless of where it's installed, while campaign state stays anchored to the user's CWD via `SCRIBE_CAMPAIGN` (unchanged). `TomeRAG.jl` gets extracted to a separate repo. Dev-only content (`skill-evals/`, `scripts/import_datasworn.py`, `docs/`) stays at the marketplace root.

**Tech Stack:** bun / TypeScript (scribe), Model Context Protocol, DuckDB (vss + fts), Ollama (`nomic-embed-text`), git + git-subtree, Claude Code plugin system.

**Reference spec:** `docs/superpowers/specs/2026-04-29-marketplace-ironsworn-plugin-design.md`

---

## File Structure

**Created:**
- `.claude-plugin/marketplace.json` — marketplace manifest
- `plugins/ironsworn/.claude-plugin/plugin.json` — plugin manifest
- `plugins/ironsworn/.mcp.json` — scribe MCP server config with `${CLAUDE_PLUGIN_ROOT}`
- `plugins/ironsworn/README.md` — install + setup docs
- `README.md` (rewrite) — marketplace-level overview + install commands

**Moved (via `git mv` to preserve history):**
- `.claude/agents/ironsworn-gm.md` → `plugins/ironsworn/agents/ironsworn-gm.md`
- `.claude/skills/ironsworn-world-truths/` → `plugins/ironsworn/skills/ironsworn-world-truths/`
- `.claude/skills/ironsworn-character-builder/` → `plugins/ironsworn/skills/ironsworn-character-builder/`
- `scribe/` → `plugins/ironsworn/scribe/`
- `data/ironsworn/moves.yaml` → `plugins/ironsworn/data/ironsworn/moves.yaml`
- `data/ironsworn/oracles.yaml` → `plugins/ironsworn/data/ironsworn/oracles.yaml`
- `scripts/sheet.ts` → `plugins/ironsworn/scripts/sheet.ts`

**Modified in place:**
- `plugins/ironsworn/agents/ironsworn-gm.md` — drop inline `mcpServers` frontmatter (already moved)
- `plugins/ironsworn/scribe/src/rules/ironsworn/moves.ts:65-75` — add `SCRIBE_PLUGIN_ROOT` fallback
- `plugins/ironsworn/scribe/src/rules/ironsworn/oracles.ts:47-57` — add `SCRIBE_PLUGIN_ROOT` fallback
- `plugins/ironsworn/scribe/src/rag/query.ts:12-23` — add `SCRIBE_PLUGIN_ROOT` fallback (preserving existing `DB_PATH` override)
- `plugins/ironsworn/scripts/sheet.ts:12-15` — switch `repoRoot` to `process.cwd()`
- `.gitignore` — drop stale `data/ironsworn/` entries

**Added binary:**
- `plugins/ironsworn/data/ironsworn/ironsworn.duckdb` — copied from `~/.rpg-data/` on another machine

**Extracted to a separate repo:**
- `TomeRAG.jl/` — `git subtree split` with history preserved, then removed from this repo

**Left at marketplace root (dev-only):**
- `skill-evals/` — eval workspaces
- `scripts/import_datasworn.py` — YAML regeneration
- `docs/` — specs + plans

**Left in place (still relevant at marketplace root):**
- `.gitignore` entries for `LocalPreferences.toml`, `.worktrees/`, `campaigns/` (the latter matters because dev playtesting inside the marketplace repo can still drop a `campaigns/` dir)

---

## Task 1: Set up plugin directory skeleton

**Files:**
- Create: `plugins/ironsworn/.claude-plugin/plugin.json`

- [ ] **Step 1: Create the plugin directory and its manifest**

Run:
```bash
mkdir -p plugins/ironsworn/.claude-plugin
```

Create `plugins/ironsworn/.claude-plugin/plugin.json`:
```json
{
  "name": "ironsworn",
  "version": "0.1.0",
  "description": "Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph",
  "author": {
    "name": "Karim Naguib"
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `python3 -m json.tool plugins/ironsworn/.claude-plugin/plugin.json`
Expected: Prints the JSON re-formatted, exits 0.

- [ ] **Step 3: Commit**

```bash
git add plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "feat(marketplace): scaffold ironsworn plugin manifest"
```

---

## Task 2: Move the agent into the plugin

**Files:**
- Move: `.claude/agents/ironsworn-gm.md` → `plugins/ironsworn/agents/ironsworn-gm.md`
- Modify: `plugins/ironsworn/agents/ironsworn-gm.md` (frontmatter only)

- [ ] **Step 1: Move the agent file with git**

Run:
```bash
mkdir -p plugins/ironsworn/agents
git mv .claude/agents/ironsworn-gm.md plugins/ironsworn/agents/ironsworn-gm.md
```

- [ ] **Step 2: Strip inline mcpServers from frontmatter**

In `plugins/ironsworn/agents/ironsworn-gm.md`, replace the current frontmatter block (lines 1–15):

Current frontmatter:
```yaml
---
name: ironsworn-gm
description: Solo GM companion for Ironsworn RPG with full rules engine
mcpServers:
  - scribe:
      type: stdio
      command: bun
      args: ["run", "scribe/src/server.ts"]
      env:
        SCRIBE_CAMPAIGN: "campaigns/default"
        OLLAMA_BASE_URL: "http://localhost:11434"
permissions:
  allow:
    - "mcp__scribe__*"
---
```

New frontmatter:
```yaml
---
name: ironsworn-gm
description: Solo GM companion for Ironsworn RPG with full rules engine
permissions:
  allow:
    - "mcp__scribe__*"
---
```

Leave the rest of the file (body content starting with `# Ironsworn Solo GM`) untouched.

- [ ] **Step 3: Verify frontmatter parses as YAML**

Run:
```bash
python3 -c "import yaml, sys; doc = open('plugins/ironsworn/agents/ironsworn-gm.md').read().split('---')[1]; print(yaml.safe_load(doc))"
```
Expected: Prints a dict with keys `name`, `description`, `permissions` — no `mcpServers`.

- [ ] **Step 4: Verify the old location is empty and can be removed**

Run: `ls -la .claude/agents/ 2>&1`
Expected: Directory is empty or only contains hidden files. If empty, remove:
```bash
rmdir .claude/agents 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/agents/ironsworn-gm.md .claude/agents 2>/dev/null || true
git add -A plugins/ ironsworn/ .claude/ 2>/dev/null || true
git status --short
git commit -m "refactor(ironsworn): move GM agent into plugin dir, drop inline mcpServers"
```

---

## Task 3: Move the skills into the plugin

**Files:**
- Move: `.claude/skills/ironsworn-world-truths/` → `plugins/ironsworn/skills/ironsworn-world-truths/`
- Move: `.claude/skills/ironsworn-character-builder/` → `plugins/ironsworn/skills/ironsworn-character-builder/`

- [ ] **Step 1: Create the target skills directory**

Run:
```bash
mkdir -p plugins/ironsworn/skills
```

- [ ] **Step 2: Move both skill directories**

Run:
```bash
git mv .claude/skills/ironsworn-world-truths plugins/ironsworn/skills/ironsworn-world-truths
git mv .claude/skills/ironsworn-character-builder plugins/ironsworn/skills/ironsworn-character-builder
```

Note: `.claude/skills/` also contains `ironsworn-world-truths-workspace/` and `ironsworn-character-builder-workspace/`. Those are **eval workspaces**, not skills. They must stay out of the plugin. Verify they're still at `.claude/skills/`:

Run: `ls .claude/skills/`
Expected: Only `ironsworn-world-truths-workspace/` and `ironsworn-character-builder-workspace/` remain.

- [ ] **Step 3: Move the workspaces to the dev-only location at repo root**

The spec places dev content at the marketplace root. Move the workspaces out of `.claude/` entirely, next to `skill-evals/`:

Run:
```bash
git mv .claude/skills/ironsworn-world-truths-workspace skill-evals/ironsworn-world-truths-workspace
git mv .claude/skills/ironsworn-character-builder-workspace skill-evals/ironsworn-character-builder-workspace
```

Note: `skill-evals/ironsworn-world-truths` and `skill-evals/ironsworn-character-builder` already exist — they are the existing eval targets. The workspaces (`-workspace` suffix) are different directories and should not collide.

Run: `ls skill-evals/`
Expected: Four directories: `ironsworn-character-builder/`, `ironsworn-character-builder-workspace/`, `ironsworn-world-truths/`, `ironsworn-world-truths-workspace/`.

- [ ] **Step 4: Remove now-empty `.claude/` subdirs**

Run:
```bash
rmdir .claude/skills .claude 2>/dev/null || true
```

- [ ] **Step 5: Verify each skill has its SKILL.md at the new location**

Run:
```bash
ls plugins/ironsworn/skills/ironsworn-world-truths/SKILL.md
ls plugins/ironsworn/skills/ironsworn-character-builder/SKILL.md
```
Expected: Both files exist.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ironsworn): move skills into plugin dir; keep workspaces at dev root"
```

---

## Task 4: Move scribe into the plugin

**Files:**
- Move: `scribe/` → `plugins/ironsworn/scribe/`

- [ ] **Step 1: Move the scribe directory**

Run:
```bash
git mv scribe plugins/ironsworn/scribe
```

- [ ] **Step 2: Verify the move preserved structure**

Run:
```bash
ls plugins/ironsworn/scribe/
ls plugins/ironsworn/scribe/src/
```
Expected: `package.json`, `bun.lock`, `tsconfig.json`, `src/` at top; `server.ts`, `tools/`, `rules/`, `rag/`, `state/`, `context/` under `src/`.

- [ ] **Step 3: Install deps in the new location and run the existing tests unchanged**

Run:
```bash
cd plugins/ironsworn/scribe && bun install && bun test 2>&1 | tail -30
```
Expected: All tests pass (or same pass/skip pattern as today — Ollama-gated tests may skip). No test is expected to break from the move alone because scribe's path-resolution walks relative `..`, and the number of `..` relative to source is unchanged by the move.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ironsworn): move scribe MCP server into plugin dir"
```

---

## Task 5: Move rulebook data into the plugin

**Files:**
- Move: `data/ironsworn/moves.yaml` → `plugins/ironsworn/data/ironsworn/moves.yaml`
- Move: `data/ironsworn/oracles.yaml` → `plugins/ironsworn/data/ironsworn/oracles.yaml`

- [ ] **Step 1: Create target dir and move the YAMLs**

Run:
```bash
mkdir -p plugins/ironsworn/data/ironsworn
git mv data/ironsworn/moves.yaml plugins/ironsworn/data/ironsworn/moves.yaml
git mv data/ironsworn/oracles.yaml plugins/ironsworn/data/ironsworn/oracles.yaml
```

- [ ] **Step 2: Remove the now-empty old data dir**

Run:
```bash
rmdir data/ironsworn data 2>/dev/null || true
```

- [ ] **Step 3: Run scribe tests — these SHOULD fail now**

Before we patch the path resolution, the rule loaders are hardcoded to walk up 4 levels from `scribe/src/rules/ironsworn/` to reach a repo-root `data/ironsworn/`. After this move, that walk lands nowhere useful. Tests that load moves or oracles should fail.

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ironsworn/moves.test.ts 2>&1 | tail -20
```
Expected: Tests that read `moves.yaml` fail (likely with "moves array empty" or similar). This confirms the expected broken state before the patch.

- [ ] **Step 4: Commit the move (tests failing is acceptable here — next task fixes it)**

Commit with a note so anyone bisecting understands:
```bash
git add -A
git commit -m "refactor(ironsworn): move moves.yaml and oracles.yaml into plugin data dir

Tests will fail at this commit; Task 6 patches path resolution to use
SCRIBE_PLUGIN_ROOT with a fallback."
```

---

## Task 6: Patch scribe rule-data path resolution

**Files:**
- Modify: `plugins/ironsworn/scribe/src/rules/ironsworn/moves.ts:65-75`
- Modify: `plugins/ironsworn/scribe/src/rules/ironsworn/oracles.ts:47-57`

- [ ] **Step 1: Write a failing test for the env-var behavior in moves**

Create `plugins/ironsworn/scribe/src/rules/ironsworn/moves.envpath.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("moves.ts — SCRIBE_PLUGIN_ROOT resolution", () => {
  let tmpRoot: string;
  const originalEnv = process.env.SCRIBE_PLUGIN_ROOT;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scribe-plugin-root-"));
    mkdirSync(join(tmpRoot, "data", "ironsworn"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "data", "ironsworn", "moves.yaml"),
      "- name: Test Move\n  trigger: test\n  stat_options: [edge]\n  stat_hint: ''\n  roll_type: action\n  outcomes:\n    strong_hit: s\n    weak_hit: w\n    miss: m\n",
    );
    process.env.SCRIBE_PLUGIN_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads moves from SCRIBE_PLUGIN_ROOT/data/ironsworn/moves.yaml when env var is set", async () => {
    // Dynamic import AFTER env var is set so the module-level path resolution picks it up.
    // Using a query param defeats Bun's module cache so each test gets a fresh load.
    const mod = await import("./moves.ts?t=" + Date.now());
    const move = mod.getMove("Test Move");
    expect(move).toBeDefined();
    expect(move?.name).toBe("Test Move");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ironsworn/moves.envpath.test.ts 2>&1 | tail -15
```
Expected: Fails because the current module resolves its path at module-load time from `import.meta.url`, ignoring `SCRIBE_PLUGIN_ROOT`.

- [ ] **Step 3: Patch `moves.ts` to prefer the env var**

Replace lines 65–75 in `plugins/ironsworn/scribe/src/rules/ironsworn/moves.ts`. Find the existing block:
```ts
// scribe/src/rules/ironsworn/ → 4 levels up → repo root
const MOVES_PATH = (() => {
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "moves.yaml");
})();
```

Replace it with:
```ts
// Prefer SCRIBE_PLUGIN_ROOT when running inside a Claude Code plugin install.
// Fall back to walking up from source when running out of the dev tree so
// `bun test` and `bun run` keep working with zero config.
function resolveMovesPath(): string {
  const pluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "ironsworn", "moves.yaml");
  }
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "moves.yaml");
}
```

Then replace each existing use of `MOVES_PATH` in this file with `resolveMovesPath()`. Find all occurrences:
```bash
grep -n MOVES_PATH plugins/ironsworn/scribe/src/rules/ironsworn/moves.ts
```

There are two references in `loadMoves()` (the `existsSync` check and the `readFileSync` call). Change both to call `resolveMovesPath()`. Using a function (not a module-level constant) ensures the env var is read at call time, which is what the test relies on.

- [ ] **Step 4: Run the new test to confirm it passes**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ironsworn/moves.envpath.test.ts 2>&1 | tail -10
```
Expected: 1 pass, 0 fail.

- [ ] **Step 5: Apply the same pattern to `oracles.ts`**

In `plugins/ironsworn/scribe/src/rules/ironsworn/oracles.ts:47-57`, replace the existing `ORACLES_PATH` IIFE:
```ts
// scribe/src/rules/ironsworn/ → 4 levels up → repo root
const ORACLES_PATH = (() => {
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "oracles.yaml");
})();
```

With:
```ts
function resolveOraclesPath(): string {
  const pluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "ironsworn", "oracles.yaml");
  }
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "oracles.yaml");
}
```

Replace `ORACLES_PATH` references with `resolveOraclesPath()` calls in `loadOracles()`.

- [ ] **Step 6: Write a matching test for `oracles.ts`**

Create `plugins/ironsworn/scribe/src/rules/ironsworn/oracles.envpath.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("oracles.ts — SCRIBE_PLUGIN_ROOT resolution", () => {
  let tmpRoot: string;
  const originalEnv = process.env.SCRIBE_PLUGIN_ROOT;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scribe-plugin-root-"));
    mkdirSync(join(tmpRoot, "data", "ironsworn"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "data", "ironsworn", "oracles.yaml"),
      "- name: Test Oracle\n  dice: 1d10\n  rolls:\n  - min: 1\n    max: 10\n    outcome: anything\n",
    );
    process.env.SCRIBE_PLUGIN_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads oracles from SCRIBE_PLUGIN_ROOT/data/ironsworn/oracles.yaml when env var is set", async () => {
    const mod = await import("./oracles.ts?t=" + Date.now());
    const tables = mod.getOracleTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.find((t: any) => t.name === "Test Oracle")).toBeDefined();
  });
});
```

Note: this test calls `getOracleTables()`. If the module exposes a different accessor, use that instead — check `oracles.ts` for the exported function name and adjust. If no suitable accessor exists, export one (e.g. `export function getOracleTables(): OracleTable[] { return loadOracles(); }`).

- [ ] **Step 7: Run both rule path tests**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ironsworn/moves.envpath.test.ts src/rules/ironsworn/oracles.envpath.test.ts 2>&1 | tail -10
```
Expected: 2 passes, 0 fails.

- [ ] **Step 8: Run the full rules test suite**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ 2>&1 | tail -20
```
Expected: All rules tests pass, including the pre-existing `moves.test.ts` and `oracles.test.ts`. The fallback branch ensures tests still find the YAMLs via the relative walk — but wait: after the `git mv` in Task 5, the fallback path no longer resolves to a real file. Two options for the fallback to work in dev: (a) tests set `SCRIBE_PLUGIN_ROOT` via a shared test helper, or (b) the fallback walks to the plugin root instead of the old repo root.

Choose option (b) because it mirrors where the files actually live now. Update the fallback in both `moves.ts` and `oracles.ts`: change the number of `..` levels so it resolves to `plugins/ironsworn/` (the new "plugin root" in dev).

From `plugins/ironsworn/scribe/src/rules/ironsworn/` the path to `plugins/ironsworn/data/ironsworn/...` is `../../../data/ironsworn/...`. That's **three** `..`, not four. Update the fallback blocks in both files to use three `..`:

```ts
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
```

Rename the variable to `pluginRootFallback` for clarity and drop the outdated comment:
```ts
  // Fall back to walking up from source to the plugin root for dev-time use.
  const pluginRootFallback = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return resolve(pluginRootFallback, "data", "ironsworn", "moves.yaml");
```

Re-run:
```bash
cd plugins/ironsworn/scribe && bun test src/rules/ 2>&1 | tail -20
```
Expected: All rules tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix(scribe): resolve rulebook YAMLs via SCRIBE_PLUGIN_ROOT with dev fallback"
```

---

## Task 7: Patch scribe rules RAG path resolution

**Files:**
- Modify: `plugins/ironsworn/scribe/src/rag/query.ts:12-23`

- [ ] **Step 1: Write a failing test for the env-var behavior**

Create `plugins/ironsworn/scribe/src/rag/query.envpath.test.ts`. Because `query.ts` uses a module-level lazy singleton (`_instancePromise`), the test needs to reset that, or — simpler — extract the path-resolution into an exported pure function we can test in isolation.

Refactor plan inside this step: export a `resolveDbPath()` function from `query.ts`. Test that function directly. This avoids needing to reset module state.

Create the test file:
```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveDbPath } from "./query.ts";

describe("query.ts — resolveDbPath", () => {
  const originalPluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  const originalDbPath = process.env.DB_PATH;

  beforeEach(() => {
    delete process.env.SCRIBE_PLUGIN_ROOT;
    delete process.env.DB_PATH;
  });

  afterEach(() => {
    if (originalPluginRoot === undefined) delete process.env.SCRIBE_PLUGIN_ROOT;
    else process.env.SCRIBE_PLUGIN_ROOT = originalPluginRoot;
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
  });

  it("prefers DB_PATH when set", () => {
    process.env.DB_PATH = "/explicit/path.duckdb";
    expect(resolveDbPath()).toBe("/explicit/path.duckdb");
  });

  it("uses SCRIBE_PLUGIN_ROOT when DB_PATH is not set", () => {
    process.env.SCRIBE_PLUGIN_ROOT = "/my/plugin";
    expect(resolveDbPath()).toBe("/my/plugin/data/ironsworn/ironsworn.duckdb");
  });

  it("falls back to plugin-relative walk when neither env var is set", () => {
    const result = resolveDbPath();
    // Should resolve to .../plugins/ironsworn/data/ironsworn/ironsworn.duckdb
    expect(result).toMatch(/plugins\/ironsworn\/data\/ironsworn\/ironsworn\.duckdb$/);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rag/query.envpath.test.ts 2>&1 | tail -15
```
Expected: Fails because `resolveDbPath` is not exported from `query.ts`.

- [ ] **Step 3: Refactor `query.ts` to expose and use `resolveDbPath`**

In `plugins/ironsworn/scribe/src/rag/query.ts`, replace the current `DB_PATH` IIFE (lines 12–23):
```ts
const DB_PATH = (() => {
  const envPath = process.env["DB_PATH"];
  if (envPath) return envPath;
  // scribe/src/rag/ → scribe/src/ → scribe/ → repo root
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "ironsworn.duckdb");
})();
```

With:
```ts
export function resolveDbPath(): string {
  const explicit = process.env["DB_PATH"];
  if (explicit) return explicit;

  const pluginRoot = process.env["SCRIBE_PLUGIN_ROOT"];
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "ironsworn", "ironsworn.duckdb");
  }

  // Dev fallback: scribe/src/rag/ → scribe/src/ → scribe/ → plugin root
  const pluginRootFallback = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return resolve(pluginRootFallback, "data", "ironsworn", "ironsworn.duckdb");
}
```

Change the lazy instance to call the function at connection time, not module load:
```ts
let _instancePromise: Promise<DuckDBInstance> | null = null;

function getInstance(): Promise<DuckDBInstance> {
  if (_instancePromise === null) {
    _instancePromise = DuckDBInstance.create(resolveDbPath(), { access_mode: "READ_ONLY" });
  }
  return _instancePromise;
}
```

The existing `_instancePromise` caching means the path is captured on first query and reused — that's fine for process lifetime. If a test needs to change the path after the first call, it can import and call a new `resetInstance()` helper, but none of our tests do, so skip that.

- [ ] **Step 4: Run the failing tests now**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rag/query.envpath.test.ts 2>&1 | tail -15
```
Expected: 3 passes, 0 fails.

- [ ] **Step 5: Run the full rag test suite**

Run:
```bash
cd plugins/ironsworn/scribe && bun test src/rag/ 2>&1 | tail -20
```
Expected: All pre-existing tests still pass. Ollama-gated tests may skip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(scribe): resolve ironsworn.duckdb via SCRIBE_PLUGIN_ROOT with dev fallback"
```

---

## Task 8: Move and patch the character-sheet script

**Files:**
- Move: `scripts/sheet.ts` → `plugins/ironsworn/scripts/sheet.ts`
- Modify: `plugins/ironsworn/scripts/sheet.ts:3-15`

- [ ] **Step 1: Move the script**

Run:
```bash
mkdir -p plugins/ironsworn/scripts
git mv scripts/sheet.ts plugins/ironsworn/scripts/sheet.ts
```

- [ ] **Step 2: Verify `scripts/` still contains `import_datasworn.py`**

Run: `ls scripts/`
Expected: Only `import_datasworn.py` remains.

- [ ] **Step 3: Patch `repoRoot` to use `process.cwd()`**

In `plugins/ironsworn/scripts/sheet.ts` at lines 3–5 (the usage comment) and 12–15 (the `repoRoot`/`campaignDir` block), make these changes.

Replace the header comment block:
```ts
/**
 * Display the current character sheet from disk. Zero tokens — pure JSON read.
 * Usage: bun run scripts/sheet.ts  (or ! bun run sheet from scribe/)
 * Respects SCRIBE_CAMPAIGN env var (default: campaigns/default).
 */
```

With:
```ts
/**
 * Display the current character sheet from disk. Zero tokens — pure JSON read.
 * Run from the host repo that holds your campaign directory:
 *   bun run ${CLAUDE_PLUGIN_ROOT}/scripts/sheet.ts
 * Respects SCRIBE_CAMPAIGN env var (default: campaigns/default), resolved
 * relative to the current working directory.
 */
```

Replace:
```ts
const repoRoot    = join(import.meta.dir, "..");
const campaignDir = process.env.SCRIBE_CAMPAIGN
  ? join(repoRoot, process.env.SCRIBE_CAMPAIGN)
  : join(repoRoot, "campaigns/default");
```

With:
```ts
const hostRoot    = process.cwd();
const campaignDir = process.env.SCRIBE_CAMPAIGN
  ? join(hostRoot, process.env.SCRIBE_CAMPAIGN)
  : join(hostRoot, "campaigns/default");
```

Remove the old `join` import fallback if no other callsite uses `import.meta.dir` (grep to confirm):
```bash
grep -n import.meta.dir plugins/ironsworn/scripts/sheet.ts
```

- [ ] **Step 4: Smoke test the script runs against a fake campaign**

Set up a throwaway dir and run the script:
```bash
mkdir -p /tmp/sheet-smoke/campaigns/default
cat > /tmp/sheet-smoke/campaigns/default/character.json <<'EOF'
{
  "name": "Test Iron",
  "stats": { "edge": 2, "heart": 2, "iron": 3, "shadow": 1, "wits": 2 },
  "health": 4,
  "spirit": 4,
  "supply": 4,
  "momentum": 2
}
EOF
cd /tmp/sheet-smoke && bun run /Users/kmjq089/Code/personal/agentic-ironsworn/.worktrees/feature-marketplace-plugin/plugins/ironsworn/scripts/sheet.ts 2>&1 | head -20
```
Expected: Prints a formatted character sheet starting with `Test Iron` — does NOT print `No character found at ...`.

Clean up: `rm -rf /tmp/sheet-smoke`.

- [ ] **Step 5: Remove `scribe/package.json` `sheet` script entry if it references the old path**

Check:
```bash
grep sheet plugins/ironsworn/scribe/package.json
```

The old entry is `"sheet": "bun run ../scripts/sheet.ts"`. After the move, the relative path from `plugins/ironsworn/scribe/` to `plugins/ironsworn/scripts/sheet.ts` is `../scripts/sheet.ts`. Same path. No change needed. If the grep shows the script entry, leave it alone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ironsworn): move sheet.ts into plugin, anchor to cwd"
```

---

## Task 9: Add plugin `.mcp.json`

**Files:**
- Create: `plugins/ironsworn/.mcp.json`

- [ ] **Step 1: Create the MCP config**

Create `plugins/ironsworn/.mcp.json`:
```json
{
  "mcpServers": {
    "scribe": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/scribe/src/server.ts"],
      "env": {
        "SCRIBE_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}",
        "SCRIBE_CAMPAIGN": "campaigns/default",
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

- [ ] **Step 2: Validate JSON**

Run: `python3 -m json.tool plugins/ironsworn/.mcp.json`
Expected: Re-prints the JSON, exits 0.

- [ ] **Step 3: Commit**

```bash
git add plugins/ironsworn/.mcp.json
git commit -m "feat(ironsworn): add plugin MCP config with CLAUDE_PLUGIN_ROOT"
```

---

## Task 10: Add marketplace manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create the marketplace manifest**

Run: `mkdir -p .claude-plugin`

Create `.claude-plugin/marketplace.json`:
```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agentic-ironsworn",
  "description": "Tabletop RPG plugins for Claude Code — solo play companions with full rules engines",
  "owner": {
    "name": "Karim Naguib"
  },
  "plugins": [
    {
      "name": "ironsworn",
      "description": "Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph",
      "category": "games",
      "source": "./plugins/ironsworn"
    }
  ]
}
```

The `homepage` field is omitted intentionally — we'll add it once the GitHub URL is known (see Task 15).

- [ ] **Step 2: Validate JSON**

Run: `python3 -m json.tool .claude-plugin/marketplace.json`
Expected: Re-prints the JSON.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(marketplace): add marketplace manifest for agentic-ironsworn"
```

---

## Task 11: Sync and commit the bundled `ironsworn.duckdb`

**Files:**
- Create: `plugins/ironsworn/data/ironsworn/ironsworn.duckdb` (binary)

- [ ] **Step 1: Copy the file from the other machine**

The file lives at `~/.rpg-data/ironsworn.duckdb` on another machine. Use whatever transfer mechanism is available (rsync, scp, manual copy, etc.):

```bash
# Example via rsync from other machine:
# rsync other-host:~/.rpg-data/ironsworn.duckdb plugins/ironsworn/data/ironsworn/

# Or copy from a local source if already transferred:
cp /path/to/ironsworn.duckdb plugins/ironsworn/data/ironsworn/
```

- [ ] **Step 2: Check the file size**

Run:
```bash
ls -lah plugins/ironsworn/data/ironsworn/ironsworn.duckdb
```

**Branch logic:**
- **<50 MB** — commit directly, continue to Step 4.
- **50–100 MB** — GitHub accepts it but warns on push. Commit directly; flag in PR description.
- **>100 MB** — git-lfs is required. Configure lfs first:
  ```bash
  brew install git-lfs 2>/dev/null || true
  git lfs install
  git lfs track "plugins/ironsworn/data/ironsworn/*.duckdb"
  git add .gitattributes
  ```

Record the size for the PR description.

- [ ] **Step 3: Verify the DB opens and has the expected tables**

Run:
```bash
cd plugins/ironsworn/scribe && bun run -e "
import { DuckDBInstance } from '@duckdb/node-api';
const inst = await DuckDBInstance.create('../data/ironsworn/ironsworn.duckdb', { access_mode: 'READ_ONLY' });
const conn = await inst.connect();
const res = await conn.runAndReadAll(\"SELECT table_name FROM information_schema.tables WHERE table_schema='main'\");
console.log(res.getRowObjectsJS());
conn.closeSync();
"
```
Expected: Output includes `{ table_name: 'chunks' }` (the table `query.ts` reads from at line 210+). If not present, the DB is the wrong artifact — do not commit.

- [ ] **Step 4: Commit the binary**

If using git-lfs:
```bash
git add .gitattributes plugins/ironsworn/data/ironsworn/ironsworn.duckdb
```

Otherwise:
```bash
git add plugins/ironsworn/data/ironsworn/ironsworn.duckdb
```

Commit:
```bash
git commit -m "feat(ironsworn): bundle prebuilt rulebook RAG database

Rulebook prose (ingested by TomeRAG.jl, now living in its own repo) is
packaged into plugins/ironsworn/data/ironsworn/ironsworn.duckdb so the
search_rules and lookup_move MCP tools work immediately after install,
with no build step required."
```

- [ ] **Step 5: Verify `search_rules` works end-to-end (Ollama required)**

Skip this step if Ollama is not running locally. Otherwise:
```bash
cd plugins/ironsworn/scribe && SCRIBE_PLUGIN_ROOT=$(realpath ..) bun run -e "
import { searchRules } from './src/rag/query.ts';
const results = await searchRules('momentum on a miss', { k: 3 });
console.log(JSON.stringify(results, null, 2));
"
```
Expected: Prints up to 3 chunks with `id`, `text`, `headingPath`, `score`. Exits clean.

---

## Task 12: Prune `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Edit `.gitignore`**

Current content:
```
LocalPreferences.toml
.worktrees/
campaigns/
data/ironsworn/classic.json
data/ironsworn/*.duckdb
```

Remove the two `data/ironsworn/…` entries (the directory no longer exists at this level, and in its new home we deliberately want `ironsworn.duckdb` tracked).

New content:
```
LocalPreferences.toml
.worktrees/
campaigns/
```

- [ ] **Step 2: Verify `ironsworn.duckdb` is tracked**

Run:
```bash
git ls-files plugins/ironsworn/data/ironsworn/ironsworn.duckdb
```
Expected: Prints the path (i.e. it's tracked). If blank, something went wrong in Task 11 — stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: prune stale data/ironsworn gitignore entries"
```

---

## Task 13: Plugin README

**Files:**
- Create: `plugins/ironsworn/README.md`

- [ ] **Step 1: Write the README**

Create `plugins/ironsworn/README.md`:
```markdown
# Ironsworn — Solo GM companion for Claude Code

A Claude Code plugin that lets you play solo Ironsworn with a full rules engine:
dice, oracle tables, momentum, debilities, progress tracks, and a living lore
graph that remembers the places, people, and factions you build as you play.

## Prerequisites

- [bun](https://bun.sh) — runs the scribe MCP server
- [ollama](https://ollama.ai) with the embedding model pulled:
  ```bash
  ollama pull nomic-embed-text
  ```
  Ollama must be running locally (default `http://localhost:11434`) whenever
  scribe needs to embed scenes, lore, or rules queries.

## Install

```
/plugin marketplace add https://github.com/<owner>/agentic-ironsworn
/plugin install ironsworn
```

## One-time setup

Scribe has native dependencies (DuckDB). Install them once after the plugin
lands on disk:

```bash
cd ~/.claude/plugins/cache/agentic-ironsworn/ironsworn/*/scribe
bun install
```

## Starting a campaign

1. Create (or `cd` into) a host repo — this is where your save lives:
   ```bash
   mkdir my-ironsworn && cd my-ironsworn && git init
   ```
2. Start Claude Code in that directory.
3. Invoke the GM: `@ironsworn-gm`.
   - On first run the agent will bootstrap a character and walk you through
     the world truths.
   - On subsequent runs it resumes from `campaigns/default/`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SCRIBE_CAMPAIGN` | `campaigns/default` | Campaign directory, relative to cwd |
| `SCRIBE_PLUGIN_ROOT` | set by Claude Code | Plugin install root (auto-wired) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP endpoint |

## What scribe writes to your cwd

Everything under `<SCRIBE_CAMPAIGN>/`:

- `character.json` — character sheet
- `scenes.duckdb` — embedded scene summaries (created on first record_scene)
- `lore.duckdb` — lore entity graph (created on first upsert_lore)
- `npcs/*.json`, `threads/*.json` — narrative state

Version-control these if you want a replayable save.

## Caveats

- `@duckdb/node-api` uses a native addon. If `bun install` fails on your OS,
  see the DuckDB project's native-bindings docs. On macOS and Linux x86_64
  and arm64 it should just work.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/ironsworn/README.md
git commit -m "docs(ironsworn): plugin README with install + setup"
```

---

## Task 14: Marketplace root README

**Files:**
- Create (or rewrite): `README.md`

- [ ] **Step 1: Check whether a root README already exists**

Run: `ls README.md 2>&1`

- [ ] **Step 2: Write the marketplace README**

Create or replace `README.md`:
```markdown
# agentic-ironsworn

A small [Claude Code](https://claude.com/claude-code) marketplace for
tabletop RPG play companions. Each plugin bundles the agent, skills, and
MCP server needed to play a specific game system inside any Claude Code
session.

## Plugins

| Plugin | Description |
|---|---|
| [`ironsworn`](./plugins/ironsworn/) | Solo Ironsworn GM companion — fiction-first, dice-driven, with a living lore graph |

## Install

```
/plugin marketplace add https://github.com/<owner>/agentic-ironsworn
/plugin install ironsworn
```

## Development

This repo is structured so that everything shipped to users lives under
`plugins/<plugin-name>/`, and everything at the top level (`skill-evals/`,
`scripts/`, `docs/`) is for plugin development only and is never installed.

The rulebook RAG ingestion pipeline used to build
`plugins/ironsworn/data/ironsworn/ironsworn.duckdb` is a separate Julia
project: [TomeRAG.jl](https://github.com/<owner>/TomeRAG.jl) (link will be
updated once that repo is published).
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(marketplace): root README describing marketplace layout"
```

---

## Task 15: Extract `TomeRAG.jl` into its own repo

**Files:**
- Delete (from this repo): `TomeRAG.jl/`

- [ ] **Step 1: Extract the subtree to a throwaway location**

Run:
```bash
cd /Users/kmjq089/Code/personal/agentic-ironsworn
# Run from the main repo, not the worktree, so the split has full object access.
git subtree split --prefix=TomeRAG.jl -b tomerag-extracted
git log tomerag-extracted --oneline | head -5
```
Expected: Prints recent commits that touched `TomeRAG.jl/`. The extracted branch exists now.

- [ ] **Step 2: Push to a new GitHub repo**

Create the repo on GitHub (manually or via `gh`):
```bash
gh repo create <owner>/tomerag-jl --public --description "Julia RAG ingestion pipeline for tabletop RPG content"
```

Push the extracted branch as `main`:
```bash
cd /tmp
mkdir tomerag-jl && cd tomerag-jl && git init
git remote add origin git@github.com:<owner>/tomerag-jl.git
git pull /Users/kmjq089/Code/personal/agentic-ironsworn tomerag-extracted
git push -u origin HEAD:main
```

- [ ] **Step 3: Verify the new repo has the expected history**

Run:
```bash
cd /tmp/tomerag-jl && git log --oneline | wc -l
```
Expected: ~52 commits (the number returned by `git log --oneline -- TomeRAG.jl | wc -l` in the source repo).

- [ ] **Step 4: Remove `TomeRAG.jl/` from this repo**

Back in the worktree:
```bash
cd /Users/kmjq089/Code/personal/agentic-ironsworn/.worktrees/feature-marketplace-plugin
git rm -r TomeRAG.jl
```

- [ ] **Step 5: Clean up the temporary branch in the main repo**

```bash
cd /Users/kmjq089/Code/personal/agentic-ironsworn
git branch -D tomerag-extracted
```

- [ ] **Step 6: Update the README TomeRAG link placeholder**

In `README.md` at the line:
```
The rulebook RAG ingestion pipeline used to build
`plugins/ironsworn/data/ironsworn/ironsworn.duckdb` is a separate Julia
project: [TomeRAG.jl](https://github.com/<owner>/TomeRAG.jl) (link will be
updated once that repo is published).
```

Replace `<owner>` with the actual GitHub owner now that the repo exists, and drop the "(link will be updated…)" trailer.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: extract TomeRAG.jl to its own repo, drop from marketplace"
```

---

## Task 16: End-to-end smoke test

**Files:** (no new files — this task verifies end-to-end behavior)

- [ ] **Step 1: Create a scratch host repo**

```bash
rm -rf /tmp/ironsworn-smoke
mkdir -p /tmp/ironsworn-smoke && cd /tmp/ironsworn-smoke && git init
```

- [ ] **Step 2: Install the marketplace from the local worktree path**

Start Claude Code in `/tmp/ironsworn-smoke`. In the Claude Code prompt, run:
```
/plugin marketplace add /Users/kmjq089/Code/personal/agentic-ironsworn/.worktrees/feature-marketplace-plugin
/plugin install ironsworn
```

Exit Claude Code.

- [ ] **Step 3: Run `bun install` in the installed scribe dir**

```bash
cd ~/.claude/plugins/cache/agentic-ironsworn/ironsworn/*/scribe && bun install
```
Expected: Installs cleanly. If the DuckDB native-addon build fails, stop — that's a platform-install bug, not a migration bug; document in PR notes.

- [ ] **Step 4: Start Claude Code again and smoke-test the agent**

In `/tmp/ironsworn-smoke`, start Claude Code. Invoke `@ironsworn-gm` with a short user message (e.g. "I want to make a character"). Confirm:

1. Scribe MCP process starts with no startup errors in the session log.
2. The agent can call `get_character_digest` (returns "no character" cleanly).
3. The agent can invoke the `ironsworn-character-builder` skill.
4. After a character is created, `character.json` appears at `/tmp/ironsworn-smoke/campaigns/default/character.json` — NOT inside the plugin cache.
5. If prompted mid-play, the agent can call `resolve_move` with a move name and succeed (this proves `moves.yaml` is being read via `SCRIBE_PLUGIN_ROOT`).
6. If prompted, `roll_oracle` with a table name succeeds (proves `oracles.yaml` is read).
7. If prompted with a rules question, `search_rules` returns non-empty chunks (proves `ironsworn.duckdb` is read).

Record any failures with the specific error text.

- [ ] **Step 5: Verify host-dir vs. plugin-dir separation**

```bash
ls /tmp/ironsworn-smoke/campaigns/default/ 2>&1
ls ~/.claude/plugins/cache/agentic-ironsworn/ironsworn/*/campaigns/ 2>&1
```
Expected: `/tmp/ironsworn-smoke/campaigns/default/` has character/scenes/lore files. The plugin-cache `campaigns/` path does NOT exist (no accidental writes into the plugin dir).

- [ ] **Step 6: Clean up**

```bash
rm -rf /tmp/ironsworn-smoke
# Uninstall the test plugin so no stale cache lingers
# (do this via /plugin uninstall ironsworn + /plugin marketplace remove in Claude Code)
```

- [ ] **Step 7: No commit — this task is verification only.**

If any part of Step 4 failed, file follow-up issues / fix in a new task before opening the PR.

---

## Self-Review

**Spec coverage check:**

| Spec section | Task(s) covering it |
|---|---|
| Goal + architecture overview | Plan header |
| Repository layout | Tasks 1–5, 8, 9 |
| Two runtime anchors | Tasks 6, 7, 9 |
| Plugin `.mcp.json` | Task 9 |
| Agent frontmatter change | Task 2 |
| Scribe code changes (moves.ts) | Task 6 |
| Scribe code changes (oracles.ts) | Task 6 |
| Scribe code changes (query.ts) | Task 7 |
| scripts/sheet.ts patch | Task 8 |
| Marketplace manifest | Task 10 |
| plugin.json | Task 1 |
| TomeRAG extraction | Task 15 |
| Dev content stays at root | Task 3 (workspaces moved to skill-evals/), no-op for skill-evals/, scripts/, docs/ |
| Data in git (YAMLs) | Task 5 |
| Data in git (duckdb) | Task 11 |
| Install UX / README | Tasks 13, 14 |
| Testing & verification | Tasks 6, 7, 11, 16 |
| .gitignore prune | Task 12 |

All spec sections are covered.

**Placeholder scan:** No TBDs, no "implement later", no "add validation", no reference-without-definition. `<owner>` placeholders in README.md are flagged for filling during Task 15 Step 6 — that's a known deferral, not a plan gap.

**Type consistency:** `resolveMovesPath()` / `resolveOraclesPath()` / `resolveDbPath()` naming is consistent across Tasks 6 and 7. Env var name `SCRIBE_PLUGIN_ROOT` is consistent across Tasks 6, 7, 9, 13. Campaign dir env var `SCRIBE_CAMPAIGN` is never renamed.
