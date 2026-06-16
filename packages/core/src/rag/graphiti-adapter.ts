/**
 * Graphiti adapter for @agentic-rpg/core.
 *
 * Maps our campaign/world-canon visibility model onto graphiti-ts group_ids:
 *   world canon  → group_id "world"
 *   campaign     → group_id "campaign-{campaignId}"
 *
 * A search that should include world-canon facts passes both group_ids.
 *
 * FalkorDB connection env vars:
 *   FALKORDB_HOST  (default: localhost)
 *   FALKORDB_PORT  (default: 6379)
 */

import {
  Graphiti,
  FalkorDriver,
  createFalkorClientAdapter,
  OllamaEmbedder,
  AnthropicClient,
  EDGE_HYBRID_SEARCH_RRF,
  COMBINED_HYBRID_SEARCH_RRF,
  type SearchResults,
  type CrossEncoderClient,
} from "@graphiti/core";
import { resolveWorldContext } from "../world.js";
import type { WorldContext } from "../world.js";

// ---------------------------------------------------------------------------
// Group-id helpers
// ---------------------------------------------------------------------------

const WORLD_GROUP = "world";

function campaignGroup(campaignId: string): string {
  return `campaign-${campaignId}`;
}

/** Both group IDs a campaign search should cover (canon + campaign overlay). */
function visibilityGroups(campaignId: string): [string, string] {
  return [WORLD_GROUP, campaignGroup(campaignId)];
}

// ---------------------------------------------------------------------------
// Passthrough reranker — returns passages sorted by BM25-style term overlap.
// Avoids the Jina/OpenAI cross-encoder API dependency; good enough for RPG
// lore retrieval where semantic similarity from the embedder already handles
// most of the heavy lifting.
// ---------------------------------------------------------------------------

class LocalReranker implements CrossEncoderClient {
  async rank(query: string, passages: string[]): Promise<Array<[string, number]>> {
    const qTerms = new Set(query.toLowerCase().split(/\s+/));
    return passages
      .map((p): [string, number] => {
        const pTerms = p.toLowerCase().split(/\s+/);
        const overlap = pTerms.filter((t) => qTerms.has(t)).length;
        const score = overlap / Math.max(qTerms.size, 1);
        return [p, score];
      })
      .sort((a, b) => b[1] - a[1]);
  }
}

// ---------------------------------------------------------------------------
// Lazy Graphiti instance cache — one per FalkorDB connection (world-level).
// Per-group indices are built lazily on first use of each campaign group.
// ---------------------------------------------------------------------------

const instanceCache = new Map<string, Promise<Graphiti>>();
const initializedGroups = new Set<string>();

async function buildGraphiti(): Promise<Graphiti> {
  const host = process.env["FALKORDB_HOST"] ?? "localhost";
  const port = parseInt(process.env["FALKORDB_PORT"] ?? "6379", 10);

  const client = await createFalkorClientAdapter({ host, port });
  const driver = new FalkorDriver({ host, port }, client);
  const embedder = new OllamaEmbedder({
    baseUrl: (process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434") + "/v1",
  });
  const extractionModel = process.env["SCRIBE_EXTRACTION_MODEL"]
    ?? process.env["SCRIBE_SUMMARY_MODEL"]
    ?? "claude-haiku-4-5-20251001";
  const llm = new AnthropicClient({
    config: {
      api_key: process.env["ANTHROPIC_API_KEY"] ?? null,
      model: extractionModel,
      small_model: extractionModel,
    },
  });

  return new Graphiti({ driver, embedder, llm_client: llm, cross_encoder: new LocalReranker() });
}

export function getGraphiti(worldRoot: string): Promise<Graphiti> {
  const cached = instanceCache.get(worldRoot);
  if (cached !== undefined) return cached;
  const promise = buildGraphiti().catch((e) => {
    instanceCache.delete(worldRoot);
    throw e;
  });
  instanceCache.set(worldRoot, promise);
  return promise;
}

/**
 * Ensure FalkorDB indices exist for the given group database.
 * FalkorDB uses a separate graph per group_id; each graph needs its own indices.
 * Creates a fresh driver scoped to the group rather than trying to access
 * the Graphiti instance's internal driver (which is private).
 */
async function ensureGroupIndices(groupId: string): Promise<void> {
  if (initializedGroups.has(groupId)) return;

  const host = process.env["FALKORDB_HOST"] ?? "localhost";
  const port = parseInt(process.env["FALKORDB_PORT"] ?? "6379", 10);

  // FalkorDB requires a graph to have at least one node before indices can
  // be created. Use graphiti-ts's FalkorClientAdapter to seed the graph.
  const client = await createFalkorClientAdapter({ host, port });
  const graph = client.selectGraph(groupId);
  try {
    await graph.query("MERGE (:_init {_placeholder: true})");
    const rangeIndexes = [
      "CREATE INDEX FOR (n:Entity) ON (n.uuid)",
      "CREATE INDEX FOR (n:Entity) ON (n.group_id)",
      "CREATE INDEX FOR (n:Episodic) ON (n.uuid)",
      "CREATE INDEX FOR (n:Episodic) ON (n.group_id)",
      "CREATE INDEX FOR ()-[r:RELATES_TO]-() ON (r.uuid)",
    ];
    for (const q of rangeIndexes) {
      try { await graph.query(q); } catch { /* already exists */ }
    }
    const fulltextIndexes = [
      "CALL db.idx.fulltext.createNodeIndex('Entity', 'name')",
      "CALL db.idx.fulltext.createNodeIndex('Episodic', 'name')",
      "CALL db.idx.fulltext.createRelationshipIndex('RELATES_TO', 'name')",
    ];
    for (const q of fulltextIndexes) {
      try { await graph.query(q); } catch { /* already exists */ }
    }
    // Leave the _init node — deleting all nodes in FalkorDB deletes the graph.
  } finally {
    await client.close();
  }

  initializedGroups.add(groupId);
}

// ---------------------------------------------------------------------------
// Public API used by extraction.ts and lore.ts
// ---------------------------------------------------------------------------

export interface GraphitiEpisodeInput {
  sceneId: string;
  text: string;
  timestamp: string;
  campaignId: string;
  worldRoot: string;
}

export interface GraphitiEdgeResult {
  uuid: string;
  name: string;
  fact: string;
  source_node_uuid: string;
  target_node_uuid: string;
  valid_at: Date | null;
  invalid_at: Date | null;
  group_id: string;
}

export interface GraphitiNodeResult {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];
  group_id: string;
}

