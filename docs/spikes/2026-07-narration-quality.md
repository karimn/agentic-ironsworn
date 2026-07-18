# Narration-Quality Spike — July 2026

**Status:** Complete — recommendation below
**Date:** 2026-07-18
**Issue:** #200 (FW5, fiction-workflow track, umbrella #201)
**Decision:** **Partial yes.** Automate the consistency *floor* by reusing
existing contradiction-detection machinery as a regression check; do **not**
build an automated specificity/continuity harness. Rely on a lightweight
rubric + human spot-check for those instead.

---

## Problem recap

The eval harness (`packages/core/eval/`) measures **capture**: does the
knowledge graph faithfully reflect what happened in play (entity/relation
P/R/F1, dedup, temporal correctness against a golden fixture set)? It has a
crisp ground truth — `fixtures/golden.yaml` — because extraction is a
structured-output task with a checkable answer.

There is no equivalent for the **use** direction: does grounding (`recall`,
the GM's mandatory pre-narration dossier call — item #6 in the v1 priority
list, `rag/recall.ts`) actually make narration *better*, or only keep it from
contradicting itself? #200 asks whether that's measurable at a cost worth
paying, scoped explicitly as a research spike that must not block v1.

## What "narration quality" would need to measure

The issue proposes three axes, scored with vs. without the grounding dossier
in context:

1. **Canon consistency** (the floor) — does narration contradict recorded
   facts?
2. **Specificity / groundedness** — does it use real recorded detail (named
   NPCs, established places, prior events) vs. generic invention?
3. **Continuity** — does it honor temporal truth (no dead NPCs walking, open
   threads respected)?

## Why the three axes are not one problem

Axis 1 is a **factual check**: canon is already represented as structured
entities/relations with an `invalid_at` temporal filter (`rag/lore.ts`), and
the system already has a live, tested contradiction checker —
`checkEntityContradiction` / `checkRelationContradiction`
(`packages/core/src/rag/contradictions.ts`) — that compares a new claim
against existing canon and flags conflicting summaries or relations. Checking
whether a narrated scene contradicts canon is structurally the same problem
as checking whether a *write* contradicts canon; the only new step is running
the narrated prose back through extraction to get candidate
entities/relations to check. This is cheap to build because none of the hard
parts are new.

Axes 2 and 3 are **aesthetic/graded judgments**: "uses real recorded detail"
and "honors continuity" require an LLM-as-judge (or a human) to read prose
and rate it on a scale, not a set-comparison against a fixture. The
extraction eval's own experience is the cautionary data point here: even
*structured* output (discrete entities/relations, temperature 0) wobbles
~0.05–0.1 F1 run-to-run from LLM non-determinism, and the harness needed 5–10
replicates plus median-[min–max] reporting to get a signal worth trusting
(`eval/README.md`, "Non-determinism and aggregation"). Free-form prose judged
by another free-form LLM call is a strictly noisier instrument on both ends
(generation *and* judging vary), so the replicate count — and API cost —
needed to separate signal from noise would be substantially higher, for a
metric whose target value is inherently fuzzier ("more specific" has no
golden answer the way "this entity exists" does).

There's also a construct-validity problem specific to the proposed A/B: item
#6 already turned grounding from "a prompt convention" into "a hard tool-use
pattern" — `recall` is supposed to be called before every narration, and
direct entity reads append a grounding reminder nudging the agent back to it
when it's skipped. An eval that runs narration *without* the dossier isn't
measuring a real deployment condition the GM should ever be in; it's testing
a state the rest of v1 was built to prevent. The more meaningful ablation
would be dossier **quality** (e.g., current `recall` vs. a truncated/no-scenes
variant) rather than dossier presence/absence — which is a narrower, later
question than what #200 scoped.

## Recommendation

**Build now:** a **canon-consistency regression check**, not a new harness.
Add a scorer that takes narrated output for a fixture scene, extracts
candidate entities/relations from it (reusing the existing extractor), and
runs them through `checkEntityContradiction` / `checkRelationContradiction`
against the golden canon already loaded for that scene in
`eval/fixtures/golden.yaml`. Report a pass rate the same way `temporal`
already is in `AggregateScorecard` (`eval/aggregate.ts`) — this slots into
the existing eval orchestration (`run-eval.ts`) instead of standing up new
infrastructure, and it directly answers the "floor" half of #200's rubric
with a metric that has a real ground truth.

**Don't build:** an automated specificity/continuity harness with LLM-as-judge
scoring. The cost (replicate count for a noisy judge on a noisy generator,
new fixture design for "what specific detail *should* appear here", ongoing
rubric-drift maintenance) is high and the payoff is a metric nobody has asked
to gate a merge on. This matches the issue's own framing — "the deepest gap
and also the hardest to make rigorous."

**Rely on instead:** a short, human-facing rubric checklist (the three axes
above, 1–5 each) for the GM's own author/tester to apply during occasional
play spot-checks — not tooling, just a doc under
`docs/design/` or the skill files, so "does this feel grounded" has a
consistent shape when a human is the one judging. Revisit automation if
real play surfaces a recurring failure mode specific enough to write a
fixture for (the same way the Caldren→Lona supersedes case came out of an
actual observed failure, not an abstract worry).

## Acceptance criteria (from #200)

- [x] Spike doc: is narration quality measurable in a way that's worth the
      cost? — **Partially.** Canon consistency (the floor) is; specificity
      and continuity, as graded aesthetic judgments, are not worth automating
      yet.
- [x] If yes: proposed rubric + method — canon-consistency pass rate via
      `checkEntityContradiction`/`checkRelationContradiction` reused as a
      scorer against `eval/fixtures/golden.yaml`, aggregated like `temporal`
      in `AggregateScorecard`.
- [x] If no (for specificity/continuity): rely on human play feedback via a
      lightweight 1–5 rubric checklist per session, not automated scoring —
      because aesthetic judgment resists a fixed yardstick at a cost worth
      paying today, and no observed failure mode yet justifies the fixture
      design and replicate cost an LLM-judge harness would need.

## Non-blocking status

This is a scoping spike per #200's own framing ("Scope as a research spike,
don't block v1 on it"). No harness code changes ship with this doc. The
canon-consistency check above is a well-scoped follow-up, not a v1
requirement — filing it as a fast-follow is left to the umbrella (#201)
maintainer's discretion.
