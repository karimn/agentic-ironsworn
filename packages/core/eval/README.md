# Extraction evaluation harness

Scores the full lore-extraction pipeline on a fixed, diversity-stratified set of
real Zura scenes — so a prompt or model change can be judged by numbers instead
of vibes.

## Run

    ANTHROPIC_API_KEY=... bun run eval:extraction   # from packages/core

Needs Ollama (embeddings) + an Anthropic key (the shipping extractor calls the
real LLM). Prints a scorecard and the per-metric delta vs `baseline.json`. Eyeball
the diff; on an accepted improvement, copy the printed scorecard JSON into
`baseline.json` and commit. The eval never writes the baseline for you.

## Files

- `fixtures/selection.txt` — curator-authored ordered scene-ID list (the corpus selection).
- `fixtures/scenes.jsonl` — the 24 selected scenes (real Zura prose), in processing order.
- `fixtures/golden.yaml` — hand-curated ground truth (the executable spec of "good").
- `CURATION.md` — the labeling principles behind golden.yaml (the prose spec).
- `baseline.json` — last-accepted scorecard.
- `score.ts` — pure, unit-tested scoring core (`bun test eval/score.test.ts`).
- `run-eval.ts` — orchestrator (reproducible; reads only committed fixtures).
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
- **temporal** — `correct / total` over golden relations marked `invalidated`;
  credited when the extractor produced an invalidated relation on the same
  endpoint-pair.

## Reading the scorecard (determinism caveat)

The extractor is called at temperature 0, but a single run is one sample and the
LLM is **not** fully deterministic — across identical inputs we have observed
entity F1 wobble ~0.05 and relation F1 / dedup wobble ~0.1 run-to-run. So:

- Treat metric deltas **under ~0.1** (relation, dedup) as noise, not signal.
- A real regression or improvement moves a metric well outside that band.
- Multi-sample averaging to shrink the noise is intentionally out of scope for v1.

The current baseline records, among other things, `temporal 0/2`: the shipping
extractor detects **no** supersedes (it never invalidates a superseded fact) and
does not even emit a `Caldren` entity for the arc. That is a known weakness this
harness exists to make visible — a future extraction change that fixes it should
show as a clear positive delta here.