/**
 * Look up a single Entity node by UUID, searching the campaign group then default_db.
 * Returns null if not found in either graph.
 */
export async function getGraphitiNode(
  worldRoot: string,
  campaignId: string,
  uuid: string,
): Promise<GraphitiNodeResult | null> {
  const host = process.env["FALKORDB_HOST"] ?? "localhost";
  const port = parseInt(process.env["FALKORDB_PORT"] ?? "6379", 10);
  const client = await createFalkorClientAdapter({ host, port });

  const groups = [campaignGroup(campaignId), "default_db"];
  try {
    for (const gid of groups) {
      const graph = client.selectGraph(gid);
      try {
        const result = await graph.query(
          `MATCH (n:Entity {uuid: $uuid})
           RETURN n.uuid AS uuid, n.name AS name, n.summary AS summary,
                  labels(n) AS labels, n.group_id AS group_id`,
          { params: { uuid } },
        );
        if (result.data && result.data.length > 0) {
          const r = result.data[0] as Record<string, unknown>;
          return {
            uuid: r["uuid"] as string,
            name: r["name"] as string,
            summary: (r["summary"] as string | null) ?? "",
            labels: (r["labels"] as string[]) ?? [],
            group_id: (r["group_id"] as string | null) ?? gid,
          };
        }
      } catch {
        // Graph may not exist yet; try next
      }
    }
    return null;
  } finally {
    await client.close();
  }
}

/**
 * Look up a single EntityEdge by UUID, searching the campaign group then default_db.
 * Returns null if not found.
 */
export async function getGraphitiEdge(
  worldRoot: string,
  campaignId: string,
  uuid: string,
): Promise<GraphitiEdgeResult | null> {
  const host = process.env["FALKORDB_HOST"] ?? "localhost";
  const port = parseInt(process.env["FALKORDB_PORT"] ?? "6379", 10);
  const client = await createFalkorClientAdapter({ host, port });

  const groups = [campaignGroup(campaignId), "default_db"];
  try {
    for (const gid of groups) {
      const graph = client.selectGraph(gid);
      try {
        const result = await graph.query(
          `MATCH (source:Entity)-[e:RELATES_TO {uuid: $uuid}]->(target:Entity)
           RETURN e.uuid AS uuid, e.name AS name, e.fact AS fact,
                  source.uuid AS source_node_uuid, target.uuid AS target_node_uuid,
                  e.valid_at AS valid_at, e.invalid_at AS invalid_at,
                  e.group_id AS group_id`,
          { params: { uuid } },
        );
        if (result.data && result.data.length > 0) {
          const r = result.data[0] as Record<string, unknown>;
          return {
            uuid: r["uuid"] as string,
            name: r["name"] as string,
            fact: (r["fact"] as string | null) ?? "",
            source_node_uuid: r["source_node_uuid"] as string,
            target_node_uuid: r["target_node_uuid"] as string,
            valid_at: r["valid_at"] ? new Date(r["valid_at"] as string) : null,
            invalid_at: r["invalid_at"] ? new Date(r["invalid_at"] as string) : null,
            group_id: (r["group_id"] as string | null) ?? gid,
          };
        }
      } catch {
        // Graph may not exist yet; try next
      }
    }
    return null;
  } finally {
    await client.close();
  }
}

