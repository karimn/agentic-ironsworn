# Extraction-Quality Pass — Addendum Plan (multi-run aggregation)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Why this addendum:** During execution of the base plan
(`2026-06-21-extraction-quality-pass.md`), Tasks 1–3 landed and are
reviewed-clean. Re-baseline (base-plan Task 4) was blocked by a finding: the
extractor is **non-deterministic at `temperature=0`** (proven — identical scene
+ identical context produced divergent output across 4 calls; Ollama embeddings
are deterministic and the extractor is correctly pinned to temp 0, so the source
is irreducible LLM API non-determinism). Single-run eval metrics swing widely
(dedup 0.35↔0.61) and temporal is a flaky binary gate (0/2 or 2/2; ~1 in 3 runs
hits 2/2). The user chose to handle this by **aggregating N runs in the
harness**. This addendum replaces base-plan Task 4.

**Goal:** Make the eval trustworthy under non-determinism by running it N times
and reporting aggregate statistics (median + min/max bands per metric, temporal
pass-rate), then record an aggregated baseline.

## Global Constraints

- Work in `packages/core/`. Run commands from `packages/core/`.
- The aggregation logic must be a PURE function in its own file
  (`eval/aggregate.ts`), unit-tested deterministically with hand-built
  scorecards — NO LLM, NO Ollama, NO DB in the aggregate unit test.
- Do NOT change `eval/score.ts`, `eval/fixtures/golden.yaml`, or
  `eval/fixtures/scenes.jsonl`.
- `Scorecard` type is imported from `./score.js`; its shape is
  `{ entity: { precision, recall, f1, typeAccuracy }, relation: { precision, recall, f1, labelAccuracy }, dedup: { score }, temporal: { correct, total } }`.
- The number of runs is read from `EVAL_RUNS` (default 5).
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r
  ```
- Bump `plugins/ironsworn/.claude-plugin/plugin.json` 0.31.0 → 0.32.0 once, in the final task.

---

### Task 1: Multi-run aggregation in the harness

Add a pure `aggregateScorecards` over N `Scorecard`s, unit-test it, then make
`run-eval.ts` loop N times and report the aggregate.

**Files:**
- Create: `packages/core/eval/aggregate.ts`
- Create: `packages/core/eval/aggregate.test.ts`
- Modify: `packages/core/eval/run-eval.ts`

**Interfaces:**
- Consumes: `Scorecard` from `./score.js`.
- Produces:
  - `median(nums: number[]): number`
  - `aggregateScorecards(cards: Scorecard[]): AggregateScorecard`
  - `AggregateScorecard` = `{ runs: number; entity: { precision: MetricStats; recall: MetricStats; f1: MetricStats; typeAccuracy: MetricStats }; relation: { precision: MetricStats; recall: MetricStats; f1: MetricStats; labelAccuracy: MetricStats }; dedup: { score: MetricStats }; temporal: { total: number; meanCorrect: number; passRate: number } }`
  - `MetricStats` = `{ median: number; min: number; max: number }`

- [ ] **Step 1: Write the failing aggregate test**

Create `packages/core/eval/aggregate.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { median, aggregateScorecards } from "./aggregate.js";
import type { Scorecard } from "./score.js";

function card(opts: {
  eP?: number; eR?: number; eF1?: number; eTA?: number;
  rP?: number; rR?: number; rF1?: number; rLA?: number;
  dedup?: number; tCorrect?: number; tTotal?: number;
}): Scorecard {
  return {
    entity: { precision: opts.eP ?? 0, recall: opts.eR ?? 0, f1: opts.eF1 ?? 0, typeAccuracy: opts.eTA ?? 0 },
    relation: { precision: opts.rP ?? 0, recall: opts.rR ?? 0, f1: opts.rF1 ?? 0, labelAccuracy: opts.rLA ?? 0 },
    dedup: { score: opts.dedup ?? 0 },
    temporal: { correct: opts.tCorrect ?? 0, total: opts.tTotal ?? 2 },
  };
}

