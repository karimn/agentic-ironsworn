---
name: feedback_fw_pattern_conventions
description: Established code/test patterns each fiction-workflow (FW) PR should follow, distilled from FW1-FW3 (PRs #203-#205).
type: feedback
---

Each FW PR in this repo (agentic-rpg / agentic-ironsworn plugin) has converged
on a consistent shape. Follow it rather than inventing a new one — it makes
review fast and keeps the core/scribe split intact.

**Why:** FW2 (PR #204) and FW3 (PR #205) both independently reached the same
structure, and PR #204's diff was explicitly given as "the model for scope,
testing rigor, and PR body style" for FW3 — so this is a deliberate, stable
convention, not incidental.

**How to apply**, for any new GM-context-injected feature or campaign-scoped
data feature:

1. **DB-fetch / pure-render split.** A `core` function does the DB query and
   returns plain data (e.g. `getCanonBriefing`, `listCanonizeCandidates`,
   `listOpenContradictions`). A *pure* function in
   `scribe/src/context/build.ts` (e.g. `buildCanonBriefingSection`,
   `buildContradictionsSection`) takes that data plus any trigger inputs and
   returns a markdown string or `""`. This split makes the trigger logic and
   rendering testable without a `world.duckdb` fixture, while DB behavior
   (visibility filters, joins) gets its own DB-integration tests in `core`.
2. **Export from `core`'s `index.ts`** in a clearly labeled section comment
   (e.g. `// RAG — canon briefing (FW3, #198): ...`), both the function and
   its types.
3. **Wire into `buildContext`** in scribe's `context/build.ts` with a
   `try { ... } catch { /* omit if X unavailable */ }` block, pushed into the
   `sections` array only if non-empty — mirrors every other section (recent
   scenes, threads, contradictions).
4. **Expose an MCP tool too**, even if the feature is primarily
   context-auto-injected (e.g. `get_canon_briefing` alongside
   `list_canonize_candidates`) — gives the GM/player a way to re-check later,
   and is cheap once the core function exists.
5. **Testing**: DB-integration tests in `packages/core/src/rag/<feature>.test.ts`
   using the `insertEntity`/`insertRelation`/`insertScene` raw-SQL helper
   pattern (see `canonize.test.ts`, copied into `canon-briefing.test.ts`) —
   always assert the visibility filter explicitly (canon vs. this-campaign vs.
   sibling-campaign rows). Pure-render tests in `scribe/src/context/build.test.ts`
   alongside `buildContradictionsSection`'s tests. MCP tool-surface tests in
   `scribe/src/tools/lore.test.ts` using the `dbReady` gate (skips cleanly
   when the DuckDB `vss` extension can't be downloaded in a sandboxed CI) and
   `seedEntity`/`seedRelation` helpers already defined there.
6. **Docs**: update `docs/design/world-db.md` with a new section describing
   the feature (mirrors "Promotion to canon"), update
   `docs/design/agentic-rpg-v1.md`'s FW table row to add a ✅, and if there's
   a user-facing workflow, add it to `plugins/ironsworn/README.md`.
7. **`ironsworn-gm.md`** almost always needs a new paragraph telling the GM
   when/how to use the new context section or tool — don't forget this, it's
   easy to miss since it's not code.
