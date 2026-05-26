import { createHash } from "node:crypto";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import seedrandom from "seedrandom";
import Anthropic from "@anthropic-ai/sdk";
import { getLoreDb, openLoreWriteConn, getLoreEmbedding } from "./lore-db.js";

export interface SummarizerEntity {
  id: string;
  canonical: string;
  type: string;
  summary: string;
}

export interface SummarizerRelation {
  from_id: string;
  to_id: string;
  relation: string;
  notes?: string;
}

export interface SummarizerInput {
  community_id: string;
  level: number;
  members: SummarizerEntity[];
  internal_relations: SummarizerRelation[];
  child_summaries: { id: string; summary: string; member_count: number }[];
}

export type Summarizer = (input: SummarizerInput) => Promise<string>;
export type Embedder = (text: string) => Promise<number[]>;

export interface RecomputeOptions {
  seed?: number;
  resolution?: number;
  maxLevel?: number;
  metaGraphMinSize?: number;
  summarizer?: Summarizer;
  embedder?: Embedder;
  skipEmbeddings?: boolean;
}

export interface RecomputeReport {
  levels: number;
  communities_total: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  llm_calls: number;
  embed_calls: number;
  ms: number;
}

export interface CommunityListItem {
  id: string;
  level: number;
  parent_id: string | null;
  member_count: number;
  summary: string;
}

