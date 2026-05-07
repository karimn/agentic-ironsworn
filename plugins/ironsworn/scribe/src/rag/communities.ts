// GraphRAG community-detection layer for the lore knowledge graph (issue #57).
//
// This module is independent of the MCP server: the only public entry points
// (recomputeCommunities, listCommunities, getCommunity) accept all external
// dependencies — Anthropic client, embedder — as overrides so tests can run
// without LLM keys or Ollama. Defaults route to the same providers used by
// the rest of scribe (Claude for summaries, Ollama nomic-embed-text for
// embeddings).

import { createHash } from "node:crypto";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import seedrandom from "seedrandom";
import Anthropic from "@anthropic-ai/sdk";
import { _getLoreDb, _openLoreWriteConn, _getLoreEmbedding } from "./lore.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  /** Direct member entities (only populated for level 0). */
  members: SummarizerEntity[];
  /** Internal edges between members (only populated for level 0). */
  internal_relations: SummarizerRelation[];
  /** Child community summaries (only populated for level > 0). */
  child_summaries: { id: string; summary: string; member_count: number }[];
}

export type Summarizer = (input: SummarizerInput) => Promise<string>;
export type Embedder = (text: string) => Promise<number[]>;

export interface RecomputeOptions {
  /** Seed for the Louvain RNG so cluster assignments are reproducible. */
  seed?: number;
  /** Louvain resolution. Higher → more, smaller clusters. Default 1. */
  resolution?: number;
  /** Hard cap on hierarchy depth. Default 4. */
  maxLevel?: number;
  /** Stop recursing once the meta-graph has this many or fewer nodes. Default 4. */
  metaGraphMinSize?: number;
  /** Override the LLM that writes summaries. Defaults to Anthropic Claude. */
  summarizer?: Summarizer;
  /** Override the embedder. Defaults to Ollama nomic-embed-text. */
  embedder?: Embedder;
  /** Skip embedding step entirely (e.g. CI without Ollama). */
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
  /** Direct children: entity ids if level=0, child community ids if level>0. */
  member_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Stable IDs
// ---------------------------------------------------------------------------

/**
 * Compute a stable community id from its level and direct member ids.
 *
 * Member ids must be entity ids at level 0 and child community ids at higher
 * levels. Both are themselves stable (entity ids are slugified canonicals;
 * child community ids are recursive hashes), so the resulting community id
 * is deterministic across runs as long as membership doesn't change.
 *
 * 16 hex chars (64 bits) is plenty of namespace given typical campaign sizes
 * and keeps the id readable in MCP tool output.
 */
export function stableCommunityId(level: number, memberIds: string[]): string {
  const sorted = [...memberIds].sort();
  return createHash("sha256")
    .update(`${level}:${sorted.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// In-memory clustering
// ---------------------------------------------------------------------------

interface BuiltCommunity {
  id: string;
  level: number;
  parent_id: string | null;
  /** Direct children (entity ids at level 0; community ids at level > 0). */
  member_ids: string[];
  /** Transitive count of underlying entities. */
  member_count: number;
}

/**
 * Run hierarchical Louvain on the entity/relation graph.
 *
 * Builds a weighted undirected graph (edge weight = count of distinct relation
 * types between a pair of entities), runs Louvain, then collapses each cluster
 * into a meta-node and recurses on the meta-graph until the meta-graph is
 * trivial (≤ metaGraphMinSize nodes) or maxLevel is reached.
 *
 * If the top level still has multiple communities, a synthetic root community
 * is added so every non-singleton history has a single root rollup.
 *
 * Returns the full set of communities in topological order: leaves first,
 * root last. This is the order in which summaries should be generated so
 * each parent can reference its children's summaries.
 */
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

  // Build the base undirected weighted graph. Aggregate parallel edges
  // (multiple relation types between same pair) into a single weighted edge:
  // Louvain operates on weighted edges, not multigraphs.
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

  // Recursive clustering. At each level we keep a `currentGraph` whose nodes
  // are the previous level's communities and a `currentMembership[node] =>
  // community_id` map. The `built` array accumulates communities at every
  // level; parent links are set as we go up.
  const built: BuiltCommunity[] = [];
  let currentGraph = base;
  // node id in currentGraph -> community id at the level *below* (entity id
  // at level 0; child community id at higher levels)
  let nodeIsEntity = true;
  // Track per-node transitive entity count so meta-graph nodes know how many
  // entities they represent.
  let nodeEntityCount = new Map<string, number>(
    entities.map((e) => [e.id, 1] as const),
  );

  for (let level = 0; level < maxLevel; level++) {
    if (currentGraph.order === 0) break;

    // Edge case: a graph with no edges. Each node becomes its own community.
    let assignment: Record<string, number>;
    if (currentGraph.size === 0) {
      assignment = {};
      let i = 0;
      currentGraph.forEachNode((n) => { assignment[n] = i++; });
    } else {
      // Re-seed per level so each level has its own deterministic RNG stream.
      const rng = seedrandom(`${seed}:${level}`);
      assignment = louvain(currentGraph, {
        getEdgeWeight: "weight",
        resolution,
        rng,
      });
    }

    // Group nodes by assigned cluster index
    const groups = new Map<number, string[]>();
    for (const [node, cluster] of Object.entries(assignment)) {
      const arr = groups.get(cluster);
      if (arr) arr.push(node);
      else groups.set(cluster, [node]);
    }

    // Materialize community objects for this level
    const newCommunities: BuiltCommunity[] = [];
    const nodeToCommunityId = new Map<string, string>();
    for (const memberNodes of groups.values()) {
      const id = stableCommunityId(level, memberNodes);
      const member_count = memberNodes.reduce(
        (sum, n) => sum + (nodeEntityCount.get(n) ?? 0),
        0,
      );
      newCommunities.push({
        id,
        level,
        parent_id: null,
        member_ids: memberNodes.slice().sort(),
        member_count,
      });
      for (const n of memberNodes) nodeToCommunityId.set(n, id);
    }

    // Wire parent_id on the previous level (if any) into this level's communities.
    if (!nodeIsEntity) {
      // The nodes of currentGraph are themselves community ids from the
      // previous iteration. Each previous-level community's parent_id is the
      // new community it was placed into.
      for (const prev of built) {
        if (prev.level === level - 1) {
          const parent = nodeToCommunityId.get(prev.id);
          if (parent !== undefined) prev.parent_id = parent;
        }
      }
    }

    built.push(...newCommunities);

    // Stop early if Louvain found a single super-cluster — this *is* the root.
    if (newCommunities.length <= 1) break;
    // Stop if the next meta-graph would be trivially small
    if (newCommunities.length <= metaGraphMinSize && level + 1 >= maxLevel - 1) {
      // We'll handle the multi-root case below
      break;
    }

    // Build the meta-graph for the next iteration: nodes = newCommunities,
    // edges = aggregate weights between underlying clusters.
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

    // If the meta-graph has no edges, each remaining community is its own
    // top-level group. The synthetic-root path below handles this.
    if (metaGraph.size === 0 && newCommunities.length > 1) {
      // Don't recurse — a Louvain run with no edges just makes each community
      // its own cluster again, gaining nothing.
      break;
    }

    nodeEntityCount = new Map(newCommunities.map((c) => [c.id, c.member_count] as const));
    currentGraph = metaGraph;
    nodeIsEntity = false;
  }

  // Ensure a single root: if multiple communities at the top level remain
  // without a parent, wrap them in a synthetic root community so global queries
  // always have a single entry point.
  const topLevel = built
    .filter((c) => c.parent_id === null)
    .reduce((max, c) => Math.max(max, c.level), 0);
  const orphans = built.filter((c) => c.parent_id === null && c.level === topLevel);
  if (orphans.length > 1) {
    const rootLevel = topLevel + 1;
    const rootId = stableCommunityId(rootLevel, orphans.map((o) => o.id));
    const rootCount = orphans.reduce((s, o) => s + o.member_count, 0);
    for (const o of orphans) o.parent_id = rootId;
    built.push({
      id: rootId,
      level: rootLevel,
      parent_id: null,
      member_ids: orphans.map((o) => o.id).sort(),
      member_count: rootCount,
    });
  }

  return built;
}

// ---------------------------------------------------------------------------
// Default summarizer (Anthropic Claude)
// ---------------------------------------------------------------------------

let _anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropicClient !== null) return _anthropicClient;
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the default community summarizer. " +
        "Set it in the env, or pass a custom `summarizer` to recomputeCommunities.",
    );
  }
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

