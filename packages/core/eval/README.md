# Extraction evaluation harness

Scores the full lore-extraction pipeline on a fixed, diversity-stratified set of
real Zura scenes — so a prompt or model change can be judged by numbers instead
of vibes.

## Run

    ANTHROPIC_API_KEY=... bun run eval:extraction   # from packages/core

Needs Ollama (embeddings) + an Anthropic key (the shipping extractor calls the
real LLM). Prints per-run progress and then an aggregate scorecard with median
[min–max] per metric. Eyeball the diff vs the current baseline; on an accepted
improvement, copy the printed "Aggregate JSON" block into `baseline.json` and
commit. The eval never writes the baseline for you.

To run fewer iterations during development:

    EVAL_RUNS=3 ANTHROPIC_API_KEY=... bun run eval:extraction

## Files

- `fixtures/selection.txt` — curator-authored ordered scene-ID list (the corpus selection).
- `fixtures/scenes.jsonl` — the 24 selected scenes (real Zura prose), in processing order.
- `fixtures/golden.yaml` — hand-curated ground truth (the executable spec of "good").
- `CURATION.md` — the labeling principles behind golden.yaml (the prose spec).
- `baseline.json` — last-accepted aggregate scorecard (AggregateScorecard shape; see below).
- `score.ts` — pure, unit-tested scoring core (`bun test eval/score.test.ts`).
- `aggregate.ts` — aggregation helpers: `aggregateScorecards`, `median`, `MetricStats`, `AggregateScorecard`.
- `run-eval.ts` — orchestrator (runs `EVAL_RUNS` times, prints aggregate; reads only committed fixtures).
- `bootstrap.ts` — one-shot draft generator from the private Zura DB (reads `selection.txt`).

Corpus: 24 scenes selected for scene-shape / entity-type diversity (founding,
journey, social, crisis, combat, the anchor-network delve), with a contiguous
supersedes sub-sequence — the Caldren arc (scenes 23→35), which yields **2**
invalidated relations (his Holtfen title and location, both stripped at his
banishment). To grow breadth later, prefer adding scenes for coverage over
chasing a higher absolute score.

## Metrics

- **entity** P / R / F1 + **type accuracy** — set-matching of DB entities vs.
  golden, via normalized name/alias match with an embedding-similarity fallback.
- **relation** P / R / F1 (**endpoint-primary**) — matches on the resolved
  directed entity pair `(from → to)`, *not* the label. The extractor's label
  vocabulary is open-ended and unstable run-to-run, so exact-label matching
  measured noise; see CURATION.md / the design spec.
- **relation labelAccuracy** (secondary) — of the endpoint-pairs the extractor
  reproduced, the fraction it also labeled agreeably (synonym-aware).
- **dedup** — `1 − nearDuplicates / matched`; penalizes near-duplicate entities.
- **temporal** — tracks how often the extractor successfully produces an
  invalidated relation on a golden `invalidated` endpoint-pair. Reported as
  `passRate` (fraction of runs where at least one temporal relation was correct)
  and `meanCorrect` (average correct count per run across all runs).

## Non-determinism and aggregation

The extractor is called at temperature 0, but a single LLM run is one sample and
the model is **not** fully deterministic — across identical inputs we observe
entity F1 wobble ~0.05 and relation F1 / dedup wobble ~0.1 run-to-run.

To make the baseline more robust, `run-eval.ts` now runs `EVAL_RUNS` times
(default 5) and reports **median [min–max]** per metric, plus temporal
`passRate` and `meanCorrect`. The committed `baseline.json` is an
`AggregateScorecard` (shape: `{ runs, entity, relation, dedup, temporal }`
where each per-metric field contains `{ median, min, max }`, and `temporal`
contains `{ total, meanCorrect, passRate }`).

Treat single-run metric deltas **under ~0.1** (relation, dedup) as noise, not
signal. A real regression or improvement moves a metric's median well outside
that band across multiple runs.

## Current baseline (EVAL_RUNS=10, 2026-06-24)

```
entity precision  0.69  [0.62–0.77]
entity recall     0.74  [0.71–0.78]
entity F1         0.72  [0.67–0.77]
type accuracy     0.81  [0.76–0.90]
relation precision 0.31  [0.25–0.39]
relation recall   0.15  [0.10–0.26]
relation F1       0.20  [0.14–0.31]
relation labelAcc 0.39  [0.30–0.67]
dedup             0.60  [0.43–0.72]
temporal          passRate 0.50 (meanCorrect 1.00/2)
```

The temporal `passRate` of **0.50** (up from 0.20) reflects the Caldren
supersedes arc now landing in ~half of runs. The fix fed each existing entity's
**current relations** into the extractor context (`getCurrentOutgoingRelations`)
so the model can see a prior `LOCATED_IN`/`HOLDS_TITLE` state and reliably mark a
banishment as `supersedes`, instead of guessing the flag blind. The earlier
diagnosis — flaky *recall* of the establishing relation — was wrong: in
isolation the establishing relation and the banishment both emit reliably; the
gate was the `supersedes` boolean, which the extractor had no basis to set.

The remaining ~0.5 miss rate is irreducible LLM non-determinism (occasional
malformed-JSON scenes, residual `Holtfen`/`Holtfen Settlement` canonicalization
drift). Trade-off: the supersedes/name-reuse prompting raised temporal and
entity precision but drifted **relation precision (0.39→0.31)** and
**labelAccuracy (0.55→0.39)** down — the model now emits more
supersession/varied-label relations. Relation F1 stays within noise; relation
quality was explicitly out of scope for this pass.

## Accepting a new baseline

Run the eval, review the printed aggregate, and if the change is an improvement:

    # copy the "Aggregate JSON" block printed at the end of the eval into baseline.json
    git add packages/core/eval/baseline.json
    git commit -m "eval: accept new aggregate baseline"
