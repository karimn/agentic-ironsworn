// Reproducible extraction eval. Reads committed fixtures, runs the shipping
// pipeline at temperature 0 into a throwaway DB, scores vs golden.yaml, and
// diffs baseline.json.
//
//   ANTHROPIC_API_KEY=... bun run eval:extraction
//
// Accepting a change: copy the printed scorecard into baseline.json and commit.

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
import type { SerializedScene } from "./scene-record.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(here, "fixtures");
const BASELINE = join(here, "baseline.json");

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

function printScorecard(s: Scorecard, base: Scorecard | null): void {
  const delta = (cur: number, b: number | undefined): string =>
    b === undefined ? "" : `  (baseline ${fmt(b)}  ${cur - b >= 0 ? "+" : ""}${fmt(cur - b)})`;
  console.log("Extraction eval scorecard");
  console.log(`  entity precision  ${fmt(s.entity.precision)}${delta(s.entity.precision, base?.entity.precision)}`);
  console.log(`  entity recall     ${fmt(s.entity.recall)}${delta(s.entity.recall, base?.entity.recall)}`);
  console.log(`  entity F1         ${fmt(s.entity.f1)}${delta(s.entity.f1, base?.entity.f1)}`);
  console.log(`  type accuracy     ${fmt(s.entity.typeAccuracy)}${delta(s.entity.typeAccuracy, base?.entity.typeAccuracy)}`);
  console.log(`  relation precision ${fmt(s.relation.precision)}${delta(s.relation.precision, base?.relation.precision)}`);
  console.log(`  relation recall   ${fmt(s.relation.recall)}${delta(s.relation.recall, base?.relation.recall)}`);
  console.log(`  relation F1       ${fmt(s.relation.f1)}${delta(s.relation.f1, base?.relation.f1)}`);
  console.log(`  relation labelAcc ${fmt(s.relation.labelAccuracy)}${delta(s.relation.labelAccuracy, base?.relation.labelAccuracy)}`);
  console.log(`  dedup             ${fmt(s.dedup.score)}${delta(s.dedup.score, base?.dedup.score)}`);
  console.log(`  temporal          ${s.temporal.correct}/${s.temporal.total}`);
  console.log("");
  console.log("Scorecard JSON (copy into baseline.json to accept):");
  console.log(JSON.stringify(s, null, 2));
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

  const dir = await mkdtemp(join(tmpdir(), "eval-run-"));
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as unknown as AnthropicLike,
    { temperature: 0 },
  );
  let failed = 0;
  for (const sc of scenes) {
    const id = await recordScene(dir, sc.text, sc.kind, undefined, sc.beats);
    try {
      await extractLoreFromScene(dir, id, { extractor });
    } catch (e) {
      // One scene the LLM returns unparseable output for must not abort the
      // whole eval. It contributes nothing — scored as the extraction gap it is.
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

  const scorecard = await scoreExtraction(actual, golden, getWorldEmbedding);
  const base: Scorecard | null = existsSync(BASELINE)
    ? (JSON.parse(await readFile(BASELINE, "utf8")) as Scorecard)
    : null;
  printScorecard(scorecard, base);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
