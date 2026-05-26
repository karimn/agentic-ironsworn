import { DuckDBInstance } from "@duckdb/node-api";
import {
  getLoreDb,
  openLoreWriteConn,
  getLoreEmbedding,
  peekLoreDb,
} from "./lore-db.js";

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
  subject_kind: "entity" | "relation" | "proximity";
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
  community_id: string | null;
  relations: LoreRelation[];
}

export interface LinkLoreInput {
  from: string;
  to: string;
  relation: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  provenance?: ProvenanceInput;
  _created_at?: string;
  _skipRecordingProvenance?: boolean;
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
  _created_at?: string;
  _skipRecordingProvenance?: boolean;
}

export interface UpsertLoreResult {
  id: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
  const metadata = parseJsonObject(row["metadata"]);
  const communityRaw = metadata["community"];
  const community_id = typeof communityRaw === "string" && communityRaw.length > 0
    ? communityRaw
    : null;
  return {
    id: String(row["id"] ?? ""),
    canonical: String(row["canonical"] ?? ""),
    aliases,
    type: String(row["type"] ?? "concept") as LoreType,
    summary: String(row["summary"] ?? ""),
    content: parseJsonObject(row["content"]),
    metadata,
    community_id,
    relations: [],
  };
}

export async function recordProvenance(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  subjectKind: "entity" | "relation" | "proximity",
  subjectId: string,
  prov: ProvenanceInput | undefined,
  createdAtOverride?: string,
): Promise<void> {
  const effective: ProvenanceInput = prov ?? { source_kind: "manual" };
  const id = crypto.randomUUID();
  const now = createdAtOverride ?? new Date().toISOString();
  await conn.run(
    `INSERT INTO lore_provenance
       (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, subjectKind, subjectId, effective.source_kind, effective.source_id ?? null, effective.excerpt ?? null, effective.confidence ?? null, now],
  );
}

export async function upsertLore(
  campaignPath: string,
  input: UpsertLoreInput,
): Promise<UpsertLoreResult> {
  const id = input.id ?? slugify(input.canonical);
  if (id.length === 0) {
    throw new Error("Cannot derive lore ID from empty canonical name");
  }
  const [embedding, instance] = await Promise.all([
    getLoreEmbedding(input.summary),
    getLoreDb(campaignPath),
  ]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const now = input._created_at ?? new Date().toISOString();
  const contentJson = JSON.stringify(input.content ?? {});
  const conn = await openLoreWriteConn(instance);
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
      if (oldCanonical.length > 0 && oldCanonical.toLowerCase() !== input.canonical.toLowerCase()) {
        push(oldCanonical);
      }
      for (const a of incomingAliases) push(a);
      mergedAliases = acc;
      if (input.metadata !== undefined) {
        metadataJson = JSON.stringify(input.metadata);
      } else {
        metadataJson = typeof existing["metadata"] === "string" ? (existing["metadata"] as string) : "{}";
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
        `UPDATE lore_entities SET canonical = ?, aliases = ${aliasesLiteral}, type = ?, summary = ?,
           content = ?, metadata = ?, embedding = ${embeddingLiteral}, updated_at = ? WHERE id = ?`,
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
    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "entity", id, input.provenance, now);
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
    getLoreEmbedding(query),
    getLoreDb(campaignPath),
  ]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const conn = await instance.connect();
  try {
    const sql = type
      ? `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities WHERE type = ? ORDER BY score DESC LIMIT ?`
      : `SELECT id, canonical, type, summary,
                array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
         FROM lore_entities ORDER BY score DESC LIMIT ?`;
    const params = type ? [type, k] : [k];
    const result = await conn.runAndReadAll(sql, params);
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      canonical: String(row["canonical"] ?? ""),
      type: String(row["type"] ?? "concept") as LoreType,
      summary: String(row["summary"] ?? ""),
      score: typeof row["score"] === "number" ? row["score"]
        : typeof row["score"] === "bigint" ? Number(row["score"]) : Number.NaN,
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
     WHERE lower(id) = ? OR lower(canonical) = ?
        OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?)
     ORDER BY id LIMIT 1`,
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
  const instance = await getLoreDb(campaignPath);
  const conn = await openLoreWriteConn(instance);
  try {
    const fromId = await resolveId(conn, input.from);
    const toId = await resolveId(conn, input.to);
    const now = input._created_at ?? new Date().toISOString();
    const overwriteMetadata = input.metadata !== undefined;
    const metadataJson = JSON.stringify(input.metadata ?? {});
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
    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "relation", `${fromId}|${toId}|${input.relation}`, input.provenance, now);
    }
    return { from_id: fromId, to_id: toId, relation: input.relation };
  } finally {
    conn.closeSync();
  }
}