const DEFAULT_SUMMARY_MODEL =
  process.env["SCRIBE_SUMMARY_MODEL"] ?? "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT =
  "You are summarizing a thematic cluster of entities from a solo Ironsworn " +
  "campaign for retrieval-augmented generation. Write 2-4 sentences capturing " +
  "the cluster's central theme, the key actors involved, and how the cluster " +
  "connects to the broader story. Do not list every member. Do not invent " +
  "facts beyond what is provided. Return only the summary text.";

function formatLeafPrompt(input: SummarizerInput): string {
  const lines: string[] = [];
  lines.push(`Cluster id: ${input.community_id} (level 0, ${input.members.length} entities)`);
  lines.push("");
  lines.push("Members:");
  for (const m of input.members) {
    lines.push(`- [${m.type}] ${m.canonical}: ${m.summary}`);
  }
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
  for (const c of input.child_summaries) {
    lines.push(`- (${c.member_count} entities) ${c.summary}`);
  }
  return lines.join("\n");
}

// Minimal structural type for the Anthropic SDK so tests can inject a stub
// without depending on the real client. Any object matching this shape works,
// including the real `Anthropic` instance.
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
    if (text.length === 0) {
      throw new Error("Empty summary returned by Anthropic");
    }
    return text;
  };
}

async function defaultSummarizer(input: SummarizerInput): Promise<string> {
  return _makeDefaultSummarizer(getAnthropic())(input);
}

