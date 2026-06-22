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
import { aggregateScorecards, type AggregateScorecard } from "./aggregate.js";
import type { SerializedScene } from "./scene-record.js";

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
  for (let i = 0; i < RUNS; i++) {
    console.log(`--- run ${i + 1}/${RUNS} ---`);
    const c = await runOnce(scenes, golden, extractor);
    console.log(
      `  entity F1 ${fmt(c.entity.f1)}  dedup ${fmt(c.dedup.score)}  temporal ${c.temporal.correct}/${c.temporal.total}`,
    );
    cards.push(c);
  }

  printAggregate(aggregateScorecards(cards));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
