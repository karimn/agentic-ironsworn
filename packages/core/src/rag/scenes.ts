import { type DuckDBValue } from "@duckdb/node-api";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn, peekWorldDb, getWorldEmbedding } from "./world-db.js";
import type { BeatEntity, BeatRelation } from "./beat-canon.js";

// NOTE: Local DB plumbing (initDb, getDb, openWriteConn, getEmbedding from old scenes.duckdb)
// has been removed. All reads/writes now target world.duckdb via getWorldDb(ctx).

// scenes.id / scene_beats.scene_id are UUID columns. DuckDB throws a conversion
// error when a non-UUID string is compared against them, so callers that accept
// an externally-supplied id must treat a non-UUID value as "no such row".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface Scene {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
  quality_notes?: string;
  beats?: Beat[];
  score?: number;
}

export type BeatKind = "narration" | "dialogue" | "move" | "choice" | "oracle";

export interface BeatInput {
  kind: BeatKind;
  speaker?: string;
  text: string;
  metadata?: Record<string, unknown>;
  // Structured canon this beat establishes (point-of-entry recording).
  entities?: BeatEntity[];
  relations?: BeatRelation[];
}

export interface Beat {
  id: string;
  scene_id: string;
  beat_index: number;
  kind: BeatKind;
  speaker?: string;
  text: string;
  metadata: Record<string, unknown>;
  created_at: string;
  score?: number;
}

export interface BeatSearchResult {
  beats: Beat[];
  total_beats: number;
}

export interface BeatExport {
  id: string;
  scene_id: string;
  beat_index: number;
  kind: string;
  speaker?: string;
  text: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function rowToBeat(row: Record<string, unknown>): Beat {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>; } catch { /* ignore */ }
  return {
    id: String(row["id"]),
    scene_id: String(row["scene_id"]),
    beat_index: Number(row["beat_index"]),
    kind: String(row["kind"]) as BeatKind,
    speaker: row["speaker"] != null ? String(row["speaker"]) : undefined,
    text: String(row["text"]),
    metadata,
    created_at: String(row["created_at"]),
    score: row["score"] != null ? (typeof row["score"] === "number" ? row["score"] : Number(row["score"])) : undefined,
  };
}

export async function recordScene(
  campaignPath: string,
  summary: string,
  kind?: string,
  complicationTheme?: string,
  beats?: BeatInput[],
  qualityNotes?: string,
  placeEntity?: string,
): Promise<string> {
  const ctx = await resolveWorldContext(campaignPath);
  const embedText = qualityNotes ? `${summary}\n${qualityNotes}` : summary;
  const [embedding, instance] = await Promise.all([
    getWorldEmbedding(embedText),
    getWorldDb(ctx),
  ]);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sceneKind = kind ?? "scene";
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  // Resolve place entity UUID if provided (best-effort; null if unresolved)
  // NOTE: Phase 3 will wire up the full entity resolution; for now accept raw UUID or null
  const resolvedPlaceEntity: string | null =
    placeEntity != null && placeEntity.length > 0 ? placeEntity : null;

  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, campaign_id, place_entity, text, embedding, timestamp, kind, complication_theme, quality_notes)
       VALUES (?, ?, ?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
      [id, ctx.campaignId, resolvedPlaceEntity, summary, timestamp, sceneKind, complicationTheme ?? null, qualityNotes ?? null],
    );
  } finally {
    conn.closeSync();
  }
  if (beats && beats.length > 0) {
    await recordBeats(campaignPath, id, beats);
  }
  return id;
}

