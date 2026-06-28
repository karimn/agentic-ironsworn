// Reproducible extraction eval. Reads committed fixtures, runs the shipping
// pipeline at temperature 0 into a throwaway DB, scores vs golden.yaml, and
// reports aggregate stats over EVAL_RUNS runs (default 5) to handle
// extractor non-determinism.
//
//   ANTHROPIC_API_KEY=... bun run eval:extraction
//   EVAL_RUNS=3 ANTHROPIC_API_KEY=... bun run eval:extraction
//
// Modes (EVAL_MODE):
//   primary  (default) — extraction reconstructs the whole graph from prose.
//                        The legacy quality lever; relation recall caps here.
//   backfill           — seed the graph with the golden canon (simulating
//                        point-of-entry recording), then run extraction as
//                        backfill on top and report whether it FRAGMENTED a
//                        recorded entity. This matches the v1 reality where
//                        record_beat is primary and extraction is the fallback.
//                          ANTHROPIC_API_KEY=... bun run eval:backfill
//
// Accepting a change: copy the printed aggregate JSON into baseline.json and commit.

import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicLike } from "../src/rag/communities.js";
import { recordScene } from "../src/rag/scenes.js";
import { recordBeatCanon, type BeatEntity, type BeatRelation } from "../src/rag/beat-canon.js";
import { extractLoreFromScene, _makeDefaultExtractor } from "../src/rag/extraction.js";
import { exportLore, type LoreType } from "../src/rag/lore.js";
import { backfillGuardFromGraph, type BackfillGuardReport } from "./backfill.js";
import { getWorldEmbedding } from "../src/rag/world-db.js";
import { scoreExtraction, matchEntities, type ActualState, type GoldenSet, type Scorecard } from "./score.js";
import { aggregateScorecards, type AggregateScorecard, type MetricStats } from "./aggregate.js";
import {
  classifyRelationDrops,
  aggregateRelationDrops,
  entityRecallByType,
  type EmittedRelation,
  type RelationDropBreakdown,
  type TypeRecall,
} from "./diagnostics.js";
import type { SerializedScene } from "./scene-record.js";

// extractLoreFromScene's default when no confidenceThreshold is passed (and the
// eval passes none). The drop classifier must use the same value as production.
const CONF_THRESHOLD = 0.6;

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(here, "fixtures");

