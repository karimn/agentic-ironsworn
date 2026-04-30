import { DuckDBInstance } from "@duckdb/node-api";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

export function resolveDbPath(): string {
  const explicit = process.env["DB_PATH"];
  if (explicit) return explicit;

  const pluginRoot = process.env["SCRIBE_PLUGIN_ROOT"];
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "ironsworn.duckdb");
  }

  // Dev fallback: scribe/src/rag/ → scribe/src/ → scribe/ → plugin root
  const pluginRootFallback = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  return resolve(pluginRootFallback, "data", "ironsworn.duckdb");
}

// ---------------------------------------------------------------------------
// Lazy singleton DB instance
// ---------------------------------------------------------------------------

let _instancePromise: Promise<DuckDBInstance> | null = null;

function getInstance(): Promise<DuckDBInstance> {
  if (_instancePromise === null) {
    _instancePromise = DuckDBInstance.create(resolveDbPath(), { access_mode: "READ_ONLY" });
  }
  return _instancePromise;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QueryOptions {
  k?: number;
  contentType?: string;
}

export interface ChunkResult {
  id: string;
  text: string;
  headingPath: string[];
  contentType: string;
  moveTrigger: string;
  page: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (v === null || v === undefined ? "" : String(v)));
  }
  return [];
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

async function getEmbedding(query: string): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: query }),
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(`Ollama unavailable at ${OLLAMA_BASE_URL}: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { embeddings: number[][] };

  if (!data.embeddings || !Array.isArray(data.embeddings[0])) {
    throw new Error("Unexpected Ollama response shape");
  }

  if (data.embeddings[0].length !== 768) {
    throw new Error(`Expected 768-dim embedding, got ${data.embeddings[0].length}`);
  }

  if (!data.embeddings[0].every((v) => typeof v === "number" && isFinite(v))) {
    throw new Error("Invalid embedding values from Ollama");
  }

  return data.embeddings[0];
}

// ---------------------------------------------------------------------------
// RRF merge
// ---------------------------------------------------------------------------

interface ScoredRow {
  id: string;
  text: string;
  headingPath: string[];
  contentType: string;
  moveTrigger: string;
  page: string;
}

function mergeRRF(
  vectorRows: ScoredRow[],
  bm25Rows: ScoredRow[],
  k: number,
): ChunkResult[] {
  const RRF_K = 60;
  const scores = new Map<string, number>();
  const rowMap = new Map<string, ScoredRow>();

  for (const [rank, row] of vectorRows.entries()) {
    const current = scores.get(row.id) ?? 0;
    scores.set(row.id, current + 1 / (RRF_K + rank + 1));
    if (!rowMap.has(row.id)) rowMap.set(row.id, row);
  }

  for (const [rank, row] of bm25Rows.entries()) {
    const current = scores.get(row.id) ?? 0;
    scores.set(row.id, current + 1 / (RRF_K + rank + 1));
    if (!rowMap.has(row.id)) rowMap.set(row.id, row);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, score]) => {
      const row = rowMap.get(id)!;
      return {
        id: row.id,
        text: row.text,
        headingPath: row.headingPath,
        contentType: row.contentType,
        moveTrigger: row.moveTrigger,
        page: row.page,
        score,
      };
    });
}

// ---------------------------------------------------------------------------
// Query runner
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>;

function rowToScoredRow(row: RawRow): ScoredRow {
  return {
    id: toStr(row["id"]),
    text: toStr(row["text"]),
    headingPath: toStringArray(row["heading_path"]),
    contentType: toStr(row["content_type"]),
    moveTrigger: toStr(row["move_trigger"]),
    page: toStr(row["page"]),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchRules(
  query: string,
  opts?: QueryOptions,
): Promise<ChunkResult[]> {
  const k = opts?.k ?? 5;
  const candidates = k * 3;

  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getInstance(),
  ]);

  const conn = await instance.connect();

  try {
    // Vector search
    const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

    const vectorSql = opts?.contentType
      ? `SELECT id, text, heading_path, content_type, move_trigger, page,
               array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM chunks
         WHERE content_type = ?
         ORDER BY score DESC
         LIMIT ?`
      : `SELECT id, text, heading_path, content_type, move_trigger, page,
               array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM chunks
         ORDER BY score DESC
         LIMIT ?`;

    const vectorResult = await conn.runAndReadAll(
      vectorSql,
      opts?.contentType ? [opts.contentType, candidates] : [candidates],
    );
    const vectorRows = (vectorResult.getRowObjectsJS() as RawRow[]).map(
      rowToScoredRow,
    );

    // BM25 FTS search
    const bm25Sql = opts?.contentType
      ? `SELECT id, text, heading_path, content_type, move_trigger, page,
               fts_main_chunks.match_bm25(id, ?) AS score
         FROM chunks
         WHERE fts_main_chunks.match_bm25(id, ?) IS NOT NULL
           AND content_type = ?
         ORDER BY score DESC
         LIMIT ?`
      : `SELECT id, text, heading_path, content_type, move_trigger, page,
               fts_main_chunks.match_bm25(id, ?) AS score
         FROM chunks
         WHERE fts_main_chunks.match_bm25(id, ?) IS NOT NULL
         ORDER BY score DESC
         LIMIT ?`;

    const bm25Result = await conn.runAndReadAll(
      bm25Sql,
      opts?.contentType
        ? [query, query, opts.contentType, candidates]
        : [query, query, candidates],
    );
    const bm25Rows = (bm25Result.getRowObjectsJS() as RawRow[]).map(
      rowToScoredRow,
    );

    return mergeRRF(vectorRows, bm25Rows, k);
  } finally {
    conn.closeSync();
  }
}

export async function lookupMove(name: string): Promise<ChunkResult | null> {
  const instance = await getInstance();
  const conn = await instance.connect();

  try {
    const SCORE_THRESHOLD = 1.0;
    const sql = `SELECT * FROM (
                   SELECT id, text, heading_path, content_type, move_trigger, page,
                          fts_main_chunks.match_bm25(id, ?) AS score
                   FROM chunks
                   WHERE fts_main_chunks.match_bm25(id, ?) IS NOT NULL
                     AND content_type = 'move'
                   ORDER BY score DESC
                   LIMIT 1
                 ) WHERE score > ?`;

    const result = await conn.runAndReadAll(sql, [name, name, SCORE_THRESHOLD]);
    const rows = result.getRowObjectsJS() as RawRow[];

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: toStr(row["id"]),
      text: toStr(row["text"]),
      headingPath: toStringArray(row["heading_path"]),
      contentType: toStr(row["content_type"]),
      moveTrigger: toStr(row["move_trigger"]),
      page: toStr(row["page"]),
      score: toNum(row["score"]),
    };
  } finally {
    conn.closeSync();
  }
}