export interface LoreGraph {
  root: LoreEntity;
  nodes: LoreEntity[];
  edges: Array<{
    from_id: string;
    to_id: string;
    relation: string;
    notes?: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function getLoreGraph(
  campaignPath: string,
  identifier: string,
  depth = 1,
): Promise<LoreGraph | null> {
  if (depth < 1) throw new Error("getLoreGraph depth must be >= 1");
  const root = await getLore(campaignPath, identifier);
  if (root === null) return null;
  const instance = await getLoreDb(campaignPath);
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
         FROM lore_relations WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
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
          edges.push({ from_id: fromId, to_id: toId, relation, notes, metadata: parseJsonObject(row["metadata"]) });
        }
        for (const id of [fromId, toId]) {
          if (!visited.has(id)) { visited.add(id); next.add(id); }
        }
      }
      frontier = next;
    }
    const allIds = Array.from(visited);
    const placeholders = allIds.map(() => "?").join(",");
    const nodesResult = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content, metadata FROM lore_entities WHERE id IN (${placeholders})`,
      allIds,
    );
    const nodes = (nodesResult.getRowObjectsJS() as Record<string, unknown>[]).map(rowToEntity);
    return { root, nodes, edges };
  } finally {
    conn.closeSync();
  }
}

export async function getLore(
  campaignPath: string,
  identifier: string,
): Promise<LoreEntity | null> {
  const instance = await getLoreDb(campaignPath);
  const needle = identifier.toLowerCase();
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content, metadata
       FROM lore_entities
       WHERE lower(id) = ? OR lower(canonical) = ?
          OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?)
       ORDER BY id LIMIT 1`,
      [needle, needle, needle],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const entity = rowToEntity(rows[0]);
    const outgoing = await conn.runAndReadAll(
      `SELECT r.relation, r.notes, r.metadata,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r JOIN lore_entities e ON e.id = r.to_id WHERE r.from_id = ?`,
      [entity.id],
    );
    const incoming = await conn.runAndReadAll(
      `SELECT r.relation, r.notes, r.metadata,
              e.id AS other_id, e.canonical AS other_canonical, e.type AS other_type
       FROM lore_relations r JOIN lore_entities e ON e.id = r.from_id WHERE r.to_id = ?`,
      [entity.id],
    );
    const relations: LoreRelation[] = [];
    for (const row of outgoing.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "from",
        relation: String(row["relation"]),
        entity: { id: String(row["other_id"]), canonical: String(row["other_canonical"]), type: String(row["other_type"]) as LoreType },
        notes: row["notes"] ? String(row["notes"]) : undefined,
        metadata: parseJsonObject(row["metadata"]),
      });
    }
    for (const row of incoming.getRowObjectsJS() as Record<string, unknown>[]) {
      relations.push({
        direction: "to",
        relation: String(row["relation"]),
        entity: { id: String(row["other_id"]), canonical: String(row["other_canonical"]), type: String(row["other_type"]) as LoreType },
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
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at
       FROM lore_provenance WHERE subject_kind = ? AND subject_id = ? ORDER BY created_at ASC`,
      [subjectKind, subjectId],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]),
      subject_kind: String(row["subject_kind"]) as "entity" | "relation",
      subject_id: String(row["subject_id"]),
      source_kind: String(row["source_kind"]),
      source_id: row["source_id"] ? String(row["source_id"]) : null,
      excerpt: row["excerpt"] ? String(row["excerpt"]) : null,
      confidence: typeof row["confidence"] === "number" ? row["confidence"]
        : typeof row["confidence"] === "bigint" ? Number(row["confidence"]) : null,
      created_at: String(row["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}

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
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const entRows = (await conn.runAndReadAll(
      `SELECT id, canonical, aliases, type, summary, content, metadata, created_at, updated_at FROM lore_entities ORDER BY created_at`,
    )).getRowObjectsJS() as Record<string, unknown>[];
    const relRows = (await conn.runAndReadAll(
      `SELECT from_id, to_id, relation, notes, metadata, created_at FROM lore_relations ORDER BY created_at`,
    )).getRowObjectsJS() as Record<string, unknown>[];
    return {
      entities: entRows.map((r) => ({
        id: String(r["id"]),
        canonical: String(r["canonical"]),
        aliases: Array.isArray(r["aliases"]) ? (r["aliases"] as unknown[]).map(String) : [],
        type: String(r["type"]),
        summary: String(r["summary"]),
        content: JSON.parse(typeof r["content"] === "string" ? r["content"] : "{}") as Record<string, unknown>,
        metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
        created_at: String(r["created_at"]),
        updated_at: String(r["updated_at"]),
      })),
      relations: relRows.map((r) => ({
        from_id: String(r["from_id"]),
        to_id: String(r["to_id"]),
        relation: String(r["relation"]),
        notes: r["notes"] != null ? String(r["notes"]) : undefined,
        metadata: JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}") as Record<string, unknown>,
        created_at: String(r["created_at"]),
      })),
    };
  } finally {
    conn.closeSync();
  }
}

export async function exportProvenance(
  campaignPath: string,
): Promise<ProvenanceEntry[]> {
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const rows = (await conn.runAndReadAll(
      `SELECT id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at FROM lore_provenance ORDER BY created_at`,
    )).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      subject_kind: String(r["subject_kind"]) as "entity" | "relation" | "proximity",
      subject_id: String(r["subject_id"]),
      source_kind: String(r["source_kind"]),
      source_id: r["source_id"] != null ? String(r["source_id"]) : null,
      excerpt: r["excerpt"] != null ? String(r["excerpt"]) : null,
      confidence: typeof r["confidence"] === "number" ? r["confidence"] : null,
      created_at: String(r["created_at"]),
    }));
  } finally {
    conn.closeSync();
  }
}

export async function replayProvenance(
  campaignPath: string,
  entry: ProvenanceEntry,
): Promise<void> {
  const instance = await getLoreDb(campaignPath);
  const conn = await openLoreWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO lore_provenance (id, subject_kind, subject_id, source_kind, source_id, excerpt, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [entry.id, entry.subject_kind, entry.subject_id, entry.source_kind, entry.source_id, entry.excerpt, entry.confidence, entry.created_at],
    );
  } finally {
    conn.closeSync();
  }
}

export async function checkpointLore(campaignPath: string): Promise<void> {
  const cached = peekLoreDb(campaignPath);
  if (cached === undefined) return;
  const instance = await cached;
  const conn = await instance.connect();
  try {
    try { await conn.run("LOAD vss;"); } catch { /* vss not pre-installed */ }
    await conn.run("CHECKPOINT;");
  } finally {
    conn.closeSync();
  }
}
