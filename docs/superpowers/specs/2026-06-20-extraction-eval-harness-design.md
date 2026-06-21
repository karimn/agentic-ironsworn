# Extraction Evaluation Harness — Design Spec

Status: design spec (approved 2026-06-20). Implements **v1 priority #2**
from [`agentic-rpg-v1.md`](../../design/agentic-rpg-v1.md): *"Build a
fixed set of Zura scenes with known-correct entities and relations,
scored on every prompt or model change. Without this, extraction quality
is vibes."*

## Purpose

A developer-invoked evaluation that answers one question with numbers
instead of vibes: **did this prompt or model change make lore extraction
better or worse?**

It runs a fixed, ordered set of real Zura scenes through the **full
extraction pipeline** into a throwaway world DB, scores the resulting DB
state against a hand-curated golden set, and diffs the scorecard against
a committed baseline. The developer eyeballs the diff and, on accepting a
change, re-commits the baseline.

This is the regression net for the highest-leverage coherence component.
Everything downstream in the v1 coherence sequence (temporal truth,
contradiction surfacing, retrieval discipline) rests on extraction
producing signal rather than noise; without a score, "noise" is
invisible.

## Scope decisions (settled in brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Unit under test | **Full pipeline** (`extractLoreFromScene` → dedup → `upsertLore`/`linkLore`), scored on resulting DB state | The doc's named failure modes (near-duplicates, mis-typed relations) are partly *dedup/linking* behavior, not just the prompt. Scoring DB state captures real coherence quality. |
| Golden set authoring | **Bootstrap + human-curate** | Dump current extractor output for the chosen scenes as a draft, then hand-correct into the golden fixture. Fastest route to a realistic label set grounded in real play; the curation *is* the spec of "good extraction." |
| Run mode | **Standalone script + saved baseline** | Extraction hits a real LLM (cost, nondeterminism, needs Ollama). A `bun run` eval that prints a scorecard and diffs a committed baseline matches the doc's "every prompt or model change" cadence. Not blocking CI. |
| Fixture home | **Committed to the public repo** under `packages/core/eval/` | Reproducible; baseline diffs are meaningful in PRs. Real Zura prose becomes public — accepted (owner's repo, owner's campaign). |
| Metrics | **All four:** entity P/R/F1 + type accuracy · relation P/R/F1 · dedup/alias correctness · temporal correctness | Cover the doc's failure modes plus the now-landed #3 temporal machinery. |
| Matching | **Normalized name/alias match, embedding-similarity fallback** | Tolerates wording drift without rewarding hallucinations; mirrors the pipeline's own dedup logic. |
| Corpus size | **~12–15 scene contiguous arc, ≥1 supersedes event** | Enough signal across all four metrics; curation is a few focused hours; fast/cheap to re-run. Fixture set may grow later. |

## Architecture

The clean seam the harness drives already exists:
`extractLoreFromScene(campaignPath, sceneId, opts)` in
`packages/core/src/rag/extraction.ts`, which calls the injectable
`Extractor = (sceneText, existingEntities) => Promise<ExtractionResult>`.
The harness uses the **default** extractor (the real LLM) so it measures
the shipping prompt + model + dedup + linking together.

### Layout — `packages/core/eval/`

| Path | Role | Depends on |
|---|---|---|
| `fixtures/scenes.jsonl` | Ordered real Zura scene records (`{ id, text or beats, timestamp }`). The corpus. | — |
| `fixtures/golden.yaml` | Curated ground truth: expected entities + relations. | — |
| `baseline.json` | Last-accepted scorecard. The diff target. | — |
| `score.ts` | **Pure** scoring core: `(actual, golden, embedder) → Scorecard`. No DB, no orchestration. | embedder fn (for fuzzy match) |
| `run-eval.ts` | Orchestrator: seed temp DB, run pipeline in order, read DB state, call `score.ts`, print + diff. | core `rag/*`, `score.ts` |
| `bootstrap.ts` | One-shot: dump current extractor output for chosen scenes → `golden.draft.yaml` for hand-correction. | core `rag/*` |
| `score.test.ts` | Unit tests for `score.ts` with synthetic actual/golden pairs. | — |

`packages/core/package.json` gains `"eval:extraction": "bun run eval/run-eval.ts"`.

### Why `score.ts` is isolated and pure

The harness's *own* correctness must not depend on the LLM. `score.ts`
takes already-materialized `actual` and `golden` structures plus an
embedder function and returns a `Scorecard`. That makes it unit-testable
with hand-written pairs: a perfect match scores 1.0; a miss, a false
positive, a wrong type, a near-duplicate, and an un-invalidated temporal
relation each move exactly one metric in the expected direction. The
embedder is injected so tests can pass a deterministic stub instead of
Ollama.

## Data formats

### `fixtures/scenes.jsonl`

One JSON object per line, in processing order:

```jsonc
{ "id": "scene-0042", "timestamp": "...", "beats": [ { "beat_index": 0, "kind": "...", "speaker": "...", "text": "..." } ] }
```

(Mirrors what `getScene(..., { include_beats: true })` returns, so
`run-eval.ts` can `recordScene` them back into a fresh DB faithfully.)

### `fixtures/golden.yaml`

```yaml
entities:
  - canonical: Ashfen Market Quarter
    type: place
    aliases: ["the Ashfen market", "the market quarter"]
  - canonical: Lona
    type: creature
    aliases: ["the healer Lona", "Lona of Caldren"]
relations:
  - from: Lona
    to: Ashfen Market Quarter
    label: LOCATED_IN
  - from: Magistrate Veil
    to: Ashfen
    label: HOLDS_TITLE
    invalidated: true   # superseded later in the arc; DB must have invalid_at set
```

