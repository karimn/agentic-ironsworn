import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicLike } from "./communities.js";
import {
  upsertLore,
  searchLore,
  linkLore,
  getLore,
  LORE_TYPES,
  type LoreType,
  type LoreSearchHit,
} from "./lore.js";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import { getScene, exportScenes } from "./scenes.js";

export interface ExtractedEntity {
  canonical: string;
  type: LoreType;
  summary: string;
  aliases?: string[];
  excerpt: string;
  confidence: number;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  relation: string;
  notes?: string;
  excerpt: string;
  confidence: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface ExtractionReport {
  scene_id: string;
  entities_created: number;
  entities_updated: number;
  relations_created: number;
  skipped: number;
}

export interface BatchReport {
  scenes_processed: number;
  scenes_skipped: number;
  entities_created: number;
  entities_updated: number;
  relations_created: number;
  skipped_items: number;
}

export interface ExtractOptions {
  confidenceThreshold?: number;
  extractor?: Extractor;
}

export type Extractor = (
  sceneText: string,
  existingEntities: LoreSearchHit[],
) => Promise<ExtractionResult>;

const DEDUP_SIMILARITY_THRESHOLD = 0.92;

function buildSceneText(scene: Awaited<ReturnType<typeof getScene>>): string {
  if (!scene) return "";
  if (scene.beats && scene.beats.length > 0) {
    return scene.beats
      .map((b) => {
        const speaker = b.speaker ? `${b.speaker}: ` : "";
        return `[${b.beat_index}] (${b.kind}) ${speaker}${b.text}`;
      })
      .join("\n");
  }
  return scene.text;
}

async function writeExtractionLog(
  campaignPath: string,
  report: ExtractionReport,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO lore_extraction_log
         (scene_id, extracted_at, entities_created, entities_updated, relations_created, skipped)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (scene_id) DO UPDATE SET
         extracted_at      = EXCLUDED.extracted_at,
         entities_created  = EXCLUDED.entities_created,
         entities_updated  = EXCLUDED.entities_updated,
         relations_created = EXCLUDED.relations_created,
         skipped           = EXCLUDED.skipped`,
      [
        report.scene_id,
        new Date().toISOString(),
        report.entities_created,
        report.entities_updated,
        report.relations_created,
        report.skipped,
      ],
    );
  } finally {
    conn.closeSync();
  }
}

async function getLoggedSceneIds(campaignPath: string): Promise<Set<string>> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const rows = (
      await conn.runAndReadAll(`SELECT scene_id FROM lore_extraction_log`)
    ).getRowObjectsJS() as Record<string, unknown>[];
    return new Set(rows.map((r) => String(r["scene_id"])));
  } finally {
    conn.closeSync();
  }
}

export async function extractLoreFromScene(
  campaignPath: string,
  sceneId: string,
  opts?: ExtractOptions,
): Promise<ExtractionReport> {
  const threshold = opts?.confidenceThreshold ?? 0.6;
  const extractor = opts?.extractor ?? defaultExtractor;

  const scene = await getScene(campaignPath, sceneId, { include_beats: true });
  if (scene === null) {
    throw new Error(`Scene not found: ${sceneId}`);
  }

  const sceneText = buildSceneText(scene);
  const existingEntities = await searchLore(campaignPath, sceneText, 10);
  const result = await extractor(sceneText, existingEntities);

  const report: ExtractionReport = {
    scene_id: sceneId,
    entities_created: 0,
    entities_updated: 0,
    relations_created: 0,
    skipped: 0,
  };

  for (const entity of result.entities) {
    if (!LORE_TYPES.includes(entity.type)) {
      report.skipped++;
      continue;
    }

    const hits = await searchLore(campaignPath, entity.canonical, 3);
    const topHit = hits[0];
    const isExisting = topHit !== undefined && topHit.score >= DEDUP_SIMILARITY_THRESHOLD;

    const metadata: Record<string, unknown> = {};
    if (entity.confidence < threshold) {
      metadata["needs_review"] = true;
    }

    const upsertResult = await upsertLore(campaignPath, {
      ...(isExisting ? { id: topHit.id } : {}),
      canonical: isExisting ? topHit.canonical : entity.canonical,
      type: entity.type,
      summary: entity.summary,
      aliases: entity.aliases,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      provenance: {
        source_kind: "extraction",
        source_id: sceneId,
        excerpt: entity.excerpt,
        confidence: entity.confidence,
      },
    });

    // Count what actually happened: even when the vector pre-check (isExisting)
    // misses, upsertLore still dedups by exact canonical/alias, so trust its
    // result rather than the cosine guess.
    if (upsertResult.updated) {
      report.entities_updated++;
    } else {
      report.entities_created++;
    }
  }

  for (const rel of result.relations) {
    if (rel.confidence < threshold) {
      report.skipped++;
      continue;
    }

    const fromEntity = await getLore(campaignPath, rel.from);
    const toEntity = await getLore(campaignPath, rel.to);

    if (fromEntity === null || toEntity === null) {
      report.skipped++;
      continue;
    }

    await linkLore(campaignPath, {
      from: fromEntity.id,
      to: toEntity.id,
      relation: rel.relation,
      notes: rel.notes,
      provenance: {
        source_kind: "extraction",
        source_id: sceneId,
        excerpt: rel.excerpt,
        confidence: rel.confidence,
      },
    });

    report.relations_created++;
  }

  await writeExtractionLog(campaignPath, report);
  return report;
}

export async function extractUnprocessedScenes(
  campaignPath: string,
  opts?: ExtractOptions,
): Promise<BatchReport> {
  const [allScenes, loggedIds] = await Promise.all([
    exportScenes(campaignPath),
    getLoggedSceneIds(campaignPath),
  ]);

  const batch: BatchReport = {
    scenes_processed: 0,
    scenes_skipped: 0,
    entities_created: 0,
    entities_updated: 0,
    relations_created: 0,
    skipped_items: 0,
  };

  for (const scene of allScenes) {
    if (loggedIds.has(scene.id)) {
      batch.scenes_skipped++;
      continue;
    }
    const report = await extractLoreFromScene(campaignPath, scene.id, opts);
    batch.scenes_processed++;
    batch.entities_created += report.entities_created;
    batch.entities_updated += report.entities_updated;
    batch.relations_created += report.relations_created;
    batch.skipped_items += report.skipped;
  }

  return batch;
}

const DEFAULT_EXTRACTION_MODEL =
  process.env["SCRIBE_SUMMARY_MODEL"] ?? "claude-haiku-4-5-20251001";

const EXTRACTION_SYSTEM_PROMPT =
  "You are extracting lore from a solo RPG campaign scene. " +
  "Return ONLY valid JSON matching the requested schema. No prose, no markdown fences.";

export function _makeDefaultExtractor(client: AnthropicLike): Extractor {
  return async (sceneText, existingEntities) => {
    const existingContext =
      existingEntities.length > 0
        ? existingEntities
            .map((e) => `${e.id}|${e.canonical}|${e.type}|${e.summary}`)
            .join("\n")
        : "(none)";

    const userPrompt =
      `Scene text:\n${sceneText}\n\n` +
      `Existing lore entities for dedup (id|canonical|type|summary):\n${existingContext}\n\n` +
      `Extract entities and relations newly revealed or changed in this scene.\n` +
      `Entity types allowed: ${LORE_TYPES.join(", ")}.\n` +
      `Preferred relation labels (use these or a close variant): ` +
      `allied_with, enemy_of, member_of, leads, guards, located_in, created_by, corrupts, bound_to, seeks, opposes.\n` +
      `For each item, provide the exact excerpt supporting it and a confidence 0.0–1.0.\n` +
      `Confidence reflects how clearly the scene establishes this fact.\n\n` +
      `Return ONLY this JSON object:\n` +
      `{\n` +
      `  "entities": [\n` +
      `    { "canonical": string, "type": string, "summary": string, "aliases": string[], "excerpt": string, "confidence": number }\n` +
      `  ],\n` +
      `  "relations": [\n` +
      `    { "from": string, "to": string, "relation": string, "notes": string, "excerpt": string, "confidence": number }\n` +
      `  ]\n` +
      `}`;

    const response = await client.messages.create({
      model: DEFAULT_EXTRACTION_MODEL,
      max_tokens: 2048,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .flatMap((b) =>
        b.type === "text" && typeof b.text === "string" ? [b.text] : [],
      )
      .join("")
      .trim();

    if (text.length === 0) {
      throw new Error("Empty extraction response from Anthropic");
    }

    const parsed = JSON.parse(text) as ExtractionResult;
    parsed.entities = parsed.entities.filter((e) =>
      LORE_TYPES.includes(e.type),
    );
    return parsed;
  };
}

let _anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropicClient !== null) return _anthropicClient;
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for lore extraction. " +
        "Set it in the env, or pass a custom `extractor` to extractLoreFromScene.",
    );
  }
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

function defaultExtractor(
  sceneText: string,
  existingEntities: LoreSearchHit[],
): Promise<ExtractionResult> {
  return _makeDefaultExtractor(getAnthropic())(sceneText, existingEntities);
}