// ---------------------------------------------------------------------------
// DuckDB I/O
// ---------------------------------------------------------------------------

interface PersistedCommunity {
  id: string;
  level: number;
  parent_id: string | null;
  member_ids: string[];
  member_count: number;
  summary: string;
  has_embedding: boolean;
}

async function loadEntities(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
): Promise<SummarizerEntity[]> {
  const result = await conn.runAndReadAll(
    `SELECT id, canonical, type, summary FROM lore_entities`,
  );
  return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    canonical: String(row["canonical"]),
    type: String(row["type"]),
    summary: String(row["summary"]),
  }));
}

async function loadRelations(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
): Promise<SummarizerRelation[]> {
  const result = await conn.runAndReadAll(
    `SELECT from_id, to_id, relation, notes FROM lore_relations`,
  );
  return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
    from_id: String(row["from_id"]),
    to_id: String(row["to_id"]),
    relation: String(row["relation"]),
    notes: row["notes"] != null ? String(row["notes"]) : undefined,
  }));
}

async function loadExistingCommunities(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
): Promise<Map<string, PersistedCommunity>> {
  const result = await conn.runAndReadAll(
    `SELECT id, level, parent_id, member_ids, member_count, summary,
            embedding IS NOT NULL AS has_embedding
     FROM lore_communities`,
  );
  const out = new Map<string, PersistedCommunity>();
  for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
    const memberIdsRaw = row["member_ids"];
    const member_ids = Array.isArray(memberIdsRaw) ? memberIdsRaw.map(String) : [];
    out.set(String(row["id"]), {
      id: String(row["id"]),
      level: Number(row["level"]),
      parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_ids,
      member_count: Number(row["member_count"]),
      summary: String(row["summary"] ?? ""),
      has_embedding: Boolean(row["has_embedding"]),
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
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
  c: BuiltCommunity,
  summary: string,
  embedding: number[] | null,
  now: string,
  isNew: boolean,
): Promise<void> {
  const memberIdsLit = arrayLiteral(c.member_ids);
  const embedLit = embeddingLiteral(embedding);

  if (isNew) {
    await conn.run(
      `INSERT INTO lore_communities
         (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ${memberIdsLit}, ?, ?, ${embedLit}, '{}', ?, ?)`,
      [c.id, c.level, c.parent_id, c.member_count, summary, now, now],
    );
  } else {
    await conn.run(
      `UPDATE lore_communities
       SET level = ?, parent_id = ?, member_ids = ${memberIdsLit},
           member_count = ?, summary = ?, embedding = ${embedLit}, updated_at = ?
       WHERE id = ?`,
      [c.level, c.parent_id, c.member_count, summary, now, c.id],
    );
  }
}

async function updateParentOnly(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
  id: string,
  parent_id: string | null,
  now: string,
): Promise<void> {
  await conn.run(
    `UPDATE lore_communities SET parent_id = ?, updated_at = ? WHERE id = ?`,
    [parent_id, now, id],
  );
}

async function writeEntityCommunities(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof _getLoreDb>>["connect"]>>,
  entityToLeaf: Map<string, string>,
): Promise<void> {
  // metadata is stored as a JSON string; we have to read-modify-write each row
  // because DuckDB lacks a native JSON-merge function on TEXT columns.
  // This is bounded by entity count and only runs at recompute time.
  const ids = Array.from(entityToLeaf.keys());
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const result = await conn.runAndReadAll(
    `SELECT id, metadata FROM lore_entities WHERE id IN (${placeholders})`,
    ids,
  );
  for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
    const id = String(row["id"]);
    let parsed: Record<string, unknown> = {};
    if (typeof row["metadata"] === "string" && row["metadata"].length > 0) {
      try {
        const p = JSON.parse(row["metadata"]);
        if (p && typeof p === "object" && !Array.isArray(p)) parsed = p as Record<string, unknown>;
      } catch {
        // fall through with empty metadata
      }
    }
    const newCommunity = entityToLeaf.get(id);
    if (parsed["community"] === newCommunity) continue;  // already correct
    parsed["community"] = newCommunity;
    await conn.run(
      `UPDATE lore_entities SET metadata = ? WHERE id = ?`,
      [JSON.stringify(parsed), id],
    );
  }
}

// ---------------------------------------------------------------------------
// Public: recompute
// ---------------------------------------------------------------------------

export async function recomputeCommunities(
  campaignPath: string,
  opts: RecomputeOptions = {},
): Promise<RecomputeReport> {
  const start = Date.now();
  const summarizer = opts.summarizer ?? defaultSummarizer;
  const embedder = opts.embedder ?? _getLoreEmbedding;

  const instance = await _getLoreDb(campaignPath);
  const conn = await _openLoreWriteConn(instance);

  try {
    const [entities, relations, existing] = await Promise.all([
      loadEntities(conn),
      loadRelations(conn),
      loadExistingCommunities(conn),
    ]);

    if (entities.length === 0) {
      // Wipe any stale community rows from a previous run on a populated graph.
      if (existing.size > 0) {
        await conn.run(`DELETE FROM lore_communities`);
      }
      return {
        levels: 0,
        communities_total: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        deleted: existing.size,
        llm_calls: 0,
        embed_calls: 0,
        ms: Date.now() - start,
      };
    }

    const built = clusterGraph(entities, relations, {
      seed: opts.seed,
      resolution: opts.resolution,
      maxLevel: opts.maxLevel,
      metaGraphMinSize: opts.metaGraphMinSize,
    });

    // Index entities for fast lookup by id during summarization
    const entityById = new Map(entities.map((e) => [e.id, e] as const));

    // Bottom-up summarize + persist in topological order (built is already in
    // bottom-up order: every parent comes after all its children).
    const summariesById = new Map<string, string>();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let llm_calls = 0;
    let embed_calls = 0;
    const now = new Date().toISOString();

    // Determine which entities go in which level-0 community for membership
    // writeback (every entity should belong to exactly one leaf).
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
        // Same id ⇒ same member set (stable hash). Only re-write if parent
        // changed; never re-summarize. Carry the existing summary forward so
        // higher-level summarization can reference it.
        summariesById.set(c.id, prev.summary);
        if (prev.parent_id !== c.parent_id) {
          await updateParentOnly(conn, c.id, c.parent_id, now);
          updated++;
        } else {
          unchanged++;
        }
        continue;
      }

      // New community → summarize, embed, insert.
      let input: SummarizerInput;
      if (c.level === 0) {
        const memberSet = new Set(c.member_ids);
        const internal = relations.filter(
          (r) => memberSet.has(r.from_id) && memberSet.has(r.to_id),
        );
        const members: SummarizerEntity[] = c.member_ids
          .map((id) => entityById.get(id))
          .filter((e): e is SummarizerEntity => e !== undefined);
        input = {
          community_id: c.id,
          level: 0,
          members,
          internal_relations: internal,
          child_summaries: [],
        };
      } else {
        // Children are communities at level c.level - 1; we have their summaries
        // because we've processed them already (bottom-up order).
        const childSummaries = c.member_ids.map((cid) => {
          const child = built.find((b) => b.id === cid);
          return {
            id: cid,
            summary: summariesById.get(cid) ?? "",
            member_count: child?.member_count ?? 0,
          };
        });
        input = {
          community_id: c.id,
          level: c.level,
          members: [],
          internal_relations: [],
          child_summaries: childSummaries,
        };
      }

      const summary = await summarizer(input);
      llm_calls++;
      summariesById.set(c.id, summary);

      let embedding: number[] | null = null;
      if (!opts.skipEmbeddings) {
        try {
          embedding = await embedder(summary);
          embed_calls++;
        } catch (e) {
          // Embedding is best-effort: a missing Ollama shouldn't block the
          // whole recompute. The row is still inserted with NULL embedding,
          // which search_lore_global (Phase C) will need to handle.
          process.stderr.write(
            `[communities] embed failed for ${c.id}: ${(e as Error).message}\n`,
          );
        }
      }

      await upsertCommunity(conn, c, summary, embedding, now, true);
      created++;
    }

    // Delete communities that are no longer present in the new clustering.
    const builtIds = new Set(built.map((c) => c.id));
    let deleted = 0;
    for (const id of existing.keys()) {
      if (!builtIds.has(id)) {
        await conn.run(`DELETE FROM lore_communities WHERE id = ?`, [id]);
        deleted++;
      }
    }

    // Stamp leaf community id onto each entity's metadata.
    await writeEntityCommunities(conn, entityToLeaf);

    const levels = built.length === 0 ? 0 : Math.max(...built.map((c) => c.level)) + 1;
    return {
      levels,
      communities_total: built.length,
      created,
      updated,
      unchanged,
      deleted,
      llm_calls,
      embed_calls,
      ms: Date.now() - start,
    };
  } finally {
    conn.closeSync();
  }
}

