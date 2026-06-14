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
 * This is idempotent — safe to call multiple times.
 */
async function ensureGroupIndices(graphiti: Graphiti, groupId: string): Promise<void> {
  if (initializedGroups.has(groupId)) return;

  // Temporarily point the driver at the group's database to build its indices.
  const originalDriver = (graphiti as unknown as { driver: FalkorDriver }).driver;
  const groupDriver = originalDriver.clone(groupId);
  const groupGraphiti = new Graphiti({
    driver: groupDriver,
    // No LLM/embedder needed for index creation
  });

  try {
    await groupGraphiti.buildIndicesAndConstraints(false);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (!msg.includes("already indexed") && !msg.includes("already exists")) throw e;
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

/** Ingest a scene as a graphiti episode, extracting entities and edges. */
export async function ingestEpisode(input: GraphitiEpisodeInput): Promise<void> {
  const graphiti = await getGraphiti(input.worldRoot);
  const group = campaignGroup(input.campaignId);
  await ensureGroupIndices(graphiti, group);
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
  const graphiti = await getGraphiti(worldRoot);
  const groupIds = visibilityGroups(campaignId);
  const limit = options?.limit ?? 10;

  const searchOpts = { group_ids: groupIds as string[], num_results: limit };

  if (options?.asOf !== undefined) {
    const edges = await graphiti.searchAsOf(query, options.asOf, searchOpts);
    return { nodes: [], edges: mapEdges(edges) };
  }

  // Use edge-only search to avoid hitting community graphs that may not exist yet.
  const [nodeResults, edgeResults] = await Promise.all([
    graphiti.search(query, EDGE_HYBRID_SEARCH_RRF, searchOpts).catch(() => ({ nodes: [], edges: [] })),
    graphiti.searchEdges(query, searchOpts).catch(() => []),
  ]);

  return {
    nodes: mapNodes((nodeResults.nodes ?? []) as NonNullable<SearchResults["nodes"]>),
    edges: mapEdges(edgeResults as NonNullable<SearchResults["edges"]>),
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