export interface CommunityDetail extends CommunityListItem {
  member_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CommunitySearchHit {
  id: string;
  level: number;
  parent_id: string | null;
  member_count: number;
  summary: string;
  score: number;
}

export function stableCommunityId(level: number, memberIds: string[]): string {
  const sorted = [...memberIds].sort();
  return createHash("sha256")
    .update(`${level}:${sorted.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

interface BuiltCommunity {
  id: string;
  level: number;
  parent_id: string | null;
  member_ids: string[];
  member_count: number;
}

export function clusterGraph(
  entities: { id: string }[],
  relations: { from_id: string; to_id: string }[],
  opts: { seed?: number; resolution?: number; maxLevel?: number; metaGraphMinSize?: number } = {},
): BuiltCommunity[] {
  const seed = opts.seed ?? 1;
  const resolution = opts.resolution ?? 1;
  const maxLevel = opts.maxLevel ?? 4;
  const metaGraphMinSize = opts.metaGraphMinSize ?? 4;
  if (entities.length === 0) return [];
  const base = new Graph({ type: "undirected", multi: false });
  const entityIds = new Set(entities.map((e) => e.id));
  for (const ent of entities) base.addNode(ent.id);
  for (const rel of relations) {
    if (rel.from_id === rel.to_id) continue;
    if (!entityIds.has(rel.from_id) || !entityIds.has(rel.to_id)) continue;
    if (base.hasEdge(rel.from_id, rel.to_id)) {
      const cur = base.getEdgeAttribute(rel.from_id, rel.to_id, "weight") as number;
      base.setEdgeAttribute(rel.from_id, rel.to_id, "weight", cur + 1);
    } else {
      base.addEdge(rel.from_id, rel.to_id, { weight: 1 });
    }
  }
  const built: BuiltCommunity[] = [];
  let currentGraph = base;
  let nodeIsEntity = true;
  let nodeEntityCount = new Map<string, number>(entities.map((e) => [e.id, 1] as const));
  for (let level = 0; level < maxLevel; level++) {
    if (currentGraph.order === 0) break;
    let assignment: Record<string, number>;
    if (currentGraph.size === 0) {
      assignment = {};
      let i = 0;
      currentGraph.forEachNode((n) => { assignment[n] = i++; });
    } else {
      const rng = seedrandom(`${seed}:${level}`, { global: false });
      assignment = louvain(currentGraph, { getEdgeWeight: "weight", resolution, rng });
    }
    const groups = new Map<number, string[]>();
    for (const [node, cluster] of Object.entries(assignment)) {
      const arr = groups.get(cluster);
      if (arr) arr.push(node);
      else groups.set(cluster, [node]);
    }
    const newCommunities: BuiltCommunity[] = [];
    const nodeToCommunityId = new Map<string, string>();
    for (const memberNodes of groups.values()) {
      const id = stableCommunityId(level, memberNodes);
      const member_count = memberNodes.reduce((sum, n) => sum + (nodeEntityCount.get(n) ?? 0), 0);
      newCommunities.push({ id, level, parent_id: null, member_ids: memberNodes.slice().sort(), member_count });
      for (const n of memberNodes) nodeToCommunityId.set(n, id);
    }
    if (!nodeIsEntity) {
      for (const prev of built) {
        if (prev.level === level - 1) {
          const parent = nodeToCommunityId.get(prev.id);
          if (parent !== undefined) prev.parent_id = parent;
        }
      }
    }
    built.push(...newCommunities);
    if (newCommunities.length <= 1) break;
    if (newCommunities.length <= metaGraphMinSize && level + 1 >= maxLevel - 1) break;
    const metaGraph = new Graph({ type: "undirected", multi: false });
    for (const c of newCommunities) metaGraph.addNode(c.id);
    currentGraph.forEachEdge((_edge, attrs, source, target) => {
      const a = nodeToCommunityId.get(source);
      const b = nodeToCommunityId.get(target);
      if (a === undefined || b === undefined || a === b) return;
      const w = (attrs["weight"] as number | undefined) ?? 1;
      if (metaGraph.hasEdge(a, b)) {
        const cur = metaGraph.getEdgeAttribute(a, b, "weight") as number;
        metaGraph.setEdgeAttribute(a, b, "weight", cur + w);
      } else {
        metaGraph.addEdge(a, b, { weight: w });
      }
    });
    if (metaGraph.size === 0 && newCommunities.length > 1) break;
    nodeEntityCount = new Map(newCommunities.map((c) => [c.id, c.member_count] as const));
    currentGraph = metaGraph;
    nodeIsEntity = false;
  }
  const topLevel = built
    .filter((c) => c.parent_id === null)
    .reduce((max, c) => Math.max(max, c.level), 0);
  const orphans = built.filter((c) => c.parent_id === null && c.level === topLevel);
  if (orphans.length > 1) {
    const rootLevel = topLevel + 1;
    const rootId = stableCommunityId(rootLevel, orphans.map((o) => o.id));
    const rootCount = orphans.reduce((s, o) => s + o.member_count, 0);
    for (const o of orphans) o.parent_id = rootId;
    built.push({ id: rootId, level: rootLevel, parent_id: null, member_ids: orphans.map((o) => o.id).sort(), member_count: rootCount });
  }
  return built;
}

let _anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropicClient !== null) return _anthropicClient;
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || apiKey.length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required for the default community summarizer. Set it in the env, or pass a custom `summarizer` to recomputeCommunities.");
  }
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

const DEFAULT_SUMMARY_MODEL = process.env["SCRIBE_SUMMARY_MODEL"] ?? "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  "You are summarizing a thematic cluster of entities from a solo RPG " +
  "campaign for retrieval-augmented generation. Write 2-4 sentences capturing " +
  "the cluster's central theme, the key actors involved, and how the cluster " +
  "connects to the broader story. Do not list every member. Do not invent " +
  "facts beyond what is provided. Return only the summary text.";

function formatLeafPrompt(input: SummarizerInput): string {
  const lines: string[] = [];
  lines.push(`Cluster id: ${input.community_id} (level 0, ${input.members.length} entities)`);
  lines.push("");
  lines.push("Members:");
  for (const m of input.members) lines.push(`- [${m.type}] ${m.canonical}: ${m.summary}`);
  if (input.internal_relations.length > 0) {
    lines.push("");
    lines.push("Internal relations:");
    for (const r of input.internal_relations) {
      const note = r.notes ? ` (${r.notes})` : "";
      lines.push(`- ${r.from_id} —[${r.relation}]→ ${r.to_id}${note}`);
    }
  }
  return lines.join("\n");
}

function formatParentPrompt(input: SummarizerInput): string {
  const lines: string[] = [];
  lines.push(
    `Cluster id: ${input.community_id} (level ${input.level}, ` +
    `${input.child_summaries.length} sub-clusters, ` +
    `${input.child_summaries.reduce((s, c) => s + c.member_count, 0)} entities)`,
  );
  lines.push("");
  lines.push("Sub-clusters:");
  for (const c of input.child_summaries) lines.push(`- (${c.member_count} entities) ${c.summary}`);
  return lines.join("\n");
}

export type AnthropicLike = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }) => Promise<{ content: { type: string; text?: string }[] }>;
  };
};

export function _makeDefaultSummarizer(client: AnthropicLike): Summarizer {
  return async (input) => {
    const prompt = input.level === 0 ? formatLeafPrompt(input) : formatParentPrompt(input);
    const response = await client.messages.create({
      model: DEFAULT_SUMMARY_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content
      .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
      .join("\n")
      .trim();
    if (text.length === 0) throw new Error("Empty summary returned by Anthropic");
    return text;
  };
}

async function defaultSummarizer(input: SummarizerInput): Promise<string> {
  return _makeDefaultSummarizer(getAnthropic())(input);
}

interface PersistedCommunity {
  id: string;
  level: number;
  parent_id: string | null;
  member_ids: string[];
  member_count: number;
  summary: string;
  has_embedding: boolean;
}

async function loadEntities(conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>): Promise<SummarizerEntity[]> {
  const result = await conn.runAndReadAll(`SELECT id, canonical, type, summary FROM lore_entities`);
  return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]), canonical: String(row["canonical"]), type: String(row["type"]), summary: String(row["summary"]),
  }));
}

async function loadRelations(conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>): Promise<SummarizerRelation[]> {
  const result = await conn.runAndReadAll(`SELECT from_id, to_id, relation, notes FROM lore_relations`);
  return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
    from_id: String(row["from_id"]), to_id: String(row["to_id"]), relation: String(row["relation"]), notes: row["notes"] != null ? String(row["notes"]) : undefined,
  }));
}

async function loadExistingCommunities(conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>): Promise<Map<string, PersistedCommunity>> {
  const result = await conn.runAndReadAll(
    `SELECT id, level, parent_id, member_ids, member_count, summary, embedding IS NOT NULL AS has_embedding FROM lore_communities`,
  );
  const out = new Map<string, PersistedCommunity>();
  for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
    const memberIdsRaw = row["member_ids"];
    const member_ids = Array.isArray(memberIdsRaw) ? memberIdsRaw.map(String) : [];
    out.set(String(row["id"]), {
      id: String(row["id"]), level: Number(row["level"]), parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_ids, member_count: Number(row["member_count"]), summary: String(row["summary"] ?? ""), has_embedding: Boolean(row["has_embedding"]),
    });
  }
  return out;
}

function arrayLiteral(values: string[]): string {
  if (values.length === 0) return `[]::TEXT[]`;
  return `[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;
}

function embeddingLiteral(vec: number[] | null): string {
  if (vec === null) return "NULL";
  return `[${vec.join(",")}]::FLOAT[768]`;
}

async function upsertCommunity(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>,
  c: BuiltCommunity, summary: string, embedding: number[] | null, now: string, isNew: boolean,
): Promise<void> {
  const memberIdsLit = arrayLiteral(c.member_ids);
  const embedLit = embeddingLiteral(embedding);
  if (isNew) {
    await conn.run(
      `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ${memberIdsLit}, ?, ?, ${embedLit}, '{}', ?, ?)`,
      [c.id, c.level, c.parent_id, c.member_count, summary, now, now],
    );
  } else {
    await conn.run(
      `UPDATE lore_communities SET level = ?, parent_id = ?, member_ids = ${memberIdsLit}, member_count = ?, summary = ?, embedding = ${embedLit}, updated_at = ? WHERE id = ?`,
      [c.level, c.parent_id, c.member_count, summary, now, c.id],
    );
  }
}

async function updateParentOnly(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>,
  id: string, parent_id: string | null, now: string,
): Promise<void> {
  await conn.run(`UPDATE lore_communities SET parent_id = ?, updated_at = ? WHERE id = ?`, [parent_id, now, id]);
}

async function writeEntityCommunities(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof getLoreDb>>["connect"]>>,
  entityToLeaf: Map<string, string>,
): Promise<void> {
  const ids = Array.from(entityToLeaf.keys());
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const result = await conn.runAndReadAll(
    `SELECT id, metadata FROM lore_entities WHERE id IN (${placeholders})`, ids,
  );
  for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
    const id = String(row["id"]);
    let parsed: Record<string, unknown> = {};
    if (typeof row["metadata"] === "string" && row["metadata"].length > 0) {
      try {
        const p = JSON.parse(row["metadata"]);
        if (p && typeof p === "object" && !Array.isArray(p)) parsed = p as Record<string, unknown>;
      } catch { /* fall through */ }
    }
    const newCommunity = entityToLeaf.get(id);
    if (parsed["community"] === newCommunity) continue;
    parsed["community"] = newCommunity;
    await conn.run(`UPDATE lore_entities SET metadata = ? WHERE id = ?`, [JSON.stringify(parsed), id]);
  }
}

export async function recomputeCommunities(
  campaignPath: string,
  opts: RecomputeOptions = {},
): Promise<RecomputeReport> {
  const start = Date.now();
  const summarizer = opts.summarizer ?? defaultSummarizer;
  const embedder = opts.embedder ?? getLoreEmbedding;
  const instance = await getLoreDb(campaignPath);
  const conn = await openLoreWriteConn(instance);
  try {
    const [entities, relations, existing] = await Promise.all([
      loadEntities(conn), loadRelations(conn), loadExistingCommunities(conn),
    ]);
    if (entities.length === 0) {
      if (existing.size > 0) await conn.run(`DELETE FROM lore_communities`);
      return { levels: 0, communities_total: 0, created: 0, updated: 0, unchanged: 0, deleted: existing.size, llm_calls: 0, embed_calls: 0, ms: Date.now() - start };
    }
    const built = clusterGraph(entities, relations, { seed: opts.seed, resolution: opts.resolution, maxLevel: opts.maxLevel, metaGraphMinSize: opts.metaGraphMinSize });
    const entityById = new Map(entities.map((e) => [e.id, e] as const));
    const summariesById = new Map<string, string>();
    let created = 0, updated = 0, unchanged = 0, llm_calls = 0, embed_calls = 0;
    const now = new Date().toISOString();
    const entityToLeaf = new Map<string, string>();
    for (const c of built) {
      if (c.level !== 0) continue;
      for (const member of c.member_ids) {
        if (entityById.has(member)) entityToLeaf.set(member, c.id);
      }
    }
    for (const c of built) {
      const prev = existing.get(c.id);
      if (prev !== undefined) {
        summariesById.set(c.id, prev.summary);
        if (prev.parent_id !== c.parent_id) { await updateParentOnly(conn, c.id, c.parent_id, now); updated++; }
        else { unchanged++; }
        continue;
      }
      let input: SummarizerInput;
      if (c.level === 0) {
        const memberSet = new Set(c.member_ids);
        const internal = relations.filter((r) => memberSet.has(r.from_id) && memberSet.has(r.to_id));
        const members = c.member_ids.map((id) => entityById.get(id)).filter((e): e is SummarizerEntity => e !== undefined);
        input = { community_id: c.id, level: 0, members, internal_relations: internal, child_summaries: [] };
      } else {
        const childSummaries = c.member_ids.map((cid) => {
          const child = built.find((b) => b.id === cid);
          return { id: cid, summary: summariesById.get(cid) ?? "", member_count: child?.member_count ?? 0 };
        });
        input = { community_id: c.id, level: c.level, members: [], internal_relations: [], child_summaries: childSummaries };
      }
      const summary = await summarizer(input);
      llm_calls++;
      summariesById.set(c.id, summary);
      let embedding: number[] | null = null;
      if (!opts.skipEmbeddings) {
        try { embedding = await embedder(summary); embed_calls++; } catch { /* best-effort */ }
      }
      await upsertCommunity(conn, c, summary, embedding, now, true);
      created++;
    }
    const builtIds = new Set(built.map((c) => c.id));
    let deleted = 0;
    for (const id of existing.keys()) {
      if (!builtIds.has(id)) { await conn.run(`DELETE FROM lore_communities WHERE id = ?`, [id]); deleted++; }
    }
    await writeEntityCommunities(conn, entityToLeaf);
    const levels = built.length === 0 ? 0 : Math.max(...built.map((c) => c.level)) + 1;
    return { levels, communities_total: built.length, created, updated, unchanged, deleted, llm_calls, embed_calls, ms: Date.now() - start };
  } finally { conn.closeSync(); }
}

export async function listCommunities(
  campaignPath: string,
  opts: { level?: number; parent_id?: string | null; limit?: number } = {},
): Promise<CommunityListItem[]> {
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.level !== undefined) { where.push(`level = ?`); params.push(opts.level); }
    if (opts.parent_id !== undefined) {
      if (opts.parent_id === null) where.push(`parent_id IS NULL`);
      else { where.push(`parent_id = ?`); params.push(opts.parent_id); }
    }
    const limit = Math.min(opts.limit ?? 100, 100);
    params.push(limit);
    const result = await conn.runAndReadAll(
      `SELECT id, level, parent_id, member_count, summary FROM lore_communities
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY level DESC, member_count DESC LIMIT ?`,
      params,
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]), level: Number(row["level"]), parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_count: Number(row["member_count"]), summary: String(row["summary"] ?? ""),
    }));
  } finally { conn.closeSync(); }
}