describe("median", () => {
  it("returns the middle of an odd-length sorted set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middles of an even-length set", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("returns 0 for an empty set", () => {
    expect(median([])).toBe(0);
  });
});

describe("aggregateScorecards", () => {
  it("computes median/min/max per metric and temporal passRate/meanCorrect", () => {
    const cards = [
      card({ dedup: 0.35, eP: 0.6, tCorrect: 0, tTotal: 2 }),
      card({ dedup: 0.61, eP: 0.7, tCorrect: 2, tTotal: 2 }),
      card({ dedup: 0.5, eP: 0.65, tCorrect: 0, tTotal: 2 }),
    ];
    const agg = aggregateScorecards(cards);
    expect(agg.runs).toBe(3);
    expect(agg.dedup.score.median).toBeCloseTo(0.5, 10);
    expect(agg.dedup.score.min).toBeCloseTo(0.35, 10);
    expect(agg.dedup.score.max).toBeCloseTo(0.61, 10);
    expect(agg.entity.precision.median).toBeCloseTo(0.65, 10);
    expect(agg.temporal.total).toBe(2);
    // 1 of 3 runs reached correct===total
    expect(agg.temporal.passRate).toBeCloseTo(1 / 3, 10);
    // meanCorrect = (0 + 2 + 0) / 3
    expect(agg.temporal.meanCorrect).toBeCloseTo(2 / 3, 10);
  });

  it("throws on an empty input", () => {
    expect(() => aggregateScorecards([])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test eval/aggregate.test.ts`
Expected: FAIL — `Cannot find module './aggregate.js'` (file not yet created).

- [ ] **Step 3: Implement `aggregate.ts`**

Create `packages/core/eval/aggregate.ts`:

```ts
// Pure aggregation over repeated eval runs. The extractor is non-deterministic
// at temperature=0 (irreducible LLM API non-determinism), so a single run is
// not a reliable measure; we run N times and summarize. No DB/LLM/Ollama here —
// this is a pure function over Scorecards so it is unit-testable.
import type { Scorecard } from "./score.js";

export interface MetricStats {
  median: number;
  min: number;
  max: number;
}

export interface AggregateScorecard {
  runs: number;
  entity: { precision: MetricStats; recall: MetricStats; f1: MetricStats; typeAccuracy: MetricStats };
  relation: { precision: MetricStats; recall: MetricStats; f1: MetricStats; labelAccuracy: MetricStats };
  dedup: { score: MetricStats };
  // temporal is effectively binary per run (0/total or total/total); report the
  // fraction of runs that fully passed (passRate) and the mean correct count.
  temporal: { total: number; meanCorrect: number; passRate: number };
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function stats(nums: number[]): MetricStats {
  return { median: median(nums), min: Math.min(...nums), max: Math.max(...nums) };
}

export function aggregateScorecards(cards: Scorecard[]): AggregateScorecard {
  if (cards.length === 0) {
    throw new Error("aggregateScorecards: need at least one scorecard");
  }
  const pick = (f: (c: Scorecard) => number): MetricStats => stats(cards.map(f));
  const total = cards[0]!.temporal.total;
  const passes = cards.filter((c) => c.temporal.correct === c.temporal.total).length;
  const meanCorrect = cards.reduce((acc, c) => acc + c.temporal.correct, 0) / cards.length;
  return {
    runs: cards.length,
    entity: {
      precision: pick((c) => c.entity.precision),
      recall: pick((c) => c.entity.recall),
      f1: pick((c) => c.entity.f1),
      typeAccuracy: pick((c) => c.entity.typeAccuracy),
    },
    relation: {
      precision: pick((c) => c.relation.precision),
      recall: pick((c) => c.relation.recall),
      f1: pick((c) => c.relation.f1),
      labelAccuracy: pick((c) => c.relation.labelAccuracy),
    },
    dedup: { score: pick((c) => c.dedup.score) },
    temporal: { total, meanCorrect, passRate: passes / cards.length },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test eval/aggregate.test.ts`
Expected: PASS (6 assertions across the two describes).

- [ ] **Step 5: Refactor `run-eval.ts` to loop N runs and aggregate**

In `packages/core/eval/run-eval.ts`:

(a) Add the import near the other eval imports (after the `./score.js` import):

```ts
import { aggregateScorecards, type AggregateScorecard } from "./aggregate.js";
```

(b) Extract the single-run body into a helper. Replace the block from
`const dir = await mkdtemp(...)` through `const scorecard = await scoreExtraction(...)`
(the per-run setup + scoring, currently lines ~86-117 inside `main`) with a call,
and define this `runOnce` function above `main`:

```ts
async function runOnce(
  scenes: SerializedScene[],
  golden: GoldenSet,
  extractor: ReturnType<typeof _makeDefaultExtractor>,
): Promise<Scorecard> {
  const dir = await mkdtemp(join(tmpdir(), "eval-run-"));
  let failed = 0;
  for (const sc of scenes) {
    const id = await recordScene(dir, sc.text, sc.kind, undefined, sc.beats);
    try {
      await extractLoreFromScene(dir, id, { extractor });
    } catch (e) {
      failed++;
      console.warn(`Extraction failed for scene ${id}: ${(e as Error).message}`);
    }
  }
  if (failed > 0) console.warn(`${failed} of ${scenes.length} scenes failed extraction.`);

  const { entities, relations } = await exportLore(dir);
  const idToCanon = new Map(entities.map((e) => [e.id, e.canonical]));
  const actual: ActualState = {
    entities: entities.map((e) => ({ canonical: e.canonical, type: e.type, aliases: e.aliases })),
    relations: relations.map((r) => ({
      from: idToCanon.get(r.from_id) ?? r.from_id,
      to: idToCanon.get(r.to_id) ?? r.to_id,
      label: r.relation,
      invalidated: r.invalid_at !== null,
    })),
  };
  return scoreExtraction(actual, golden, getWorldEmbedding);
}
```

(c) Add a printer for the aggregate (place beside `printScorecard`):

```ts
function band(s: { median: number; min: number; max: number }): string {
  return `${fmt(s.median)}  [${fmt(s.min)}–${fmt(s.max)}]`;
}

function printAggregate(a: AggregateScorecard): void {
  console.log(`Extraction eval — aggregate over ${a.runs} runs (median [min–max])`);
  console.log(`  entity precision  ${band(a.entity.precision)}`);
  console.log(`  entity recall     ${band(a.entity.recall)}`);
  console.log(`  entity F1         ${band(a.entity.f1)}`);
  console.log(`  type accuracy     ${band(a.entity.typeAccuracy)}`);
  console.log(`  relation precision ${band(a.relation.precision)}`);
  console.log(`  relation recall   ${band(a.relation.recall)}`);
  console.log(`  relation F1       ${band(a.relation.f1)}`);
  console.log(`  relation labelAcc ${band(a.relation.labelAccuracy)}`);
  console.log(`  dedup             ${band(a.dedup.score)}`);
  console.log(`  temporal          passRate ${fmt(a.temporal.passRate)} (meanCorrect ${fmt(a.temporal.meanCorrect)}/${a.temporal.total})`);
  console.log("");
  console.log("Aggregate JSON (copy into baseline.json to accept):");
  console.log(JSON.stringify(a, null, 2));
}
```

(d) Rewrite the tail of `main` (after fixtures are loaded into `scenes`/`golden`)
to build the extractor once, loop `RUNS` times, print each run compactly, then
aggregate and print. Replace the old single-run scoring + `printScorecard(scorecard, base)`
section with:

```ts
  const RUNS = Number(process.env["EVAL_RUNS"] ?? "5");
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as unknown as AnthropicLike,
    { temperature: 0 },
  );

  const cards: Scorecard[] = [];
  for (let i = 0; i < RUNS; i++) {
    console.log(`--- run ${i + 1}/${RUNS} ---`);
    const c = await runOnce(scenes, golden, extractor);
    console.log(
      `  entity F1 ${fmt(c.entity.f1)}  dedup ${fmt(c.dedup.score)}  temporal ${c.temporal.correct}/${c.temporal.total}`,
    );
    cards.push(c);
  }

  printAggregate(aggregateScorecards(cards));
```

Remove the now-unused single-run `dir`/`extractor`/`scorecard`/`base`/`printScorecard`
call and the `BASELINE` read if it becomes unused (keep `printScorecard` itself only
if still referenced — if not, delete it to keep `tsc` clean of unused symbols).

- [ ] **Step 6: Typecheck + run the aggregate unit test (no LLM needed)**

Run: `cd packages/core && bun run tsc --noEmit && bun test eval/aggregate.test.ts`
Expected: tsc clean (no unused-symbol errors); aggregate tests PASS. Do NOT run
the full `eval:extraction` here — that is Task 2 (costs LLM calls).

- [ ] **Step 7: Commit**

```bash
git add packages/core/eval/aggregate.ts packages/core/eval/aggregate.test.ts packages/core/eval/run-eval.ts
git commit -m "feat(eval): aggregate N runs to handle extractor non-determinism

The extractor is non-deterministic at temperature=0 (irreducible LLM API
non-determinism), so single-run metrics swing and temporal is a flaky
binary gate. run-eval now runs EVAL_RUNS (default 5) times and reports
median [min-max] per metric plus a temporal pass-rate. Aggregation is a
pure, unit-tested function.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

---

### Task 2: Aggregated re-baseline, README, version bump

Run the aggregated eval, record the aggregate baseline, update the README, bump
the plugin version.

**Files:**
- Modify: `packages/core/eval/baseline.json` (now an `AggregateScorecard`)
- Modify: `packages/core/eval/README.md` (document aggregation + new baseline)
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json` (0.31.0 → 0.32.0)

**Interfaces:**
- Consumes: `eval:extraction` (`bun run eval/run-eval.ts`), now aggregating. Needs
  `ANTHROPIC_API_KEY` + Ollama.

- [ ] **Step 1: Full suite green first**

Run: `cd packages/core && bun test`
Expected: all tests PASS (includes the new `aggregate.test.ts`). Record the count.

- [ ] **Step 2: Run the aggregated eval**

Run: `cd packages/core && EVAL_RUNS=5 ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" bun run eval:extraction`
Expected: 5 runs (~10–15 min total), then an aggregate block with median [min–max]
per metric and a `temporal passRate (meanCorrect/total)` line, plus the aggregate
JSON to copy into baseline.json.

- [ ] **Step 3: Record the aggregate baseline**

Copy the printed "Aggregate JSON" verbatim into `packages/core/eval/baseline.json`
(overwriting the old single-run shape). Sanity-check it is the new shape
(`runs`, per-metric `{median,min,max}`, `temporal {total, meanCorrect, passRate}`).

- [ ] **Step 4: Update the README**

In `packages/core/eval/README.md`: replace any old single-run baseline numbers and
the determinism caveat with a short section explaining (a) the extractor is
non-deterministic at temp 0, (b) the eval runs `EVAL_RUNS` (default 5) times and
reports median [min–max] + temporal pass-rate, (c) the committed `baseline.json`
is an aggregate, and (d) how to accept a new baseline (copy the printed Aggregate
JSON). State the observed temporal `passRate` from Step 2 as the current figure.

- [ ] **Step 5: Bump the plugin version**

In `plugins/ironsworn/.claude-plugin/plugin.json`, bump `version` 0.31.0 → 0.32.0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/eval/baseline.json packages/core/eval/README.md plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "feat(eval): aggregated baseline (EVAL_RUNS=5); bump v0.32.0

Record the multi-run aggregate as the new reference baseline and document
the non-determinism + aggregation in the README. Temporal is now tracked
as a pass-rate over runs rather than a single-run binary gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

## Plan Self-Review

- **Coverage:** aggregation function + unit test (Task 1, Steps 1–4); harness
  loop (Task 1, Step 5); aggregated re-baseline + README + version (Task 2). The
  user's decision (aggregate N runs) is fully realized.
- **Type consistency:** `AggregateScorecard`/`MetricStats`/`median`/
  `aggregateScorecards` are defined in `aggregate.ts` (Task 1, Step 3) and
  consumed by the test (Step 1) and `run-eval.ts` (Step 5) with matching shapes.
  `Scorecard` is imported from `./score.js`, unchanged.
- **Placeholder scan:** every code step carries complete code; commands have
  expected output. The only run-time-determined value is the printed aggregate
  JSON (Task 2, Step 3), which is inherently produced at run time.
- **Non-determinism caveat:** the aggregate unit test (Task 1) is fully
  deterministic (hand-built scorecards); only Task 2 Step 2 invokes the LLM.
