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

## Current baseline (EVAL_RUNS=5, 2026-06-22)

```
entity precision  0.67  [0.63–0.71]
entity recall     0.78  [0.69–0.84]
entity F1         0.71  [0.66–0.77]
type accuracy     0.80  [0.73–0.83]
relation precision 0.39  [0.32–0.53]
relation recall   0.17  [0.13–0.33]
relation F1       0.22  [0.19–0.41]
relation labelAcc 0.55  [0.44–0.64]
dedup             0.63  [0.43–0.87]
temporal          passRate 0.20 (meanCorrect 0.40/2)
```

The temporal `passRate` of **0.20** reflects that the Caldren supersedes arc is
detected in roughly 1 of 5 runs — the `establishing` relation is flakily
extracted and the harness now measures this honestly rather than treating a
single-run binary as a gate.

## Accepting a new baseline

Run the eval, review the printed aggregate, and if the change is an improvement:

    # copy the "Aggregate JSON" block printed at the end of the eval into baseline.json
    git add packages/core/eval/baseline.json
    git commit -m "eval: accept new aggregate baseline"
