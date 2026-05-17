import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";
import { runDbMigrations } from "../migrations/index.js";
import { SCENES_MIGRATIONS } from "../migrations/scenes.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  /** Total number of beats in scope (applying any kind/scene_id filters but ignoring
   *  the search query and k limit).  Callers can use this to distinguish "no results
   *  because nothing matched the query" (total_beats > 0) from "no results because
   *  this scene has no beats recorded at all" (total_beats === 0). */
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

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const _dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(
    `${campaignPath}/scenes.duckdb`,
  );

  const conn = await instance.connect();
  try {
    // vss is required for HNSW vector indexes. If the extension CDN is
    // unreachable, degrade gracefully: the table is created without the HNSW
    // index, so reads/writes still work but vector search is unavailable.
    let vssLoaded = false;
    try {
      await conn.run("LOAD vss;");
      await conn.run("SET hnsw_enable_experimental_persistence = true;");
      vssLoaded = true;
    } catch {
      // vss not pre-installed; HNSW index skipped
    }

    await conn.run(`
      CREATE TABLE IF NOT EXISTS scenes (
        id                 TEXT PRIMARY KEY,
        text               TEXT NOT NULL,
        embedding          FLOAT[768] NOT NULL,
        timestamp          TEXT NOT NULL,
        kind               TEXT NOT NULL DEFAULT 'scene',
        complication_theme TEXT,
        quality_notes      TEXT
      )
    `);

    await conn.run(`
      ALTER TABLE scenes ADD COLUMN IF NOT EXISTS complication_theme TEXT
    `);

    await conn.run(`
      ALTER TABLE scenes ADD COLUMN IF NOT EXISTS quality_notes TEXT
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS scene_beats (
        id          TEXT PRIMARY KEY,
        scene_id    TEXT NOT NULL,
        beat_index  INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        speaker     TEXT,
        text        TEXT NOT NULL,
        embedding   FLOAT[768] NOT NULL,
        metadata    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL,
        UNIQUE (scene_id, beat_index)
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS scene_beats_scene_idx
      ON scene_beats (scene_id, beat_index)
    `);

    if (vssLoaded) {
      await conn.run(`
        CREATE INDEX IF NOT EXISTS scenes_embedding_idx
        ON scenes USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);

      await conn.run(`
        CREATE INDEX IF NOT EXISTS scene_beats_embedding_idx
        ON scene_beats USING HNSW (embedding)
        WITH (metric = 'cosine')
      `);
    }

    await runDbMigrations(conn, SCENES_MIGRATIONS);
  } finally {
    conn.closeSync();
  }

  return instance;
}

function getDb(campaignPath: string): Promise<DuckDBInstance> {
  const cached = _dbPromises.get(campaignPath);
  if (cached !== undefined) return cached;

  const promise = initDb(campaignPath).catch((e) => {
    _dbPromises.delete(campaignPath);
    throw e;
  });
  _dbPromises.set(campaignPath, promise);
  return promise;
}

// See lore.ts openWriteConn for explanation. Same connection-scoped flag
// required on every write connection to an HNSW-indexed table.
async function openWriteConn(
  instance: DuckDBInstance,
): Promise<Awaited<ReturnType<DuckDBInstance["connect"]>>> {
  const conn = await instance.connect();
  try {
    await conn.run("SET hnsw_enable_experimental_persistence = true;");
  } catch {
    // vss not loaded; skip HNSW persistence flag
  }
  return conn;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function getEmbedding(text: string): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: text }),
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(`Ollama unavailable at ${OLLAMA_BASE_URL}: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Ollama embed failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { embeddings: number[][] };

  if (!data.embeddings || !Array.isArray(data.embeddings[0])) {
    throw new Error("Unexpected Ollama response shape");
  }

  if (data.embeddings[0].length !== 768) {
    throw new Error(
      `Expected 768-dim embedding, got ${data.embeddings[0].length}`,
    );
  }

  if (!data.embeddings[0].every((v) => typeof v === "number" && isFinite(v))) {
    throw new Error("Invalid embedding values from Ollama");
  }

  return data.embeddings[0];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToBeat(row: Record<string, unknown>): Beat {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>;
  } catch {
    // ignore parse errors; leave metadata empty
  }
  return {
    id: String(row["id"]),
    scene_id: String(row["scene_id"]),
    beat_index: Number(row["beat_index"]),
    kind: String(row["kind"]) as BeatKind,
    speaker: row["speaker"] != null ? String(row["speaker"]) : undefined,
    text: String(row["text"]),
    metadata,
    created_at: String(row["created_at"]),
    score: row["score"] != null
      ? typeof row["score"] === "number" ? row["score"] : Number(row["score"])
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API — scenes
// ---------------------------------------------------------------------------

export async function recordScene(
  campaignPath: string,
  summary: string,
  kind?: string,
  complicationTheme?: string,
  beats?: BeatInput[],
  qualityNotes?: string,
): Promise<string> {
  const embedText = qualityNotes ? `${summary}\n${qualityNotes}` : summary;
  const [embedding, instance] = await Promise.all([
    getEmbedding(embedText),
    getDb(campaignPath),
  ]);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sceneKind = kind ?? "scene";

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme, quality_notes)
       VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
      [id, summary, timestamp, sceneKind, complicationTheme ?? null, qualityNotes ?? null],
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
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  let scene: Scene | null = null;
  try {
    const rows = (
      await conn.runAndReadAll(
        `SELECT id, text, timestamp, kind, complication_theme, quality_notes FROM scenes WHERE id = ?`,
        [id],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
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
  const instance = await getDb(campaignPath);

  // Build SET clauses for provided fields
  const setClauses: string[] = [];
  const params: DuckDBValue[] = [];

  if (fields.summary !== undefined || fields.quality_notes !== undefined) {
    // Re-embed when summary or quality_notes changes; need current values for the other field
    let embedSummary = fields.summary;
    let embedNotes = fields.quality_notes;

    if (embedSummary === undefined || embedNotes === undefined) {
      // Fetch current values for whichever field is not being updated
      const checkConn = await instance.connect();
      try {
        const rows = (
          await checkConn.runAndReadAll(
            `SELECT text, quality_notes FROM scenes WHERE id = ?`,
            [id],
          )
        ).getRowObjectsJS() as Record<string, unknown>[];
        if (rows.length > 0) {
          if (embedSummary === undefined) embedSummary = String(rows[0]!["text"] ?? "");
          if (embedNotes === undefined) {
            const n = rows[0]!["quality_notes"];
            embedNotes = n != null ? String(n) : undefined;
          }
        }
      } finally {
        checkConn.closeSync();
      }
    }

    const embedText = embedNotes ? `${embedSummary}\n${embedNotes}` : embedSummary!;
    const embedding = await getEmbedding(embedText);
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
    if (fields.summary !== undefined) {
      setClauses.push(`text = ?`);
      params.push(fields.summary);
    }
    setClauses.push(`embedding = ${embeddingLiteral}`);
  }
  if (fields.kind !== undefined) {
    setClauses.push(`kind = ?`);
    params.push(fields.kind);
  }
  if (fields.complication_theme !== undefined) {
    setClauses.push(`complication_theme = ?`);
    params.push(fields.complication_theme);
  }
  if (fields.quality_notes !== undefined) {
    setClauses.push(`quality_notes = ?`);
    params.push(fields.quality_notes);
  }

  if (setClauses.length === 0) return;

  params.push(id);

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `UPDATE scenes SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );
  } finally {
    conn.closeSync();
  }
}

export async function deleteScene(
  campaignPath: string,
  id: string,
): Promise<void> {
  const instance = await getDb(campaignPath);
  const conn = await openWriteConn(instance);
  try {
    await conn.run(`DELETE FROM scene_beats WHERE scene_id = ?`, [id]);
    await conn.run(`DELETE FROM scenes WHERE id = ?`, [id]);
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Public API — beats
// ---------------------------------------------------------------------------

export async function recordBeats(
  campaignPath: string,
  sceneId: string,
  beats: BeatInput[],
): Promise<void> {
  if (beats.length === 0) return;

  const [embeddings, instance] = await Promise.all([
    Promise.all(beats.map((b) => getEmbedding(b.text))),
    getDb(campaignPath),
  ]);

  // Determine start index from current max beat_index for this scene
  const checkConn = await instance.connect();
  let startIndex = 0;
  try {
    const rows = (
      await checkConn.runAndReadAll(
        `SELECT COALESCE(MAX(beat_index) + 1, 0) AS next_index FROM scene_beats WHERE scene_id = ?`,
        [sceneId],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    startIndex = Number(rows[0]?.["next_index"] ?? 0);
  } finally {
    checkConn.closeSync();
  }

  const conn = await openWriteConn(instance);
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
  } finally {
    conn.closeSync();
  }
}

/**
 * Append a single beat to an existing scene and return its 0-based index.
 * Throws if the scene does not exist.
 */
export async function recordBeat(
  campaignPath: string,
  sceneId: string,
  beat: BeatInput,
): Promise<number> {
  const instance = await getDb(campaignPath);

  // Verify the scene exists
  const checkConn = await instance.connect();
  let beatIndex: number;
  try {
    const sceneRows = (
      await checkConn.runAndReadAll(
        `SELECT id FROM scenes WHERE id = ?`,
        [sceneId],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    if (sceneRows.length === 0) {
      throw new Error(`Scene not found: ${sceneId}`);
    }

    const rows = (
      await checkConn.runAndReadAll(
        `SELECT COALESCE(MAX(beat_index) + 1, 0) AS next_index FROM scene_beats WHERE scene_id = ?`,
        [sceneId],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    beatIndex = Number(rows[0]?.["next_index"] ?? 0);
  } finally {
    checkConn.closeSync();
  }

  const embedding = await getEmbedding(beat.text);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const beatId = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const metadata = JSON.stringify(beat.metadata ?? {});

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scene_beats (id, scene_id, beat_index, kind, speaker, text, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
      [beatId, sceneId, beatIndex, beat.kind, beat.speaker ?? null, beat.text, metadata, created_at],
    );
  } finally {
    conn.closeSync();
  }

  return beatIndex;
}

export async function getBeats(
  campaignPath: string,
  sceneId: string,
): Promise<Beat[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const rows = (
      await conn.runAndReadAll(
        `SELECT id, scene_id, beat_index, kind, speaker, text, metadata, created_at
         FROM scene_beats
         WHERE scene_id = ?
         ORDER BY beat_index`,
        [sceneId],
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map(rowToBeat);
  } finally {
    conn.closeSync();
  }
}

export async function searchBeats(
  campaignPath: string,
  query: string,
  k?: number,
  opts?: { kind?: string; scene_id?: string },
): Promise<BeatSearchResult> {
  const limit = k ?? 5;

  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conditions: string[] = [];
  const filterParams: DuckDBValue[] = [];

  if (opts?.kind) {
    conditions.push(`kind = ?`);
    filterParams.push(opts.kind);
  }
  if (opts?.scene_id) {
    conditions.push(`scene_id = ?`);
    filterParams.push(opts.scene_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const conn = await instance.connect();
  try {
    // Count total beats in scope (same filters, no query/limit applied)
    const countResult = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM scene_beats ${whereClause}`,
      filterParams,
    );
    const countRows = countResult.getRowObjectsJS() as Record<string, unknown>[];
    const total_beats = Number(countRows[0]?.["cnt"] ?? 0);

    // Semantic search with limit
    const searchParams: DuckDBValue[] = [...filterParams, limit];
    const result = await conn.runAndReadAll(
      `SELECT id, scene_id, beat_index, kind, speaker, text, metadata, created_at,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM scene_beats
       ${whereClause}
       ORDER BY score DESC
       LIMIT ?`,
      searchParams,
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return { beats: rows.map(rowToBeat), total_beats };
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

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
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const sceneRows = (
      await conn.runAndReadAll(
        `SELECT id, text, timestamp, kind, complication_theme, quality_notes FROM scenes ORDER BY timestamp`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];

    const beatRows = (
      await conn.runAndReadAll(
        `SELECT id, scene_id, beat_index, kind, speaker, text, metadata, created_at
         FROM scene_beats
         ORDER BY scene_id, beat_index`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];

    // Group beats by scene_id
    const beatsByScene = new Map<string, BeatExport[]>();
    for (const row of beatRows) {
      const sceneId = String(row["scene_id"]);
      if (!beatsByScene.has(sceneId)) beatsByScene.set(sceneId, []);
      let metadata: Record<string, unknown> = {};
      try {
        metadata = JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>;
      } catch {
        // ignore
      }
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
  } finally {
    conn.closeSync();
  }
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
  const instance = await getDb(campaignPath);

  const checkConn = await instance.connect();
  let exists = false;
  try {
    const rows = (
      await checkConn.runAndReadAll(`SELECT id FROM scenes WHERE id = ?`, [id])
    ).getRowObjectsJS() as unknown[];
    exists = rows.length > 0;
  } finally {
    checkConn.closeSync();
  }
  if (exists) return false;

  // Fetch scene + all beat embeddings in parallel
  const embedText = qualityNotes ? `${text}\n${qualityNotes}` : text;
  const allTexts = [embedText, ...(beats ?? []).map((b) => b.text)];
  const allEmbeddings = await Promise.all(allTexts.map(getEmbedding));
  const sceneEmbedding = allEmbeddings[0]!;
  const beatEmbeddings = allEmbeddings.slice(1);

  const embeddingLiteral = `[${sceneEmbedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme, quality_notes) VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?, ?)`,
      [id, text, timestamp, kind, complicationTheme ?? null, qualityNotes ?? null],
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
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

/**
 * Flush the WAL to the main database file.
 *
 * See lore.ts checkpointLore for full rationale. The scenes DB also carries
 * an HNSW index, so vss must be loaded before issuing the CHECKPOINT.
 *
 * Safe to call at any time; no-op if the DB has not been opened yet.
 */
export async function checkpointScenes(campaignPath: string): Promise<void> {
  const cached = _dbPromises.get(campaignPath);
  if (cached === undefined) return;

  const instance = await cached;
  const conn = await instance.connect();
  try {
    // vss must be loaded before checkpointing a DB that contains an HNSW index.
    // Swallow install errors if the CDN is unreachable; CHECKPOINT proceeds
    // without the HNSW index in that case.
    try {
      await conn.run("LOAD vss;");
    } catch {
      // vss not pre-installed; checkpoint without HNSW
    }
    await conn.run("CHECKPOINT;");
  } finally {
    conn.closeSync();
  }
}

export async function searchScenes(
  campaignPath: string,
  query: string,
  k?: number,
): Promise<Scene[]> {
  const limit = k ?? 5;

  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme, quality_notes,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM scenes
       ORDER BY score DESC
       LIMIT ?`,
      [limit],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
      quality_notes: row["quality_notes"] != null ? String(row["quality_notes"]) : undefined,
      score:
        typeof row["score"] === "number"
          ? row["score"]
          : typeof row["score"] === "bigint"
            ? Number(row["score"])
            : undefined,
    }));
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Recent scenes — chronological (oldest-first) for session briefing
// ---------------------------------------------------------------------------

export interface RecentSceneSummary {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
}

/**
 * Return the N most recent scenes ordered oldest-first (chronological).
 * Unlike searchScenes (semantic/similarity order), this is time-ordered
 * so session briefings present events in the correct narrative sequence.
 */
export async function getRecentScenesChronological(
  campaignPath: string,
  k: number = 5,
): Promise<RecentSceneSummary[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    // Fetch the k most recent by timestamp DESC, then reverse to oldest-first
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind
       FROM (
         SELECT id, text, timestamp, kind
         FROM scenes
         ORDER BY timestamp DESC
         LIMIT ?
       ) sub
       ORDER BY timestamp ASC`,
      [k],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
    }));
  } finally {
    conn.closeSync();
  }
}

export interface ComplicationScene {
  summary: string;
  complication_theme: string;
  kind: string;
  timestamp: string;
}

/**
 * Count how many scenes since `sinceTimestamp` contain a case-insensitive mention of `npcName`.
 * Throws if the DB is unavailable — callers should .catch(() => 0) for graceful degradation.
 */
export async function countScenesMentioningNpc(
  campaignPath: string,
  npcName: string,
  sinceTimestamp: string,
): Promise<number> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt
       FROM scenes
       WHERE timestamp > ?
         AND lower(text) LIKE ?`,
      [sinceTimestamp, `%${npcName.toLowerCase()}%`],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return Number(rows[0]?.["cnt"] ?? 0);
  } finally {
    conn.closeSync();
  }
}

export async function getRecentComplications(
  campaignPath: string,
  k: number = 5,
): Promise<ComplicationScene[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT text, complication_theme, kind, timestamp
       FROM scenes
       WHERE complication_theme IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT ?`,
      [k],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      summary: String(row["text"] ?? ""),
      complication_theme: String(row["complication_theme"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      timestamp: String(row["timestamp"] ?? ""),
    }));
  } finally {
    conn.closeSync();
  }
}