export async function getScene(
  campaignPath: string,
  id: string,
  opts?: { include_beats?: boolean },
): Promise<Scene | null> {
  if (!isUuid(id)) return null;
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  let scene: Scene | null = null;
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme, quality_notes
       FROM scenes
       WHERE campaign_id = ? AND id = ?`,
      [ctx.campaignId, id],
    )).getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const row = rows[0]!;
    scene = {
      id: String(row["id"]),
      text: String(row["text"]),
      timestamp: String(row["timestamp"]),
      kind: String(row["kind"]),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
      quality_notes: row["quality_notes"] != null ? String(row["quality_notes"]) : undefined,
    };
  } finally {
    conn.closeSync();
  }
  if (opts?.include_beats && scene) {
    scene.beats = await getBeats(campaignPath, id);
  }
  return scene;
}

export async function updateScene(
  campaignPath: string,
  id: string,
  fields: { summary?: string; kind?: string; complication_theme?: string; quality_notes?: string },
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const setClauses: string[] = [];
  const params: DuckDBValue[] = [];
  if (fields.summary !== undefined || fields.quality_notes !== undefined) {
    let embedSummary = fields.summary;
    let embedNotes = fields.quality_notes;
    if (embedSummary === undefined || embedNotes === undefined) {
      const checkConn = await instance.connect();
      try {
        const rows = (await checkConn.runAndReadAll(
          `SELECT text, quality_notes FROM scenes WHERE campaign_id = ? AND id = ?`, [ctx.campaignId, id],
        )).getRowObjectsJS() as Record<string, unknown>[];
        if (rows.length > 0) {
          if (embedSummary === undefined) embedSummary = String(rows[0]!["text"] ?? "");
          if (embedNotes === undefined) {
            const n = rows[0]!["quality_notes"];
            embedNotes = n != null ? String(n) : undefined;
          }
        }
      } finally { checkConn.closeSync(); }
    }
    const embedText = embedNotes ? `${embedSummary}\n${embedNotes}` : embedSummary!;
    const embedding = await getWorldEmbedding(embedText);
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
    if (fields.summary !== undefined) { setClauses.push(`text = ?`); params.push(fields.summary); }
    setClauses.push(`embedding = ${embeddingLiteral}`);
  }
  if (fields.kind !== undefined) { setClauses.push(`kind = ?`); params.push(fields.kind); }
  if (fields.complication_theme !== undefined) { setClauses.push(`complication_theme = ?`); params.push(fields.complication_theme); }
  if (fields.quality_notes !== undefined) { setClauses.push(`quality_notes = ?`); params.push(fields.quality_notes); }
  if (setClauses.length === 0) return;
  params.push(ctx.campaignId);
  params.push(id);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(`UPDATE scenes SET ${setClauses.join(", ")} WHERE campaign_id = ? AND id = ?`, params);
  } finally { conn.closeSync(); }
}

export async function deleteScene(campaignPath: string, id: string): Promise<void> {
  if (!isUuid(id)) return;
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(`DELETE FROM scene_beats WHERE scene_id = ?`, [id]);
    await conn.run(`DELETE FROM scene_entity_refs WHERE scene_id = ?`, [id]);
    await conn.run(`DELETE FROM scenes WHERE campaign_id = ? AND id = ?`, [ctx.campaignId, id]);
  } finally { conn.closeSync(); }
}

export async function recordBeats(
  campaignPath: string,
  sceneId: string,
  beats: BeatInput[],
): Promise<void> {
  if (beats.length === 0) return;
  if (!isUuid(sceneId)) throw new Error(`Scene not found: ${sceneId}`);
  const ctx = await resolveWorldContext(campaignPath);
  const [embeddings, instance] = await Promise.all([
    Promise.all(beats.map((b) => getWorldEmbedding(b.text))),
    getWorldDb(ctx),
  ]);
  const checkConn = await instance.connect();
  let startIndex = 0;
  try {
    const rows = (await checkConn.runAndReadAll(
      `SELECT COALESCE(MAX(beat_index) + 1, 0) AS next_index FROM scene_beats WHERE scene_id = ?`, [sceneId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    startIndex = Number(rows[0]?.["next_index"] ?? 0);
  } finally { checkConn.closeSync(); }
  const conn = await openWorldWriteConn(instance);
  try {
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!;
      const embedding = embeddings[i]!;
      const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
      const beatId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const metadata = JSON.stringify(beat.metadata ?? {});
      await conn.run(
        `INSERT INTO scene_beats (id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
        [beatId, sceneId, startIndex + i, beat.kind, beat.speaker ?? null, beat.text, metadata, created_at],
      );
    }
  } finally { conn.closeSync(); }
}

