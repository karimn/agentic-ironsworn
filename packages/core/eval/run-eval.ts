// Reproducible extraction eval. Reads committed fixtures, runs the shipping
// pipeline at temperature 0 into a throwaway DB, scores vs golden.yaml, and
// reports aggregate stats over EVAL_RUNS runs (default 5) to handle
// extractor non-determinism.
//
//   ANTHROPIC_API_KEY=... bun run eval:extraction
//   EVAL_RUNS=3 ANTHROPIC_API_KEY=... bun run eval:extraction
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
import { extractLoreFromScene, _makeDefaultExtractor } from "../src/rag/extraction.js";
import { exportLore } from "../src/rag/lore.js";
import { getWorldEmbedding } from "../src/rag/world-db.js";
import { scoreExtraction, type ActualState, type GoldenSet, type Scorecard } from "./score.js";
import { aggregateScorecards, type AggregateScorecard, type MetricStats } from "./aggregate.js";
import {
  classifyRelationDrops,
  aggregateRelationDrops,
  type EmittedRelation,
  type RelationDropBreakdown,
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

async function runOnce(
  scenes: SerializedScene[],
  golden: GoldenSet,
  extractor: ReturnType<typeof _makeDefaultExtractor>,
): Promise<{ card: Scorecard; drops: RelationDropBreakdown }> {
  const dir = await mkdtemp(join(tmpdir(), "eval-run-"));

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

  const card = await scoreExtraction(actual, golden, getWorldEmbedding);
  return { card, drops };
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
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as unknown as AnthropicLike,
    { temperature: 0 },
  );

  const cards: Scorecard[] = [];
  const drops: RelationDropBreakdown[] = [];
  for (let i = 0; i < RUNS; i++) {
    console.log(`--- run ${i + 1}/${RUNS} ---`);
    const { card, drops: d } = await runOnce(scenes, golden, extractor);
    console.log(
      `  entity F1 ${fmt(card.entity.f1)}  dedup ${fmt(card.dedup.score)}  temporal ${card.temporal.correct}/${card.temporal.total}`,
    );
    console.log(
      `  relations: ${d.emitted} emitted → ${d.survived} survived, ${d.droppedLowConfidence} low-conf, ${d.droppedEndpointUnresolved} unresolved`,
    );
    cards.push(card);
    drops.push(d);
  }

  printAggregate(aggregateScorecards(cards));
  printRelationDrops(aggregateRelationDrops(drops), RUNS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
