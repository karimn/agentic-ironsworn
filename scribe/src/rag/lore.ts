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

export type LoreType =
  | "material"
  | "faction"
  | "place"
  | "concept"
  | "creature"
  | "event"
  | "truth";

export interface LoreRelation {
  direction: "from" | "to";
  relation: string;
  entity: { id: string; canonical: string; type: LoreType };
  notes?: string;
}

export interface LoreEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: LoreType;
  summary: string;
  content: Record<string, unknown>;
  relations: LoreRelation[];
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
}

export interface UpsertLoreInput {
  id?: string;
  canonical: string;
  type: LoreType;
  summary: string;
  content?: Record<string, unknown>;
  aliases?: string[];
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
// Row mapping helper
// ---------------------------------------------------------------------------

function rowToEntity(row: Record<string, unknown>): LoreEntity {
  const aliasesRaw = row["aliases"];
  const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.map(String) : [];

  let content: Record<string, unknown> = {};
  const contentRaw = row["content"];
  if (typeof contentRaw === "string" && contentRaw.length > 0) {
    try {
      content = JSON.parse(contentRaw) as Record<string, unknown>;
    } catch {
      content = {};
    }
  }

  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content,
    relations: [],  // populated by getLore after this; non-optional in the interface
  };
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

  const conn = await instance.connect();
  try {
    // Look up existing entity (if any)
    const existingResult = await conn.runAndReadAll(
      `SELECT canonical, aliases FROM lore_entities WHERE id = ?`,
      [id],
    );
    const existingRows = existingResult.getRowObjectsJS() as Record<string, unknown>[];
    const existing = existingRows[0];

    // Build the merged alias list
    const incomingAliases = input.aliases ?? [];
    let mergedAliases: string[];
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
        if (key === input.canonical.toLowerCase()) return; // never alias the canonical
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
    }

    const aliasesLiteral = `[${mergedAliases.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;

    if (existing) {
      await conn.run(
        `UPDATE lore_entities
         SET canonical = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
             content = ?, embedding = ${embeddingLiteral}, updated_at = ?
         WHERE id = ?`,
        [input.canonical, input.type, input.summary, contentJson, now, id],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_entities
           (id, canonical, aliases, type, summary, content, embedding, created_at, updated_at)
         VALUES (?, ?, ${aliasesLiteral}, ?, ?, ?, ${embeddingLiteral}, ?, ?)`,
        [id, input.canonical, input.type, input.summary, contentJson, now, now],
      );
    }

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
  const conn = await instance.connect();
  try {
    const fromId = await resolveId(conn, input.from);
    const toId = await resolveId(conn, input.to);
    const now = new Date().toISOString();

    await conn.run(
      `INSERT INTO lore_relations (from_id, to_id, relation, notes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (from_id, to_id, relation) DO NOTHING`,
      [fromId, toId, input.relation, input.notes ?? null, now],
    );

    return { from_id: fromId, to_id: toId, relation: input.relation };
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
      `SELECT id, canonical, aliases, type, summary, content
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
      `SELECT r.relation, r.notes,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r
       JOIN lore_entities e ON e.id = r.to_id
       WHERE r.from_id = ?`,
      [entity.id],
    );

    // Incoming
    const incoming = await conn.runAndReadAll(
      `SELECT r.relation, r.notes,
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
      });
    }

    entity.relations = relations;
    return entity;
  } finally {
    conn.closeSync();
  }
}
