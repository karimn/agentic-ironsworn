import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const LORE_TYPES = [
  "material",
  "faction",
  "place",
  "concept",
  "creature",
  "event",
  "truth",
] as const;

export type LoreType = (typeof LORE_TYPES)[number];

export interface ProvenanceInput {
  source_kind: "manual" | "scene" | "document" | "extraction";
  source_id?: string;
  excerpt?: string;
  confidence?: number;
}

export interface ProvenanceEntry {
  id: string;
  subject_kind: "entity" | "relation";
  subject_id: string;
  source_kind: string;
  source_id: string | null;
  excerpt: string | null;
  confidence: number | null;
  created_at: string;
}

export interface LoreRelation {
  direction: "from" | "to";
  relation: string;
  entity: { id: string; canonical: string; type: LoreType };
  notes?: string;
  metadata: Record<string, unknown>;
}

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  relations: LoreRelation[];
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  provenance?: ProvenanceInput;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  aliases?: string[];
  provenance?: ProvenanceInput;
}

export interface UpsertLoreResult {
  id: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Lazy per-campaign DB cache
// ---------------------------------------------------------------------------

const _dbPromises = new Map<string, Promise<DuckDBInstance>>();

async function initDb(campaignPath: string): Promise<DuckDBInstance> {
  await mkdir(campaignPath, { recursive: true });

  const instance = await DuckDBInstance.create(`${campaignPath}/lore.duckdb`);

  const conn = await instance.connect();
  try {
    await conn.run("INSTALL vss;");
    await conn.run("LOAD vss;");
    // HNSW persistence is gated behind an experimental flag in DuckDB. Without
    // this, HNSW indexes can only be built on in-memory databases — which fails
    // the moment we try to persist lore to a campaign directory.
    await conn.run("SET hnsw_enable_experimental_persistence = true;");

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_entities (
        id         TEXT PRIMARY KEY,
        canonical  TEXT NOT NULL,
        aliases    TEXT[] NOT NULL DEFAULT [],
        type       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '{}',
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768] NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_embedding_idx
      ON lore_entities USING HNSW (embedding)
      WITH (metric = 'cosine')
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_relations (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        relation   TEXT NOT NULL,
        notes      TEXT,
        metadata   TEXT NOT NULL DEFAULT '{}',
        embedding  FLOAT[768],
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation)
      )
    `);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS lore_provenance (
        id           TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id   TEXT NOT NULL,
        source_kind  TEXT NOT NULL,
        source_id    TEXT,
        excerpt      TEXT,
        confidence   FLOAT,
        created_at   TEXT NOT NULL
      )
    `);

    await conn.run(`
      CREATE INDEX IF NOT EXISTS lore_provenance_subject_idx
      ON lore_provenance (subject_kind, subject_id)
    `);
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

// DuckDB's hnsw_enable_experimental_persistence flag is connection-scoped, not
// database-scoped. The initDb connection sets it, but every subsequent write
// connection opens fresh without it — causing "Duplicate keys not allowed in
// high-level wrappers" when DuckDB tries to replay buffered HNSW index appends.
// Every connection that writes to an HNSW-indexed table must set this flag.
async function openWriteConn(
  instance: DuckDBInstance,
): Promise<Awaited<ReturnType<DuckDBInstance["connect"]>>> {
  const conn = await instance.connect();
  await conn.run("SET hnsw_enable_experimental_persistence = true;");
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
// Row mapping helpers
// ---------------------------------------------------------------------------

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];

  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content: parseJsonObject(row["content"]),
    metadata: parseJsonObject(row["metadata"]),
    relations: [],  // populated by getLore after this; non-optional in the interface
  };
}

// ---------------------------------------------------------------------------
// Provenance helper
// ---------------------------------------------------------------------------