export async function recordBeat(
  campaignPath: string,
  sceneId: string,
  beat: BeatInput,
): Promise<number> {
  if (!isUuid(sceneId)) throw new Error(`Scene not found: ${sceneId}`);
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const checkConn = await instance.connect();
  let beatIndex: number;
  try {
    const sceneRows = (await checkConn.runAndReadAll(
      `SELECT id FROM scenes WHERE campaign_id = ? AND id = ?`, [ctx.campaignId, sceneId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    if (sceneRows.length === 0) throw new Error(`Scene not found: ${sceneId}`);
    const rows = (await checkConn.runAndReadAll(
      `SELECT COALESCE(MAX(beat_index) + 1, 0) AS next_index FROM scene_beats WHERE scene_id = ?`, [sceneId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    beatIndex = Number(rows[0]?.["next_index"] ?? 0);
  } finally { checkConn.closeSync(); }
  const embedding = await getWorldEmbedding(beat.text);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const beatId = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const metadata = JSON.stringify(beat.metadata ?? {});
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scene_beats (id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
      [beatId, sceneId, beatIndex, beat.kind, beat.speaker ?? null, beat.text, metadata, created_at],
    );
  } finally { conn.closeSync(); }
  return beatIndex;
}

export async function getBeats(campaignPath: string, sceneId: string): Promise<Beat[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT id, scene_id, beat_index, kind, speaker, text, metadata, created_at
       FROM scene_beats WHERE scene_id = ? ORDER BY beat_index`, [sceneId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map(rowToBeat);
  } finally { conn.closeSync(); }
}

export async function searchBeats(
  campaignPath: string,
  query: string,
  k?: number,
  opts?: { kind?: string; scene_id?: string },
): Promise<BeatSearchResult> {
  const limit = k ?? 5;
  const ctx = await resolveWorldContext(campaignPath);
  const [embedding, instance] = await Promise.all([getWorldEmbedding(query), getWorldDb(ctx)]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  // Build per-campaign scene_id filter: beats are implicitly campaign-scoped via scene_id FK
  // We join to scenes to enforce campaign_id filtering.
  const conditions: string[] = [`sb.scene_id IN (SELECT id FROM scenes WHERE campaign_id = ?)`];
  const filterBaseParams: DuckDBValue[] = [ctx.campaignId];
  if (opts?.kind) { conditions.push(`sb.kind = ?`); filterBaseParams.push(opts.kind); }
  if (opts?.scene_id) { conditions.push(`sb.scene_id = ?`); filterBaseParams.push(opts.scene_id); }
  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const conn = await instance.connect();
  try {
    const countResult = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM scene_beats sb ${whereClause}`, filterBaseParams,
    );
    const countRows = countResult.getRowObjectsJS() as Record<string, unknown>[];
    const total_beats = Number(countRows[0]?.["cnt"] ?? 0);
    const searchParams: DuckDBValue[] = [...filterBaseParams, limit];
    const result = await conn.runAndReadAll(
      `SELECT sb.id, sb.scene_id, sb.beat_index, sb.kind, sb.speaker, sb.text, sb.metadata, sb.created_at,
              array_cosine_similarity(sb.embedding, ${embeddingLiteral}) AS score
       FROM scene_beats sb ${whereClause} ORDER BY score DESC LIMIT ?`,
      searchParams,
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return { beats: rows.map(rowToBeat), total_beats };
  } finally { conn.closeSync(); }
}

export interface SceneExport {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
  quality_notes?: string;
  beats?: BeatExport[];
}

export async function exportScenes(campaignPath: string): Promise<SceneExport[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const sceneRows = (await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme, quality_notes
       FROM scenes WHERE campaign_id = ? ORDER BY timestamp`,
      [ctx.campaignId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    const beatRows = (await conn.runAndReadAll(
      `SELECT sb.id, sb.scene_id, sb.beat_index, sb.kind, sb.speaker, sb.text, sb.metadata, sb.created_at
       FROM scene_beats sb
       JOIN scenes s ON s.id = sb.scene_id
       WHERE s.campaign_id = ?
       ORDER BY sb.scene_id, sb.beat_index`,
      [ctx.campaignId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    const beatsByScene = new Map<string, BeatExport[]>();
    for (const row of beatRows) {
      const sceneId = String(row["scene_id"]);
      if (!beatsByScene.has(sceneId)) beatsByScene.set(sceneId, []);
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>; } catch { /* ignore */ }
      beatsByScene.get(sceneId)!.push({
        id: String(row["id"]),
        scene_id: sceneId,
        beat_index: Number(row["beat_index"]),
        kind: String(row["kind"]),
        speaker: row["speaker"] != null ? String(row["speaker"]) : undefined,
        text: String(row["text"]),
        metadata,
        created_at: String(row["created_at"]),
      });
    }
    return sceneRows.map((r) => {
      const id = String(r["id"]);
      const beats = beatsByScene.get(id);
      const entry: SceneExport = {
        id,
        text: String(r["text"]),
        timestamp: String(r["timestamp"]),
        kind: String(r["kind"]),
        complication_theme: r["complication_theme"] != null ? String(r["complication_theme"]) : undefined,
        quality_notes: r["quality_notes"] != null ? String(r["quality_notes"]) : undefined,
      };
      if (beats && beats.length > 0) entry.beats = beats;
      return entry;
    });
  } finally { conn.closeSync(); }
}

export async function importScene(
  campaignPath: string,
  id: string,
  text: string,
  timestamp: string,
  kind: string,
  complicationTheme?: string,
  beats?: BeatExport[],
  qualityNotes?: string,
): Promise<boolean> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const checkConn = await instance.connect();
  let exists = false;
  try {
    const rows = (await checkConn.runAndReadAll(
      `SELECT id FROM scenes WHERE campaign_id = ? AND id = ?`, [ctx.campaignId, id],
    )).getRowObjectsJS() as unknown[];
    exists = rows.length > 0;
  } finally { checkConn.closeSync(); }
  if (exists) return false;
  const embedText = qualityNotes ? `${text}\n${qualityNotes}` : text;
  const allTexts = [embedText, ...(beats ?? []).map((b) => b.text)];
  const allEmbeddings = await Promise.all(allTexts.map((t) => getWorldEmbedding(t)));
  const sceneEmbedding = allEmbeddings[0]!;
  const beatEmbeddings = allEmbeddings.slice(1);
  const embeddingLiteral = `[${sceneEmbedding.join(",")}]::FLOAT[768]`;
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, campaign_id, place_entity, text, embedding, timestamp, kind, complication_theme, quality_notes)
       VALUES (?, ?, ?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
      [id, ctx.campaignId, null, text, timestamp, kind, complicationTheme ?? null, qualityNotes ?? null],
    );
    if (beats && beats.length > 0) {
      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i]!;
        const beatEmbedding = beatEmbeddings[i]!;
        const beatEmbeddingLiteral = `[${beatEmbedding.join(",")}]::FLOAT[768]`;
        await conn.run(
          `INSERT INTO scene_beats (id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ${beatEmbeddingLiteral}, ?, ?)`,
          [beat.id, beat.scene_id, beat.beat_index, beat.kind, beat.speaker ?? null, beat.text, JSON.stringify(beat.metadata ?? {}), beat.created_at],
        );
      }
    }
    return true;
  } finally { conn.closeSync(); }
}

export interface SceneEntityRefExport {
  scene_id: string;
  entity_id: string;
  role: string;
}

/**
 * Export all scene entity refs for the current campaign (joined through scenes for campaign filter).
 */
export async function exportSceneEntityRefs(
  campaignPath: string,
): Promise<SceneEntityRefExport[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT ser.scene_id, ser.entity_id, ser.role
       FROM scene_entity_refs ser
       JOIN scenes s ON s.id = ser.scene_id
       WHERE s.campaign_id = ?
       ORDER BY ser.scene_id, ser.entity_id`,
      [ctx.campaignId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      scene_id: String(r["scene_id"]),
      entity_id: String(r["entity_id"]),
      role: String(r["role"] ?? "present"),
    }));
  } finally {
    conn.closeSync();
  }
}

export async function checkpointScenes(campaignPath: string): Promise<void> {
  // NOTE: scenes are now in world.duckdb — checkpoint the world DB via peekWorldDb.
  // It's fine that checkpointLore and checkpointScenes both checkpoint the same file.
  const ctx = await resolveWorldContext(campaignPath);
  const cached = peekWorldDb(ctx.worldDbPath);
  if (cached === undefined) return;
  const instance = await cached;
  const conn = await instance.connect();
  try {
    try { await conn.run("LOAD vss;"); } catch { /* vss not pre-installed */ }
    await conn.run("CHECKPOINT;");
  } finally { conn.closeSync(); }
}

export async function searchScenes(
  campaignPath: string,
  query: string,
  k?: number,
): Promise<Scene[]> {
  const limit = k ?? 5;
  const ctx = await resolveWorldContext(campaignPath);
  const [embedding, instance] = await Promise.all([getWorldEmbedding(query), getWorldDb(ctx)]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme, quality_notes,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM scenes
       WHERE campaign_id = ?
       ORDER BY score DESC LIMIT ?`,
      [ctx.campaignId, limit],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
      quality_notes: row["quality_notes"] != null ? String(row["quality_notes"]) : undefined,
      score: typeof row["score"] === "number" ? row["score"]
        : typeof row["score"] === "bigint" ? Number(row["score"]) : undefined,
    }));
  } finally { conn.closeSync(); }
}

export interface RecentSceneSummary {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
}

export async function getRecentScenesChronological(
  campaignPath: string,
  k: number = 5,
): Promise<RecentSceneSummary[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind FROM (
         SELECT id, text, timestamp, kind FROM scenes WHERE campaign_id = ? ORDER BY timestamp DESC LIMIT ?
       ) sub ORDER BY timestamp ASC`,
      [ctx.campaignId, k],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
    }));
  } finally { conn.closeSync(); }
}