`type` is one of the `LORE_TYPES`. `invalidated: true` marks a relation
that a later scene in the arc supersedes — the temporal-correctness
check asserts the DB row carries a non-null `invalid_at`.

### `baseline.json` / `Scorecard`

```jsonc
{
  "entity":   { "precision": 0.0, "recall": 0.0, "f1": 0.0, "typeAccuracy": 0.0 },
  "relation": { "precision": 0.0, "recall": 0.0, "f1": 0.0 },
  "dedup":    { "score": 0.0 },            // 1 - (nearDuplicateActuals / matchedGolden)
  "temporal": { "correct": 0, "total": 0 } // invalidated golden relations resolved correctly
}
```

## Scoring detail

### Entity matching (the core rubric)

For each run, build a 1:1 matching between actual entities (DB rows) and
golden entities:

1. **Normalized name pass.** Lowercase + trim canonical and all aliases
   on both sides. An actual matches a golden if their name-sets
   intersect.
2. **Embedding fallback.** Unmatched actuals get a second pass: cosine
   similarity of canonical-name embeddings ≥ `0.85` → match. (Ollama is
   already required for the pipeline; this reuses the same embedder.)
3. **Greedy 1:1.** Each golden entity binds to at most one actual (best
   similarity wins). Surplus actuals that bind to an already-matched
   golden are **near-duplicates**; surplus actuals that bind to nothing
   are **false positives**.

From the matching:

- **Precision** = matched / total actual; **Recall** = matched / total
  golden; **F1** = harmonic mean.
- **Type accuracy** = of matched pairs, fraction whose `type` agrees.
- **Dedup score** = `1 − nearDuplicateActuals / max(1, matchedGolden)` —
  directly penalizes the "near-duplicates" failure mode and exercises the
  pipeline's dedup threshold.

### Relation matching

A relation `(from, to, label)` matches a golden relation when **both
endpoints match** (via the entity matching above) **and** labels agree —
exact, or via a small, explicit synonym map (e.g. `MEMBER_OF ≈ SERVES`)
kept intentionally tiny. P/R/F1 as for entities.

### Temporal correctness

For each golden relation with `invalidated: true`, find the
corresponding DB relation and assert `invalid_at IS NOT NULL`. Report as
`correct / total`. A vacuous arc (no supersedes case) would make this
`0/0`; the fixture arc is chosen to contain at least one, so it isn't.

## Execution flow (`run-eval.ts`)

1. Preflight: require `ANTHROPIC_API_KEY` and a reachable Ollama; exit
   with a clear message otherwise (same gating posture as existing
   Ollama-dependent tests).
2. `mkdtemp` a fresh campaign dir → fresh `world.duckdb` (no seed).
3. For each fixture scene in order: `recordScene`, then
   `extractLoreFromScene` with the **default** extractor wrapped at
   **temperature 0** (reduce sampling noise).
4. Read final DB state: entities (canonical, type, aliases), relations
   (from, to, label, `invalid_at`).
5. `score.ts` → `Scorecard`.
6. Print the scorecard with per-metric deltas vs `baseline.json`; write
   nothing automatically. Accepting a change is a manual
   `cp scorecard → baseline.json` commit.

### Determinism posture

Temperature 0 cuts most jitter but a single run is one sample. The
baseline-diff-and-accept workflow absorbs residual noise: a real
regression moves a metric well outside sampling wobble; a wobble inside
it is eyeballed and ignored. Multi-sample averaging is **explicitly
deferred** (see Out of scope).

## The curation workflow

`bootstrap.ts` runs the current pipeline over the chosen ~12–15 scenes
and emits `golden.draft.yaml` (the current extractor's output, shaped as
the golden schema). The developer then corrects it by hand: fix types,
merge duplicates, delete noise, add missed entities/relations, and flag
the supersedes case(s) with `invalidated: true`. The corrected file
becomes `golden.yaml` — the authored spec of "good extraction."

Scene selection: a contiguous Zura arc containing at least one
supersedes/temporal event (a title stripped, an alliance broken, a
location changed). Exact scene IDs are chosen during implementation and
recorded in the plan.

## Testing the harness itself

`score.test.ts` drives `score.ts` with synthetic pairs and a stub
embedder:

- Identical actual == golden → all metrics maximal.
- One missing golden entity → recall drops, precision unchanged.
- One extra unrelated actual → precision drops (false positive, not a
  near-dup).
- One extra actual that embeds near a matched golden → dedup score drops.
- One matched pair with wrong `type` → type accuracy drops, F1 unchanged.
- One golden relation `invalidated: true` whose DB row lacks `invalid_at`
  → temporal `0/1`.

No LLM, no Ollama in these tests — the embedder is stubbed.

## Out of scope (YAGNI)

- Multi-sample averaging / statistical confidence intervals.
- Blocking CI gating (the eval is developer-invoked).
- A Graphiti / alternate-extractor comparison harness (the spike is
  closed; this measures the shipping DuckDB extractor only).
- Scoring free-text scene-summary prose quality.
- Any UI beyond the printed scorecard.
- Growing past the initial arc — the fixture set may expand later, but
  v1 ships the ~15-scene set.

## Open items for the implementation plan

- Exact Zura scene IDs for the arc (chosen + recorded during impl).
- The relation-label synonym map's initial contents (kept minimal).
- Embedding-similarity threshold tuning (`0.85` is the starting point).