async function recordProvenance(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  subjectKind: "entity" | "relation",
  subjectId: string,
  prov: ProvenanceInput | undefined,
): Promise<void> {
  const effective: ProvenanceInput = prov ?? { source_kind: "manual" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO lore_provenance
       (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      subjectKind,
      subjectId,
      effective.source_kind,
      effective.source_id ?? null,
      effective.excerpt ?? null,
      effective.confidence ?? null,
      now,
    ],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }

  const [embedding, instance] = await Promise.all([
    getEmbedding(input.summary),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});

  const conn = await openWriteConn(instance);
  try {
    const existingResult = await conn.runAndReadAll(
      `SELECT canonical, aliases, metadata FROM lore_entities WHERE id = ?`,
      [id],
    );
    const existingRows = existingResult.getRowObjectsJS() as Record<string, unknown>[];
    const existing = existingRows[0];

    const incomingAliases = input.aliases ?? [];
    let mergedAliases: string[];
    let metadataJson: string;
    let updated = false;

    if (existing) {
      updated = true;
      const oldCanonical = String(existing["canonical"] ?? "");
      const oldAliases = Array.isArray(existing["aliases"])
        ? (existing["aliases"] as unknown[]).map(String)
        : [];

      const seen = new Set<string>();
      const acc: string[] = [];
      const push = (name: string) => {
        const key = name.toLowerCase();
        if (key.length === 0) return;
        if (key === input.canonical.toLowerCase()) return;
        if (seen.has(key)) return;
        seen.add(key);
        acc.push(name);
      };
      for (const a of oldAliases) push(a);
      if (
        oldCanonical.length > 0 &&
        oldCanonical.toLowerCase() !== input.canonical.toLowerCase()
      ) {
        push(oldCanonical);
      }
      for (const a of incomingAliases) push(a);
      mergedAliases = acc;

      // Metadata: incoming wins if provided; otherwise preserve existing.
      if (input.metadata !== undefined) {
        metadataJson = JSON.stringify(input.metadata);
      } else {
        metadataJson = typeof existing["metadata"] === "string"
          ? (existing["metadata"] as string)
          : "{}";
      }
    } else {
      const seen = new Set<string>();
      mergedAliases = [];
      for (const a of incomingAliases) {
        const key = a.toLowerCase();
        if (key.length === 0 || key === input.canonical.toLowerCase()) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedAliases.push(a);
      }
      metadataJson = JSON.stringify(input.metadata ?? {});
    }

    const aliasesLiteral = `[${mergedAliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

    if (existing) {
      await conn.run(
        `UPDATE lore_entities
         SET canonical = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
             content = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ?
         WHERE id = ?`,
        [input.canonical, input.type, input.summary, contentJson, metadataJson, now, id],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_entities
           (id, canonical, aliases, type, summary, content, metadata, embedding, created_at, updated_at)
         VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
        [id, input.canonical, input.type, input.summary, contentJson, metadataJson, now, now],
      );
    }

    await recordProvenance(conn, "entity", id, input.provenance);

    return { id, canonical: input.canonical, aliases: mergedAliases, updated };
  } finally {
    conn.closeSync();
  }
}

export interface LoreSearchHit {
  id: string;
  canonical: string;
  type: LoreType;
  summary: string;
  score: number;
}

export async function searchLore(
  campaignPath: string,
  query: string,
  k = 5,
  type?: LoreType,
): Promise<LoreSearchHit[]> {
  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    const sql = type
      ? `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities
         WHERE type = ?
         ORDER BY score DESC
         LIMIT ?`
      : `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities
         ORDER BY score DESC
         LIMIT ?`;

    const params = type ? [type, k] : [k];
    const result = await conn.runAndReadAll(sql, params);
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      canonical: String(row["canonical"] ?? ""),
      type: String(row["type"] ?? "concept") as LoreType,
      summary: String(row["summary"] ?? ""),
      score:
        typeof row["score"] === "number"
          ? row["score"]
          : typeof row["score"] === "bigint"
            ? Number(row["score"])
            : Number.NaN,
    }));
  } finally {
    conn.closeSync();
  }
}

async function resolveId(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  identifier: string,
): Promise<string> {
  const needle = identifier.toLowerCase();
  const result = await conn.runAndReadAll(
    `SELECT id FROM lore_entities
     WHERE lower(id) = ?
        OR lower(canonical) = ?
        OR EXISTS (
             SELECT 1 FROM unnest(aliases) AS t(alias)
             WHERE lower(alias) = ?
           )
     ORDER BY id
     LIMIT 1`,
    [needle, needle, needle],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(`Lore entity not found: "${identifier}"`);
  }
  return String(rows[0]["id"]);
}

export async function linkLore(
  campaignPath: string,
  input: LinkLoreInput,
): Promise<{ from_id: string; to_id: string; relation: string }> {
  const instance = await getDb(campaignPath);
  const conn = await openWriteConn(instance);
  try {
    const fromId = await resolveId(conn, input.from);
    const toId = await resolveId(conn, input.to);
    const now = new Date().toISOString();
    const overwriteMetadata = input.metadata !== undefined;
    const metadataJson = JSON.stringify(input.metadata ?? {});

    // Symmetric with upsertLore: when caller omits metadata, preserve existing
    // on conflict. When caller supplies metadata (even {}), overwrite.
    const metadataConflictClause = overwriteMetadata
      ? "metadata = EXCLUDED.metadata"
      : "metadata = lore_relations.metadata";

    await conn.run(
      `INSERT INTO lore_relations (from_id, to_id, relation, notes, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, relation) DO UPDATE SET
         notes = COALESCE(EXCLUDED.notes, lore_relations.notes),
         ${metadataConflictClause}`,
      [fromId, toId, input.relation, input.notes ?? null, metadataJson, now],
    );

    // Provenance is treated as a history log: every linkLore call records
    // an entry, including no-op re-links where neither notes nor metadata
    // changed. listProvenance returns this full history. If a future
    // consumer needs only "facts that meaningfully changed", we can add a
    // dedup pass at the recordProvenance layer; for now, history wins.
    await recordProvenance(
      conn,
      "relation",
      `${fromId}|${toId}|${input.relation}`,
      input.provenance,
    );

    return { from_id: fromId, to_id: toId, relation: input.relation };
  } finally {
    conn.closeSync();
  }
}

export interface LoreGraph {
  root: LoreEntity;
  /**
   * All entities reachable within `depth` hops, including the root.
   * Note: `relations` on each node is always `[]` — use the `edges` array
   * for connectivity. To get a node's full relations, call `getLore` on it
   * separately.
   */
  nodes: LoreEntity[];
  edges: Array<{
    from_id: string;
    to_id: string;
    relation: string;
    notes?: string;
    metadata: Record<string, unknown>;
  }>;
}

/**
 * BFS expansion of edges from a root entity to a configurable depth.
 *
 * @param campaignPath  Per-campaign DB directory.
 * @param identifier    Root entity (id, canonical, or alias).
 * @param depth         Number of hops to traverse from the root. Default 1.
 * @returns The graph with root, all reachable nodes (relations field
 *          empty — see `LoreGraph.nodes`), and deduplicated edges.
 *          Returns null if the root cannot be resolved.
 * @throws  If `depth < 1`.
 */
export async function getLoreGraph(
  campaignPath: string,
  identifier: string,
  depth = 1,
): Promise<LoreGraph | null> {
  if (depth < 1) {
    throw new Error("getLoreGraph depth must be >= 1");
  }

  const root = await getLore(campaignPath, identifier);
  if (root === null) return null;

  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const visited = new Set<string>([root.id]);
    let frontier = new Set<string>([root.id]);
    const edges: LoreGraph["edges"] = [];

    for (let hop = 0; hop < depth; hop++) {
      if (frontier.size === 0) break;

      const placeholders = Array.from(frontier).map(() => "?").join(",");
      const params = Array.from(frontier);

      const result = await conn.runAndReadAll(
        `SELECT from_id, to_id, relation, notes, metadata
         FROM lore_relations
         WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
        [...params, ...params],
      );

      const next = new Set<string>();
      for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
        const fromId = String(row["from_id"]);
        const toId = String(row["to_id"]);
        const relation = String(row["relation"]);
        const notes = row["notes"] ? String(row["notes"]) : undefined;

        const edgeKey = `${fromId}|${toId}|${relation}`;
        if (!edges.some((e) => `${e.from_id}|${e.to_id}|${e.relation}` === edgeKey)) {
          edges.push({
            from_id: fromId,
            to_id: toId,
            relation,
            notes,
            metadata: parseJsonObject(row["metadata"]),
          });
        }

        for (const id of [fromId, toId]) {
          if (!visited.has(id)) {
            visited.add(id);
            next.add(id);
          }
        }
      }

      frontier = next;
    }

    // Fetch all visited entities (without their relations to keep payload small)
    const allIds = Array.from(visited);
    const placeholders = allIds.map(() => "?").join(",");
    const nodesResult = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content, metadata
       FROM lore_entities
       WHERE id IN (${placeholders})`,
      allIds,
    );
    const nodes = (nodesResult.getRowObjectsJS() as Record<string, unknown>[]).map(
      rowToEntity,
    );

    return { root, nodes, edges };
  } finally {
    conn.closeSync();
  }
}

export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getDb(campaignPath);
  const needle = identifier.toLowerCase();

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content, metadata
       FROM lore_entities
       WHERE lower(id) = ?
          OR lower(canonical) = ?
          OR EXISTS (
               SELECT 1 FROM unnest(aliases) AS t(alias)
               WHERE lower(alias) = ?
             )
       ORDER BY id
       LIMIT 1`,
      [needle, needle, needle],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;

    const entity = rowToEntity(rows[0]);

    // Outgoing
    const outgoing = await conn.runAndReadAll(
      `SELECT r.relation, r.notes, r.metadata,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r
       JOIN lore_entities e ON e.id = r.to_id
       WHERE r.from_id = ?`,
      [entity.id],
    );

    // Incoming
    const incoming = await conn.runAndReadAll(
      `SELECT r.relation, r.notes, r.metadata,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r
       JOIN lore_entities e ON e.id = r.from_id
       WHERE r.to_id = ?`,
      [entity.id],
    );

    const relations: LoreRelation[] = [];
    for (const row of outgoing.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "from",
        relation: String(row["relation"]),
        entity: {
          id: String(row["other_id"]),
          canonical: String(row["other_canonical"]),
          type: String(row["other_type"]) as LoreType,
        },
        notes: row["notes"] ? String(row["notes"]) : undefined,
        metadata: parseJsonObject(row["metadata"]),
      });
    }
    for (const row of incoming.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "to",
        relation: String(row["relation"]),
        entity: {
          id: String(row["other_id"]),
          canonical: String(row["other_canonical"]),
          type: String(row["other_type"]) as LoreType,
        },
        notes: row["notes"] ? String(row["notes"]) : undefined,
        metadata: parseJsonObject(row["metadata"]),
      });
    }

    entity.relations = relations;
    return entity;
  } finally {
    conn.closeSync();
  }
}

