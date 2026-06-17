# Task brief — roll back the Graphiti/FalkorDB storage layer (commit to Path B)

**You are a fresh agent. This brief is self-contained — execute it from here.**
You are already on branch `claude/rollback-graphiti-path-b` (off `main` @ `dccef83`).
Delete this brief file as the final step of your rollback commit.

---

## Why (the decision, already made)

The v1 design (`docs/design/agentic-rpg-v1.md`) framed the knowledge-graph
backend as a **gating spike**: **Path A** = Graphiti + FalkorDB; **Path B** =
embedded store we own (shipped as DuckDB in #166/#169). The spike
(`docs/spikes/2026-06-graphiti.md`) was merged as a *hybrid* (PR #184, plugin
v0.29.0): `search_lore`/`get_lore` and scene extraction route through
graphiti-ts + FalkorDB when `FALKORDB_HOST` is set, else fall back to DuckDB.

**Decision: reject Path A storage, commit to Path B.** Reasons:

1. **FalkorDB is a mandatory server** — violates v1 Goal #1 (`agentic-rpg-v1.md:24`,
   "no external service hard-required") for a solo-player CC plugin.
2. **No embedded backend survives.** Graphiti's only embedded driver (Kuzu) is
   **archived** (`kuzudb/kuzu` `isArchived: true`, last release v0.11.3 2025-10-10)
   and **deprecated by Graphiti** (its `pyproject.toml`: "the upstream Kuzu
   project is unmaintained; this extra will be removed"). Graphiti's remaining
   backends (Neo4j, FalkorDB, Neptune) are all servers.
3. **Every Graphiti win is extraction logic, not storage.** Per the spike's own
   scoring matrix (§5), Graphiti wins on extraction-side dimensions (relation-label
   quality, temporal/supersedes, alias resolution); DuckDB wins on storage/runtime
   (scene/beat model, world-canon visibility, proximity, ops simplicity, TS).
4. **The valuable extraction quality is already in DuckDB.** The graphiti-inspired
   prompt (SCREAMING_SNAKE verb labels + `supersedes` flag) was ported in Phase 2
   (commit `d009938`) and lives in `_makeDefaultExtractor`
   (`packages/core/src/rag/extraction.ts:317`). It has **no** graphiti/FalkorDB
   dependency and **must be preserved**.

**This is a surgical forward removal, NOT `git revert` of #184.** A revert would
also undo the valuable Phase-1 bi-temporal work (`valid_at`/`invalid_at`) and the
Phase-2 prompt. Remove only the storage/runtime layer; keep the extraction logic.

---

## A. Code removal (surface confirmed by `git grep` on 2026-06-16; verify line numbers, they drift)

1. **Delete** `packages/core/src/rag/graphiti-adapter.ts` (entire file).
2. `packages/core/src/rag/extraction.ts`:
   - Remove `import { ingestEpisode } from "./graphiti-adapter.js";` (~`:13`)
   - Remove `const GRAPHITI_ENABLED = Boolean(process.env["FALKORDB_HOST"]);` (~`:21`)
     and its comment block.
   - Remove the `if (GRAPHITI_ENABLED && opts?.extractor === undefined) { … }`
     branch (~`:153-173`) that delegates to `ingestEpisode` and returns a zeroed
     report. **Keep everything below it** (the DuckDB path) — especially
     `_makeDefaultExtractor` and its prompt. Do not touch the prompt.
3. `packages/core/src/rag/lore.ts`:
   - Remove `export async function searchLoreGraphiti(...)` (~`:493`) and
     `export async function getLoreGraphiti(...)` (~`:547`).
   - Remove the `UUID_RE` const used only by those.
   - Remove the dynamic `await import("./graphiti-adapter.js")` calls inside them.
   - **Keep** `searchLore`, `getLore`, `getLoreGraph`, `upsertLore`, `linkLore`,
     and the bi-temporal `valid_at`/`invalid_at` logic.
4. `packages/core/src/index.ts` — remove `searchLoreGraphiti` and `getLoreGraphiti`
   from the lore re-export list. Leave the other lore exports.
5. `plugins/ironsworn/scribe/src/tools/lore.ts`:
   - In the `get_lore` handler, remove the graphiti-first block (~`:198-202`,
     `getLoreGraphiti(...)`) so it calls `getLore(...)` directly.
   - In the `search_lore` handler, remove the graphiti-first block (~`:233-235`,
     `searchLoreGraphiti(...)`) so it uses the DuckDB search directly.
   - Remove the now-unused imports of those two functions.
6. `packages/core/package.json` — remove the `"@graphiti/core": "workspace:*"` dep.
7. Root `package.json` — remove `"packages/graphiti-core"` and
   `"packages/graphiti-shared"` from the `workspaces` array.
8. **Delete** `packages/graphiti-core/` and `packages/graphiti-shared/` directories
   (vendored build bundles; `packages/graphiti-core/dist/index.js` is ~3.8 MB).
9. `plugins/ironsworn/.mcp.json` — remove the `FALKORDB_HOST` and `FALKORDB_PORT`
   env entries (and fix trailing comma/JSON validity).
10. Run `bun install` from the repo root to regenerate `bun.lock` without the
    graphiti packages. (Sandbox note below if it fails on tempdir.)

After removal, **grep must be clean**:
`git grep -niE 'graphiti|falkordb|ingestEpisode' -- 'packages/core/src/**' 'plugins/**/*.ts' 'plugins/**/*.json' 'package.json'`
should return nothing (docs are allowed to mention them).

## B. Doc updates

11. `docs/design/agentic-rpg-v1.md`:
    - **OQ1** (~`:1418`) — mark resolved: "**Resolved (2026-06-16): Path B.**"
    - **D8** (~`:1370`) — change from "decided by spike … Default lean: Path A" to
      "**Decided: Path B** (embedded store, shipped as DuckDB). FalkorDB rejected
      (mandatory server vs. Goal #1; Graphiti's embedded Kuzu backend archived &
      deprecated). Graphiti's *extraction approach* adopted into the DuckDB
      extractor; see `docs/spikes/2026-06-graphiti.md`."
    - Migration item **#3** (~`:1284`) — mark ✅: committed to Path B (DuckDB).
    - Add a one-line resolution note to the "KG layer — two paths" section
      (~`:585`) and to v1 priority #1 (~`:158`).
12. `docs/spikes/2026-06-graphiti.md`:
    - Update the **Decision** header (`:6`) to the final verdict:
      "**Reject Path A storage (FalkorDB); commit to Path B (DuckDB). Adopt
      Graphiti's extraction approach into the DuckDB extractor.**"
    - Append a short `## Final decision (2026-06-16)` section with the three
      reasons from "Why" above. Leave the original analysis intact as the record.

## C. Version bump (REQUIRED — Stop hook blocks otherwise)

13. `plugins/ironsworn/.claude-plugin/plugin.json`: `0.29.0` → **`0.30.0`**
    (minor; removes a behavior path). The Stop hook compares against `origin/main`
    and verifies the version increased.

## D. Verify

14. `cd packages/core && bun run tsc --noEmit` then `bun test`.
15. `cd plugins/ironsworn/scribe && bun run tsc --noEmit` then `bun test`
    (run from the scribe dir — the Bash cwd persists between calls; cd explicitly).
16. Confirm `bun install` succeeded and `bun.lock` no longer references graphiti.

## E. Data — NOT part of this PR

The Zura world DB lives **outside the repo** at
`/media/karim/Code-Drive/karimn-code/zura-ironsworn/world.duckdb`. Its DuckDB lore
(368 entities / 509 relations) is **intact** — the FalkorDB store was a redundant
parallel extraction of the same 59 scenes. **No data migration in this PR.**
Optional, decoupled local follow-up (mention in PR body, do not do here): to refresh
DuckDB lore with richer extraction, clear the zeroed `lore_extraction_log` rows and
re-run `extractUnprocessedScenes` with `FALKORDB_HOST` unset.

## F. Finalize

17. Delete this brief file (`docs/process/2026-06-16-graphiti-rollback-brief.md`).
18. Commit. Suggested message:
    `refactor(rag): remove Graphiti/FalkorDB storage layer; commit to Path B (DuckDB)`
    Body: summarize the decision + that extraction logic is preserved. End with the
    `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
19. Open a PR against `main` (`gh`, account `karimn`). PR body: link the decision,
    note "not a revert — extraction quality preserved in `_makeDefaultExtractor`",
    list the optional Zura re-extraction as a follow-up. End with the
    `🤖 Generated with [Claude Code]` line.

## Gotchas

- **Bun workspace**: two packages — `@agentic-rpg/core` (`packages/core`) and the
  scribe MCP shim (`plugins/ironsworn/scribe`). `@graphiti/*` are private vendored
  workspaces you are deleting.
- **gh**: active account `karimn`; SSH via the `github-personal` host alias. If `gh`
  auth complains, `gh auth refresh` (don't re-login). Push uses SSH.
- **Sandbox**: `bun install` may fail writing to tempdir, and `git push` (SSH/port 22)
  may fail under the sandbox even though `github.com` is allowlisted for HTTPS. These
  are sandbox restrictions, not auth problems — retry with the sandbox disabled for
  that specific command and explain why.
- Do **not** `git revert` #184. Do **not** weaken tsconfig strictness to make types
  pass — if a dangling reference remains, delete it.
