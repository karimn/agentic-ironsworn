// Manual-run helper: dump a curated, diversity-stratified set of Zura
// scenes + a draft golden set.
//
//   SOURCE_CAMPAIGN=/path/to/zura/campaigns/<id> \
//   ANTHROPIC_API_KEY=... \
//   bun run eval/bootstrap.ts
//
// Reads eval/fixtures/selection.txt: one scene ID per line, in processing
// order (curator-authored by inspecting the Zura DB for scene-shape /
// entity-type diversity + a contiguous supersedes sub-sequence). Lines
// starting with '#' are comments.
//
// Outputs eval/fixtures/scenes.jsonl and eval/fixtures/golden.draft.yaml.
// Hand-correct the draft into golden.yaml; commit selection.txt +
// scenes.jsonl + golden.yaml.

import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import Anthropic from "@anthropic-ai/sdk";
import { getScene, recordScene } from "../src/rag/scenes.js";
import { extractLoreFromScene, _makeDefaultExtractor } from "../src/rag/extraction.js";
import { exportLore } from "../src/rag/lore.js";
import type { BeatInput } from "../src/rag/scenes.js";
import type { AnthropicLike } from "../src/rag/communities.js";
import type { SerializedScene } from "./scene-record.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(here, "fixtures");

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const source = reqEnv("SOURCE_CAMPAIGN");
  const apiKey = reqEnv("ANTHROPIC_API_KEY");

  // 1. Read the curated, ordered scene-ID selection. Strip inline `#`
  //    comments and skip blank/comment-only lines, so each ID line can carry
  //    a trailing annotation (e.g. `<uuid>  # [social] why this scene`).
  const selectionPath = join(FIXTURES, "selection.txt");
  const selectedIds = (await readFile(selectionPath, "utf8"))
    .split("\n")
    .map((l) => l.split("#")[0]!.trim())
    .filter((l) => l.length > 0);
  if (selectedIds.length === 0)
    throw new Error(`No scene IDs in ${selectionPath} — author the selection first`);

  // 2. Re-read each selected scene with beats, in selection order, and
  //    write scenes.jsonl (processing order == selection order).
  await mkdir(FIXTURES, { recursive: true });
  const lines: string[] = [];
  const replay: { text: string; kind: string; beats: BeatInput[] }[] = [];
  for (const id of selectedIds) {
    const full = await getScene(source, id, { include_beats: true });
    if (full === null) {
      console.warn(`Skipping scene not found in source campaign: ${id}`);
      continue;
    }
    const beats = (full.beats ?? []).map((b) => ({
      kind: b.kind,
      speaker: b.speaker,
      text: b.text,
      metadata: b.metadata,
    })) as BeatInput[];
    const record: SerializedScene = { id, timestamp: full.timestamp, text: full.text, kind: full.kind, beats };
    lines.push(JSON.stringify(record));
    replay.push({ text: full.text, kind: full.kind, beats });
  }
  await writeFile(join(FIXTURES, "scenes.jsonl"), lines.join("\n") + "\n", "utf8");

  // 3. Run the selected scenes through a fresh pipeline (temperature 0) → draft golden.
  const dir = await mkdtemp(join(tmpdir(), "eval-bootstrap-"));
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey }) as unknown as AnthropicLike,
    { temperature: 0 },
  );
  let failed = 0;
  for (const r of replay) {
    const id = await recordScene(dir, r.text, r.kind, undefined, r.beats);
    try {
      await extractLoreFromScene(dir, id, { extractor });
    } catch (e) {
      // A single scene the LLM returns unparseable output for must not abort
      // the whole draft. The scene simply contributes nothing — a faithful
      // (and curator-visible) extraction gap.
      failed++;
      console.warn(`Extraction failed for scene ${id}: ${(e as Error).message}`);
    }
  }
  if (failed > 0) console.warn(`${failed} of ${replay.length} scenes failed extraction.`);

  const { entities, relations } = await exportLore(dir);
  const idToCanon = new Map(entities.map((e) => [e.id, e.canonical]));
  const draft = {
    entities: entities.map((e) => ({ canonical: e.canonical, type: e.type, aliases: e.aliases })),
    relations: relations.map((r) => ({
      from: idToCanon.get(r.from_id) ?? r.from_id,
      to: idToCanon.get(r.to_id) ?? r.to_id,
      label: r.relation,
      invalidated: r.invalid_at !== null,
    })),
  };
  await writeFile(join(FIXTURES, "golden.draft.yaml"), stringify(draft), "utf8");

  console.log(
    `Wrote ${lines.length} scenes to fixtures/scenes.jsonl and a ${entities.length}-entity / ${relations.length}-relation draft to fixtures/golden.draft.yaml`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