async function ollamaReachable(): Promise<boolean> {
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// "primary" = extraction reconstructs the whole graph from prose (the legacy
// quality lever). "backfill" = the v1 reality: seed the graph with recorded
// canon (point-of-entry recording), then run extraction as backfill on top and
// measure whether it fragments or pollutes the recorded graph.
type EvalMode = "primary" | "backfill";

// Seed the graph with the golden canon as if the GM had recorded it on the beat
// (recordBeatCanon). Returns the seeded canonical names for the backfill guard.
async function seedRecordedCanon(dir: string, golden: GoldenSet): Promise<string[]> {
  const seedSceneId = await recordScene(dir, "Seed scene for point-of-entry canon.", "scene");
  const entities: BeatEntity[] = golden.entities.map((e) => ({
    canonical: e.canonical,
    type: e.type as LoreType,
    summary: `${e.canonical} (recorded canon)`,
    aliases: e.aliases,
  }));
  // Seed only currently-valid relations — the "as of point of entry" truth.
  const relations: BeatRelation[] = golden.relations
    .filter((r) => !r.invalidated)
    .map((r) => ({ from: r.from, to: r.to, label: r.label }));
  await recordBeatCanon(dir, seedSceneId, entities, relations);
  return golden.entities.map((e) => e.canonical);
}

async function runOnce(
  scenes: SerializedScene[],
  golden: GoldenSet,
  extractor: ReturnType<typeof _makeDefaultExtractor>,
  mode: EvalMode = "primary",
): Promise<{
  card: Scorecard;
  drops: RelationDropBreakdown;
  typeRecall: TypeRecall[];
  missedGolden: string[];
  nearDuplicates: string[];
  falsePositives: string[];
  backfill?: BackfillGuardReport;
}> {
  const dir = await mkdtemp(join(tmpdir(), "eval-run-"));

  // Backfill mode: lay down the recorded canon before extraction runs.
  const seedNames = mode === "backfill" ? await seedRecordedCanon(dir, golden) : [];

  // Capture every relation the extractor EMITTED (raw, pre-filter) so we can
  // classify what production then dropped. Wrap per-run for a fresh tally.
  const emitted: EmittedRelation[] = [];
  const capturing: typeof extractor = async (text, existing) => {
    const result = await extractor(text, existing);
    for (const r of result.relations) {
      emitted.push({ from: r.from, to: r.to, relation: r.relation, confidence: r.confidence });
    }
    return result;
  };

  let failed = 0;
  for (const sc of scenes) {
    const id = await recordScene(dir, sc.text, sc.kind, undefined, sc.beats);
    try {
      await extractLoreFromScene(dir, id, { extractor: capturing });
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

  // Persisted-name set mirrors getLore's resolution surface (canonical + aliases).
  const persistedNames = entities.flatMap((e) => [e.canonical, ...e.aliases]);
  const drops = classifyRelationDrops(emitted, persistedNames, CONF_THRESHOLD);

  // Which golden entities were missed, and per-type recall — relations depend on
  // abstract entity types (thread/event/concept/truth) being extracted at all.
  const matching = await matchEntities(actual.entities, golden.entities, getWorldEmbedding);
  const typeRecall = entityRecallByType(golden.entities, matching.unmatchedGolden);
  const missedGolden = matching.unmatchedGolden.map((g) => `${g.canonical} (${g.type})`);
  // Near-duplicate actuals (a second extracted entity that collapsed onto an
  // already-matched golden) — these are what tank the dedup score; seeing the
  // names tells us whether the fix is lexical (reorderings) or semantic.
  const nearDuplicates = matching.nearDuplicates.map((e) => `${e.canonical} (${e.type})`);
  // False positives: extracted entities matching NO golden. The precision metric
  // counts these as wrong — but golden is a curated subset, so some may be
  // legitimate-but-uncurated. Dumping them tells us whether precision is fair.
  const falsePositives = matching.falsePositives.map((e) => `${e.canonical} (${e.type})`);

  const card = await scoreExtraction(actual, golden, getWorldEmbedding);
  // Backfill guard: did extraction fragment a recorded entity or pollute the graph?
  const backfill =
    mode === "backfill" ? backfillGuardFromGraph(seedNames, actual.entities) : undefined;
  return { card, drops, typeRecall, missedGolden, nearDuplicates, falsePositives, backfill };
}

function band(s: MetricStats): string {
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

// Diagnose where emitted relations are lost. Recall failures split into "never
// emitted" (prompt problem, visible in the scorer's relation recall) vs.
// "emitted then dropped" (plumbing problem, shown here). Totals are summed
// across all runs.
function printRelationDrops(d: RelationDropBreakdown, runs: number): void {
  const pct = (n: number): string =>
    d.emitted === 0 ? "  0%" : `${Math.round((100 * n) / d.emitted)}%`.padStart(4);
  console.log("");
  console.log(`Relation-drop diagnostics (summed over ${runs} runs)`);
  console.log(`  emitted by extractor       ${d.emitted}`);
  console.log(`  survived (would link)      ${d.survived}  (${pct(d.survived)})`);
  console.log(`  dropped: low confidence    ${d.droppedLowConfidence}  (${pct(d.droppedLowConfidence)})`);
  console.log(`  dropped: endpoint unresolved ${d.droppedEndpointUnresolved}  (${pct(d.droppedEndpointUnresolved)})`);
  if (d.unresolvedEndpoints.length > 0) {
    console.log("  top unresolved endpoint names (extractor named a relation endpoint");
    console.log("  that never became an entity — name-agreement loss):");
    for (const e of d.unresolvedEndpoints.slice(0, 15)) {
      console.log(`    ${String(e.count).padStart(3)}  ${e.name}`);
    }
  }
}

// Per-type entity recall (worst first) + the specific golden entities missed in
// the final run. Relations connect abstract entity types, so a type the
// extractor under-produces caps the relation recall built on it.
function printEntityRecallByType(rows: TypeRecall[], missed: string[]): void {
  console.log("");
  console.log("Entity recall by golden type (final run, worst first)");
  for (const r of rows) {
    console.log(`  ${r.type.padEnd(9)} ${fmt(r.recall)}  (${r.matched}/${r.total})`);
  }
  if (missed.length > 0) {
    console.log(`  missed golden entities (${missed.length}):`);
    for (const m of missed) console.log(`    ${m}`);
  }
}

// Backfill guard (final run). The headline is `fragmentedSeeds`: clusters where
// extraction split a recorded entity into a name variant — the regression this
// whole pivot exists to prevent. Zero is the goal; any cluster is a backfill
// fragmentation bug. netNewEntities are nodes extraction added beyond the seed
// (genuinely-missed canon recovered, or false positives — inspect the names).
function printBackfillGuard(b: BackfillGuardReport): void {
  console.log("");
  console.log("Backfill guard (final run) — extraction run on a recorded-canon graph");
  console.log(`  seeded (recorded canon)    ${b.seeded}`);
  console.log(`  final entities             ${b.finalEntities}`);
  console.log(`  net new (added by backfill) ${b.netNewEntities}`);
  console.log(`  fragmented seeds           ${b.fragmentedSeeds.length}  (target: 0)`);
  for (const c of b.fragmentedSeeds) {
    console.log(`    [${c.type}] ${c.names.join("  |  ")}`);
  }
  if (b.fragmentedSeeds.length === 0 && b.clusters.length > 0) {
    console.log(`  (${b.clusters.length} backfill-internal cluster(s) among new entities — not seed corruption)`);
  }
}

async function main(): Promise<void> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Eval needs ANTHROPIC_API_KEY (the shipping extractor calls the real LLM).");
    process.exit(2);
  }
  if (!(await ollamaReachable())) {
    console.error("Eval needs Ollama reachable (embeddings). Set OLLAMA_BASE_URL or start Ollama.");
    process.exit(2);
  }
  if (!existsSync(join(FIXTURES, "scenes.jsonl")) || !existsSync(join(FIXTURES, "golden.yaml"))) {
    console.error("Missing fixtures. Run eval/bootstrap.ts and curate golden.yaml first.");
    process.exit(2);
  }

  const scenesRaw = await readFile(join(FIXTURES, "scenes.jsonl"), "utf8");
  const scenes: SerializedScene[] = scenesRaw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SerializedScene);
  const golden = parse(await readFile(join(FIXTURES, "golden.yaml"), "utf8")) as GoldenSet;

  const RUNS = Number(process.env["EVAL_RUNS"] ?? "5");
  const mode: EvalMode = process.env["EVAL_MODE"] === "backfill" ? "backfill" : "primary";
  console.log(
    mode === "backfill"
      ? "Mode: BACKFILL — seed recorded canon, then measure extraction as backfill (v1 #3)."
      : "Mode: PRIMARY — extraction reconstructs the graph from prose (legacy lever).",
  );
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as unknown as AnthropicLike,
    { temperature: 0 },
  );

  const cards: Scorecard[] = [];
  const drops: RelationDropBreakdown[] = [];
  let lastTypeRecall: TypeRecall[] = [];
  let lastMissed: string[] = [];
  let lastNearDup: string[] = [];
  let lastFalsePos: string[] = [];
  let lastBackfill: BackfillGuardReport | undefined;
  for (let i = 0; i < RUNS; i++) {
    console.log(`--- run ${i + 1}/${RUNS} ---`);
    const { card, drops: d, typeRecall, missedGolden, nearDuplicates, falsePositives, backfill } = await runOnce(scenes, golden, extractor, mode);
    console.log(
      `  entity F1 ${fmt(card.entity.f1)}  recall ${fmt(card.entity.recall)}  dedup ${fmt(card.dedup.score)}  temporal ${card.temporal.correct}/${card.temporal.total}`,
    );
    console.log(
      `  relations: ${d.emitted} emitted → ${d.survived} survived, ${d.droppedLowConfidence} low-conf, ${d.droppedEndpointUnresolved} unresolved`,
    );
    if (backfill) {
      console.log(
        `  backfill: ${backfill.seeded} seeded → ${backfill.finalEntities} final (+${backfill.netNewEntities}), ${backfill.fragmentedSeeds.length} fragmented seed(s)`,
      );
    }
    cards.push(card);
    drops.push(d);
    lastTypeRecall = typeRecall;
    lastMissed = missedGolden;
    lastNearDup = nearDuplicates;
    lastFalsePos = falsePositives;
    lastBackfill = backfill;
  }

  printAggregate(aggregateScorecards(cards));
  printRelationDrops(aggregateRelationDrops(drops), RUNS);
  printEntityRecallByType(lastTypeRecall, lastMissed);
  if (lastBackfill) printBackfillGuard(lastBackfill);
  if (lastNearDup.length > 0) {
    console.log("");
    console.log(`Near-duplicate entities (final run, ${lastNearDup.length}) — collapsed onto`);
    console.log("an already-matched golden entity; these tank the dedup score:");
    for (const n of lastNearDup) console.log(`    ${n}`);
  }
  if (lastFalsePos.length > 0) {
    console.log("");
    console.log(`False-positive entities (final run, ${lastFalsePos.length}) — matched NO golden.`);
    console.log("Audit: are these genuine junk, or legitimate-but-uncurated canon?");
    for (const n of lastFalsePos) console.log(`    ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