export async function listProvenance(
  campaignPath: string,
  subjectKind: "entity" | "relation",
  subjectId: string,
): Promise<ProvenanceEntry[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id,
              excerpt, confidence, created_at
       FROM lore_provenance
       WHERE subject_kind = ? AND subject_id = ?
       ORDER BY created_at ASC`,
      [subjectKind, subjectId],
    );

    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]),
      subject_kind: String(row["subject_kind"]) as "entity" | "relation",
      subject_id: String(row["subject_id"]),
      source_kind: String(row["source_kind"]),
      source_id: row["source_id"] ? String(row["source_id"]) : null,
      excerpt: row["excerpt"] ? String(row["excerpt"]) : null,
      confidence:
        typeof row["confidence"] === "number"
          ? row["confidence"]
          : typeof row["confidence"] === "bigint"
            ? Number(row["confidence"])
            : null,
      created_at: String(row["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Export / Import helpers
// ---------------------------------------------------------------------------

export interface LoreEntityExport {
  id: string;
  canonical: string;
  aliases: string[];
  type: string;
  summary: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LoreRelationExport {
  from_id: string;
  to_id: string;
  relation: string;
  notes?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function exportLore(
  campaignPath: string,
): Promise<{ entities: LoreEntityExport[]; relations: LoreRelationExport[] }> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const entRows = (
      await conn.runAndReadAll(
        `SELECT id, canonical, aliases, type, summary, content, metadata, created_at, updated_at
         FROM lore_entities ORDER BY created_at`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];

    const relRows = (
      await conn.runAndReadAll(
        `SELECT from_id, to_id, relation, notes, metadata, created_at
         FROM lore_relations ORDER BY created_at`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];

    const entities: LoreEntityExport[] = entRows.map((r) => ({
      id: String(r["id"]),
      canonical: String(r["canonical"]),
      aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
      type: String(r["type"]),
      summary: String(r["summary"]),
      content: JSON.parse(typeof r["content"] === "string" ? r["content"] : "{}") as Record<string, unknown>,
      metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
      created_at: String(r["created_at"]),
      updated_at: String(r["updated_at"]),
    }));

    const relations: LoreRelationExport[] = relRows.map((r) => ({
      from_id: String(r["from_id"]),
      to_id: String(r["to_id"]),
      relation: String(r["relation"]),
      notes: r["notes"] != null ? String(r["notes"]) : undefined,
      metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
      created_at: String(r["created_at"]),
    }));

    return { entities, relations };
  } finally {
    conn.closeSync();
  }
}