export async function getCommunity(campaignPath: string, id: string): Promise<CommunityDetail | null> {
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, level, parent_id, member_ids, member_count, summary, metadata, created_at, updated_at FROM lore_communities WHERE id = ?`,
      [id],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const row = rows[0];
    const memberIdsRaw = row["member_ids"];
    const member_ids = Array.isArray(memberIdsRaw) ? memberIdsRaw.map(String) : [];
    let metadata: Record<string, unknown> = {};
    if (typeof row["metadata"] === "string" && row["metadata"].length > 0) {
      try { const p = JSON.parse(row["metadata"]); if (p && typeof p === "object" && !Array.isArray(p)) metadata = p as Record<string, unknown>; } catch { /* ignore */ }
    }
    return {
      id: String(row["id"]), level: Number(row["level"]), parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_ids, member_count: Number(row["member_count"]), summary: String(row["summary"] ?? ""), metadata,
      created_at: String(row["created_at"]), updated_at: String(row["updated_at"]),
    };
  } finally { conn.closeSync(); }
}

export async function searchCommunities(
  campaignPath: string,
  query: string,
  k = 5,
  embedder: Embedder = getLoreEmbedding,
): Promise<CommunitySearchHit[]> {
  const limit = Math.min(Math.max(k, 1), 100);
  const embedding = await embedder(query);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, level, parent_id, member_count, summary,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM lore_communities ORDER BY score DESC NULLS LAST LIMIT ?`,
      [limit],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[])
      .map((row) => ({
        id: String(row["id"] ?? ""), level: Number(row["level"]), parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
        member_count: Number(row["member_count"]), summary: String(row["summary"] ?? ""),
        score: typeof row["score"] === "number" ? row["score"] : typeof row["score"] === "bigint" ? Number(row["score"]) : Number.NaN,
      }))
      .filter((hit) => Number.isFinite(hit.score));
  } finally { conn.closeSync(); }
}