export interface ComplicationScene {
  summary: string;
  complication_theme: string;
  kind: string;
  timestamp: string;
}

export async function countScenesMentioningNpc(
  campaignPath: string,
  npcName: string,
  sinceTimestamp: string,
): Promise<number> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM scenes WHERE campaign_id = ? AND timestamp > ? AND lower(text) LIKE ?`,
      [ctx.campaignId, sinceTimestamp, `%${npcName.toLowerCase()}%`],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return Number(rows[0]?.["cnt"] ?? 0);
  } finally { conn.closeSync(); }
}

export async function getRecentComplications(
  campaignPath: string,
  k: number = 5,
): Promise<ComplicationScene[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT text, complication_theme, kind, timestamp
       FROM scenes WHERE campaign_id = ? AND complication_theme IS NOT NULL ORDER BY timestamp DESC LIMIT ?`,
      [ctx.campaignId, k],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      summary: String(row["text"] ?? ""),
      complication_theme: String(row["complication_theme"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      timestamp: String(row["timestamp"] ?? ""),
    }));
  } finally { conn.closeSync(); }
}

// ---------------------------------------------------------------------------
// scene_entity_refs SDK functions (Phase 2 new additions)
// ---------------------------------------------------------------------------

/**
 * Upsert rows in scene_entity_refs for a given scene.
 * Uses ON CONFLICT (scene_id, entity_id) DO UPDATE SET role = EXCLUDED.role.
 */
export async function setSceneEntityRefs(
  campaignPath: string,
  sceneId: string,
  refs: { entity_id: string; role?: string }[],
): Promise<void> {
  if (refs.length === 0) return;
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    for (const ref of refs) {
      const role = ref.role ?? "present";
      await conn.run(
        `INSERT INTO scene_entity_refs (scene_id, entity_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT (scene_id, entity_id) DO UPDATE SET role = EXCLUDED.role`,
        [sceneId, ref.entity_id, role],
      );
    }
  } finally {
    conn.closeSync();
  }
}

/**
 * Retrieve entity refs for a scene.
 */
export async function getSceneEntityRefs(
  campaignPath: string,
  sceneId: string,
): Promise<{ entity_id: string; role: string }[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT entity_id, role FROM scene_entity_refs WHERE scene_id = ?`,
      [sceneId],
    )).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      entity_id: String(r["entity_id"]),
      role: String(r["role"] ?? "present"),
    }));
  } finally {
    conn.closeSync();
  }
}