// ---------------------------------------------------------------------------
// Public: read APIs
// ---------------------------------------------------------------------------

export async function listCommunities(
  campaignPath: string,
  opts: { level?: number; parent_id?: string | null; limit?: number } = {},
): Promise<CommunityListItem[]> {
  const instance = await _getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.level !== undefined) {
      where.push(`level = ?`);
      params.push(opts.level);
    }
    if (opts.parent_id !== undefined) {
      if (opts.parent_id === null) {
        where.push(`parent_id IS NULL`);
      } else {
        where.push(`parent_id = ?`);
        params.push(opts.parent_id);
      }
    }
    const limit = opts.limit ?? 100;
    params.push(limit);

    const sql = `
      SELECT id, level, parent_id, member_count, summary
      FROM lore_communities
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY level DESC, member_count DESC
      LIMIT ?
    `;
    const result = await conn.runAndReadAll(sql, params);
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((row) => ({
      id: String(row["id"]),
      level: Number(row["level"]),
      parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_count: Number(row["member_count"]),
      summary: String(row["summary"] ?? ""),
    }));
  } finally {
    conn.closeSync();
  }
}

export async function getCommunity(
  campaignPath: string,
  id: string,
): Promise<CommunityDetail | null> {
  const instance = await _getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, level, parent_id, member_ids, member_count, summary,
              metadata, created_at, updated_at
       FROM lore_communities WHERE id = ?`,
      [id],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const row = rows[0];
    const memberIdsRaw = row["member_ids"];
    const member_ids = Array.isArray(memberIdsRaw) ? memberIdsRaw.map(String) : [];
    let metadata: Record<string, unknown> = {};
    if (typeof row["metadata"] === "string" && row["metadata"].length > 0) {
      try {
        const p = JSON.parse(row["metadata"]);
        if (p && typeof p === "object" && !Array.isArray(p)) {
          metadata = p as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
    }
    return {
      id: String(row["id"]),
      level: Number(row["level"]),
      parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      member_ids,
      member_count: Number(row["member_count"]),
      summary: String(row["summary"] ?? ""),
      metadata,
      created_at: String(row["created_at"]),
      updated_at: String(row["updated_at"]),
    };
  } finally {
    conn.closeSync();
  }
}
