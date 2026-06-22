# Extraction-Quality Pass — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorm), pending implementation plan
**Depends on:** Extraction eval harness (`packages/core/eval/`, PR #187 / commit `3fe4545`)

## Problem

The eval harness scored the current extraction pipeline against the curated
Zura golden set and surfaced four weak spots:

| Metric | Baseline | Reading |
|---|---|---|
| Entity precision | 0.67 | ~1 in 3 extracted entities is noise the curator pruned |
| Entity recall | 0.87 | a few consequential entities (notably **Caldren**) never land |
| Dedup | 0.53 | the same real entity is extracted as multiple rows |
| Relation F1 | 0.41 | endpoint-primary; labels too unstable to score literally |
| Temporal | 0/2 | no supersession is ever recorded |

This pass attacks **precision, dedup, and temporal** together. Relation F1 is
left alone — it is dominated by label-vocabulary noise the endpoint-primary
metric already discounts, and there is no deterministic lever for it.

### Root causes

- **Temporal 0/2.** `invalidateRelations` (`packages/core/src/rag/lore.ts:560`)
  matches the relation to invalidate on `from_entity = ? AND to_entity = ? AND
  label = ?`. But a supersession is semantically a *different* label than the
  fact it replaces — the banishment scene emits `Caldren BANISHED_FROM Holtfen`,
  which can never match the prior `HOLDS_TITLE` / `LOCATED_IN`. This is the same
  label-instability that forced the *scorer* to go endpoint-primary; the write
  path was never updated to match. The scorer (`score.ts`) already credits
  temporal correctness endpoint-primary (label-agnostic), so the write path and
  the metric currently disagree.
- **Dedup 0.53 + Caldren recall.** Two dedup layers exist: a vector pre-check in
  `extraction.ts` (`DEDUP_SIMILARITY_THRESHOLD = 0.92`) and `upsertLore`'s exact
  canonical/alias/slug resolution. A duplicate row survives only when *both*
  miss — i.e. a variant name (`Caldren` vs `Captain Caldren`) that is not an
  exact alias match and sits below cosine 0.92. The 0.92 floor is stricter than
  the scorer's `DEFAULT_SIM_THRESHOLD = 0.85`, so the pipeline and the eval
  disagree on "same entity." Variant splitting both lowers dedup and can drop a
  golden entity below the match line (the Caldren recall gap).
- **Precision 0.67.** The extractor emits generic / implied / non-consequential
  entities the curator treats as noise. Two sub-levers: confidence below the
  threshold is currently *flagged* (`needs_review`) but still inserted, and the
  prompt's noise rules are under-specified.

## Goals / Non-goals

**Goals**
- Temporal `0/2 → 2/2` — the deterministic, pass/fail gate for this work.
- Dedup and precision: measurable improvement where deterministic; directional
  otherwise.
- Keep the pipeline single-pass (no second LLM resolution pass — that is
  Approach C, deferred as YAGNI against a noisy eval).

**Non-goals**
- Relation-label accuracy.
- Multi-run averaging in the harness (we lean on deterministic code instead of
  making the noisy metrics trustworthy).
- Any change to the golden set or scorer (the spec stays fixed; we move the
  extractor toward it, not the reverse).

## Measurement discipline

The README documents that single-run dedup/precision deltas under ~0.1 are
run-to-run noise. Therefore:

- **Temporal** is the hard gate, verified two ways: a deterministic unit test
  (no LLM) and the end-to-end eval.
- **Dedup** is verified deterministically (stubbed-embedding unit test on the
  resolver) and corroborated by the eval.
- **Precision** is *directional only*. The deterministic confidence-drop is
  unit-tested; the prompt sharpening is included at the user's request but its
  eval delta is explicitly treated as non-attributable noise, not a success
  criterion.

## Design

### Component 1 — Endpoint-primary invalidation (temporal)

`invalidateRelations` becomes endpoint-primary and **directed**: drop the
`label = ?` predicate; keep `from_entity = ? AND to_entity = ?`. Given a
superseding relation with `supersedes: true` and a scene timestamp, it sets
`invalid_at` on every currently-valid (`invalid_at IS NULL`) relation on the
resolved `from → to` pair, regardless of label. Direction is preserved
(`from → to` only) so a `Holtfen → Caldren` fact is never collateral-damaged.

- Single caller (`extraction.ts:218`), so the signature change has no blast
  radius. The `label` parameter is removed from the function.
- The superseding relation itself is still created (existing `linkLore` call
  after the invalidation), so `BANISHED_FROM` lands as a new current fact.

**Verification (deterministic, no LLM):** a synthetic `Extractor` emits
`Caldren HOLDS_TITLE Holtfen` and `Caldren LOCATED_IN Holtfen` from an early
scene, then `Caldren BANISHED_FROM Holtfen` with `supersedes: true` from a later
scene; assert both prior rows carry a non-null `invalid_at` and the new row does
not.

### Component 2 — Dedup threshold alignment (dedup + Caldren recall)

Lower `DEDUP_SIMILARITY_THRESHOLD` in `extraction.ts` from `0.92` to `0.85`,
matching the scorer's `DEFAULT_SIM_THRESHOLD`. This makes the write-path notion
of "same entity" agree with the eval's. Variant mentions of one entity collapse
onto a single row, which raises dedup, raises precision (fewer actual rows), and
is the expected fix for the Caldren recall gap.

- Risk: over-merge of genuinely distinct, similarly-named entities (e.g.
  `Ashfen Market Quarter` vs `Ashfen`). The eval re-baseline is the guard — if
  recall or precision regresses, the threshold is too low.
- No normalization of canonicals in this pass (the more aggressive option was
  considered and rejected as higher-risk; revisit only if 0.85 under-merges).

**Verification (deterministic, stubbed embeddings):** a unit test driving the
resolver with two names whose stubbed embeddings sit at cosine ~0.88 asserts
they resolve to one entity at 0.85 (and would not have at 0.92).

### Component 3 — Precision filtering (directional)

Two changes:

1. **Deterministic:** entities with `confidence < threshold` are *dropped*
   (counted as skipped) rather than inserted with a `needs_review` flag. This is
   the measurable precision lever and is unit-tested.
2. **Prompt (directional):** sharpen the extraction prompt's entity noise rules
   with the curator's "named + consequential = lore" principle and one or two
   concrete negative examples (e.g. "a guard", "some merchants", "X is alive").
   Included at the user's request; its eval impact is treated as noise, not a
   gate.

### Component 4 — Re-baseline, tests, version, commit

- Add the deterministic unit tests for Components 1–3 (no LLM, no Ollama
  required).
- Re-run the full eval (`ANTHROPIC_API_KEY` + Ollama) and record the new
  `packages/core/eval/baseline.json`. Acceptance: `temporal` is `2/2`; entity
  precision and dedup do not regress materially (within noise); recall holds or
  improves.
- Update `packages/core/eval/README.md` baseline numbers if they move.
- Bump `plugins/ironsworn/.claude-plugin/plugin.json` (minor — new behavior).

## Files touched

- `packages/core/src/rag/lore.ts` — `invalidateRelations` signature + WHERE
  clause (Component 1).
- `packages/core/src/rag/extraction.ts` — invalidation call site (drop `label`
  arg), `DEDUP_SIMILARITY_THRESHOLD` 0.92→0.85, confidence-drop, prompt text
  (Components 1–3).
- `packages/core/src/rag/*.test.ts` (or a new `extraction.test.ts`) —
  deterministic unit tests with synthetic extractor + stubbed embeddings.
- `packages/core/eval/baseline.json`, `packages/core/eval/README.md` —
  re-baseline (Component 4).
- `plugins/ironsworn/.claude-plugin/plugin.json` — version bump.

## Risks

- **Over-invalidation** if a directed pair legitimately holds multiple
  simultaneous current relations where only one is superseded. Accepted: in this
  narrative domain a supersession between two entities nullifies the prior state
  between them; the eval catches regressions.
- **Over-merge** at threshold 0.85 (Component 2) — guarded by re-baseline.
- **Supersedes never set.** Components 1–2 are necessary but not sufficient: the
  LLM must still set `supersedes: true` on the banishment and extract Caldren.
  This is the irreducible probabilistic part; the prompt sharpening (Component 3)
  is the only lever, and the eval is the check. If temporal stays 0/2 after the
  deterministic fixes, the failure is extraction-side (recall/flag), not the
  invalidation code — diagnosable by inspecting the throwaway DB.