/** Ingest a scene as a graphiti episode, extracting entities and edges. */
export async function ingestEpisode(input: GraphitiEpisodeInput): Promise<void> {
  const group = campaignGroup(input.campaignId);
  // The Graphiti instance's nodes/edges namespaces are tied to the initial
  // driver database ("default_db"). That graph must exist even though we never
  // write real data to it, because retrieveEpisodes uses it for context lookup.
  await ensureGroupIndices("default_db");
  await ensureGroupIndices(group);
  const graphiti = await getGraphiti(input.worldRoot);
  await graphiti.addEpisodeFull({
    name: input.sceneId,
    episode_body: input.text,
    source_description: "Ironsworn campaign scene",
    reference_time: new Date(input.timestamp),
    group_id: campaignGroup(input.campaignId),
    source: "text",
    update_communities: false,
    custom_extraction_instructions:
      "This is a solo RPG campaign scene. Entities include: people (NPCs and the player character), " +
      "places (settlements, ruins, landmarks), factions (organizations, groups), creatures (monsters, " +
      "animals), materials (iron, ores, magical substances), concepts (world truths, abstract forces), " +
      "events (battles, ceremonies, significant occurrences), and threads (ongoing quests or vows). " +
      "Use SCREAMING_SNAKE_CASE for relation types. Extract only what is explicitly stated.",
  });
}

/** Search entities and edges visible to the given campaign (includes world canon). */
export async function searchGraphiti(
  worldRoot: string,
  campaignId: string,
  query: string,
  options?: { limit?: number; asOf?: Date },
): Promise<{ nodes: GraphitiNodeResult[]; edges: GraphitiEdgeResult[] }> {
  const group = campaignGroup(campaignId);
  // Ensure the campaign group is initialized even if ingestEpisode hasn't run yet.
  await ensureGroupIndices("default_db");
  await ensureGroupIndices(group);
  const graphiti = await getGraphiti(worldRoot);
  const groupIds = visibilityGroups(campaignId);
  const limit = options?.limit ?? 10;

  // FalkorDB multi-group routing only activates when group_ids.length > 1.
  // With a single group, the query runs against the Graphiti instance's default
  // database (default_db), missing the campaign data. Include default_db as a
  // dummy second group to force per-group routing — it has no Entity nodes so
  // it returns empty and gets merged with no effect.
  const campaignGroupId = campaignGroup(campaignId);
  const activeGroups = ["default_db", campaignGroupId];

  const searchOpts = { group_ids: activeGroups, num_results: limit };

  if (options?.asOf !== undefined) {
    const edges = await graphiti.searchAsOf(query, options.asOf, searchOpts);
    return { nodes: [], edges: mapEdges(edges) };
  }

  const edgeResults = await graphiti.searchEdges(query, searchOpts);

  return {
    nodes: [],
    edges: mapEdges(edgeResults),
  };
}

/** Rebuild community summaries for a campaign group. */
export async function rebuildCommunities(
  worldRoot: string,
  campaignId: string,
): Promise<void> {
  const graphiti = await getGraphiti(worldRoot);
  await graphiti.buildCommunities(visibilityGroups(campaignId));
}

// ---------------------------------------------------------------------------
// resolveWorldContext convenience wrapper
// ---------------------------------------------------------------------------

export async function getGraphitiForCampaign(
  campaignPath: string,
): Promise<{ graphiti: Graphiti; ctx: WorldContext }> {
  const ctx = await resolveWorldContext(campaignPath);
  const graphiti = await getGraphiti(ctx.worldRoot);
  return { graphiti, ctx };
}

// ---------------------------------------------------------------------------
// Internal mappers
// ---------------------------------------------------------------------------

function mapNodes(nodes: NonNullable<SearchResults["nodes"]>): GraphitiNodeResult[] {
  return nodes.map((n) => ({
    uuid: n.uuid,
    name: n.name,
    summary: n.summary ?? "",
    labels: n.labels ?? [],
    group_id: n.group_id,
  }));
}

function mapEdges(edges: NonNullable<SearchResults["edges"]>): GraphitiEdgeResult[] {
  return edges.map((e) => ({
    uuid: e.uuid,
    name: e.name,
    fact: e.fact ?? "",
    source_node_uuid: e.source_node_uuid,
    target_node_uuid: e.target_node_uuid,
    valid_at: e.valid_at ?? null,
    invalid_at: e.invalid_at ?? null,
    group_id: e.group_id,
  }));
}
