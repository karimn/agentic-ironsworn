import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  upsertLore,
  getLore,
  searchLore,
  linkLore,
  getLoreGraph,
  LORE_TYPES,
  type LoreType,
} from "../rag/lore.js";
import {
  recomputeCommunities,
  listCommunities,
  getCommunity,
  searchCommunities,
} from "../rag/communities.js";
import {
  extractLoreFromScene,
  extractUnprocessedScenes,
} from "../rag/extraction.js";
import {
  linkProximity,
  proximityDistance,
  proximityWithin,
  PROXIMITY_DIMENSIONS,
  COMPASS_POINTS,
  type ProximityDimension,
} from "../rag/proximity.js";
import { recordMutation } from "../checkpoint.js";

export function register(server: McpServer, campaignPath: string): void {
  const provenanceSchema = z
    .object({
      source_kind: z.enum(["manual", "scene", "document", "extraction"]),
      source_id: z.string().optional(),
      excerpt: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .describe("Source of this fact (manual, scene, document, extraction). Defaults to 'manual' if omitted.");

  server.tool(
    "upsert_lore",
    "Create or update a lore entity. On rename (changed canonical), the old name is automatically appended to aliases.",
    {
      id: z.string().optional().describe("Stable ID; derived from canonical name if omitted"),
      canonical: z.string().describe("Current display name"),
      type: z.enum(LORE_TYPES).describe("Entity type"),
      summary: z.string().describe("Prose description; will be embedded for semantic search"),
      content: z.record(z.string(), z.unknown()).optional().describe("Flexible JSON properties"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("GraphRAG metadata: community ids, scores, etc."),
      aliases: z.array(z.string()).optional().describe("Additional aliases to merge in"),
      provenance: provenanceSchema.optional(),
    },
    async (input) => {
      try {
        const result = await upsertLore(campaignPath, {
          ...input,
          type: input.type as LoreType,
        });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_lore",
    "Retrieve a lore entity by id, canonical name, or any alias (case-insensitive). Includes incoming and outgoing relations.",
    {
      identifier: z.string().describe("ID, canonical name, or alias"),
    },
    async ({ identifier }) => {
      try {
        const entity = await getLore(campaignPath, identifier);
        return {
          content: [{ type: "text", text: JSON.stringify(entity) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "search_lore",
    "Semantic search over lore entity summaries. Returns ranked matches.",
    {
      query: z.string().describe("Search query"),
      type: z.enum(LORE_TYPES).optional().describe("Optional type filter"),
      k: z.coerce.number().int().positive().optional().describe("Number of results (default 5)"),
    },
    async ({ query, type, k }) => {
      try {
        const results = await searchLore(campaignPath, query, k ?? 5, type as LoreType | undefined);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "search_lore_global",
    "GraphRAG Phase C: semantic search over lore community summaries (thematic " +
      "clusters produced by recompute_communities). Ranks hits flat across all " +
      "hierarchy levels (leaves + rollups) by cosine similarity. Pair with " +
      "search_lore when grounding scenes — search_lore for entity-level facts, " +
      "search_lore_global for thematic framing. Returns ranked hits with id, " +
      "level, parent_id, member_count, summary, score.",
    {
      query: z.string().describe("Search query"),
      k: z.coerce.number().int().positive().optional().describe("Number of results (default 5, capped at 100)"),
    },
    async ({ query, k }) => {
      try {
        const results = await searchCommunities(campaignPath, query, k);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "link_lore",
    "Create a typed relationship between two lore entities. Idempotent on (from, to, relation).",
    {
      from: z.string().describe("Source entity (id, canonical, or alias)"),
      to: z.string().describe("Target entity (id, canonical, or alias)"),
      relation: z.string().describe("Relationship type (free-form, e.g. 'allied_with', 'located_in')"),
      notes: z.string().optional().describe("Optional prose context"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("GraphRAG metadata: edge weight, extraction scores, etc."),
      provenance: provenanceSchema.optional(),
    },
    async ({ from, to, relation, notes, metadata, provenance }) => {
      try {
        const result = await linkLore(campaignPath, { from, to, relation, notes, metadata, provenance });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_lore_graph",
    "Get a lore entity and its connected entities up to N hops away. Returns { root, nodes, edges } where root has full incoming/outgoing relations populated, but nodes[*].relations is always empty (use the edges array for connectivity, or call get_lore on a specific node id to get that node's full relations). Each node also exposes `community_id` (the leaf community from recompute_communities, or null if unset).",
    {
      identifier: z.string().describe("Root entity (id, canonical, or alias)"),
      depth: z.coerce.number().int().positive().optional().describe("Number of hops to traverse (default 1)"),
    },
    async ({ identifier, depth }) => {
      try {
        const graph = await getLoreGraph(campaignPath, identifier, depth ?? 1);
        return {
          content: [{ type: "text", text: JSON.stringify(graph) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "recompute_communities",
    "GraphRAG Phase A+B: cluster lore entities via hierarchical Louvain, generate Claude-written summaries for each cluster, embed them, and write leaf community ids back onto entity metadata. Idempotent — re-running on an unchanged graph produces zero LLM calls. Requires ANTHROPIC_API_KEY for summary generation.",
    {
      seed: z.coerce.number().int().optional().describe("RNG seed for reproducible Louvain assignments (default 1)"),
      resolution: z.coerce.number().positive().optional().describe("Louvain resolution; higher = more, smaller clusters (default 1)"),
      max_level: z.coerce.number().int().positive().optional().describe("Hard cap on hierarchy depth (default 4)"),
    },
    async ({ seed, resolution, max_level }) => {
      try {
        const report = await recomputeCommunities(campaignPath, {
          seed,
          resolution,
          maxLevel: max_level,
        });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "list_communities",
    "List lore communities produced by recompute_communities. Filter by level (0 = leaf clusters; higher = parent rollups) or by parent_id. Returns id, level, parent_id, member_count, summary preview.",
    {
      level: z.coerce.number().int().nonnegative().optional().describe("Filter to communities at this hierarchy level"),
      parent_id: z.string().optional().describe("Filter to direct children of this community id (use empty string for root rollups)"),
      limit: z.coerce.number().int().positive().optional().describe("Max results (default 100)"),
    },
    async ({ level, parent_id, limit }) => {
      try {
        const opts: Parameters<typeof listCommunities>[1] = { level, limit };
        if (parent_id !== undefined) {
          opts.parent_id = parent_id.length === 0 ? null : parent_id;
        }
        const items = await listCommunities(campaignPath, opts);
        return { content: [{ type: "text", text: JSON.stringify(items) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_community",
    "Fetch a single community's full record: summary, direct member ids (entity ids at level 0; child community ids at higher levels), member_count, parent_id, metadata, timestamps. Returns null if not found.",
    {
      id: z.string().describe("Community id from list_communities or recompute_communities"),
    },
    async ({ id }) => {
      try {
        const community = await getCommunity(campaignPath, id);
        return { content: [{ type: "text", text: JSON.stringify(community) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "extract_lore_from_scene",
    "Extract lore entities and relations from a recorded scene using Claude. " +
      "Deduplicates against the existing graph. Upserts with provenance source_kind='extraction'. " +
      "Requires ANTHROPIC_API_KEY.",
    {
      scene_id: z.string().describe("UUID of the scene to extract from"),
      confidence_threshold: z
        .coerce.number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence to accept an entity or relation (default 0.6)"),
    },
    async ({ scene_id, confidence_threshold }) => {
      try {
        const report = await extractLoreFromScene(campaignPath, scene_id, {
          confidenceThreshold: confidence_threshold,
        });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "extract_session_lore",
    "Batch-extract lore from all scenes not yet processed. Skips scenes already in the extraction log. " +
      "Processes scenes in recording order. Requires ANTHROPIC_API_KEY.",
    {
      confidence_threshold: z
        .coerce.number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence to accept an entity or relation (default 0.6)"),
    },
    async ({ confidence_threshold }) => {
      try {
        const report = await extractUnprocessedScenes(campaignPath, {
          confidenceThreshold: confidence_threshold,
        });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(report) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "link_proximity",
    "Create or update a weighted proximity edge between two lore entities. Dimension is 'space' (magnitude in days walk, requires direction) or 'time' (magnitude in days, requires order_kind). Idempotent on (from, to, dimension); re-linking updates the row. Result.warnings is a string[] populated (without blocking the write) when entity types are unusual for the dimension — spatial on non-place/non-faction, or temporal on non-event. Inspect result.warnings; an empty array means no concerns.",
    {
      from: z.string().describe("Source entity (id, canonical, or alias)"),
      to: z.string().describe("Target entity (id, canonical, or alias)"),
      dimension: z.enum(PROXIMITY_DIMENSIONS).describe("'space' or 'time'"),
      magnitude: z.coerce.number().positive().describe(
        "For space: days walk (fractional ok). For time: days (fractional ok).",
      ),
      direction: z.enum(COMPASS_POINTS).optional().describe(
        "Required when dimension='space'; forbidden otherwise. 8-point compass.",
      ),
      order_kind: z.enum(["before", "after"]).optional().describe(
        "Required when dimension='time'; forbidden otherwise. 'after' is normalized to 'before' at write time.",
      ),
      notes: z.string().optional().describe("Optional prose context"),
      metadata: z.record(z.string(), z.unknown()).optional(),
      provenance: provenanceSchema.optional(),
    },
    async (input) => {
      try {
        const result = await linkProximity(campaignPath, {
          ...input,
          dimension: input.dimension as ProximityDimension,
        });
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "proximity_distance",
    "Shortest accumulated magnitude between two lore entities along the given dimension. Returns null if the entities are in disconnected components. Symmetric — A→B equals B→A.",
    {
      from: z.string().describe("Source entity (id, canonical, or alias)"),
      to: z.string().describe("Target entity (id, canonical, or alias)"),
      dimension: z.enum(PROXIMITY_DIMENSIONS).describe("'space' or 'time'"),
    },
    async ({ from, to, dimension }) => {
      try {
        const result = await proximityDistance(
          campaignPath,
          from,
          to,
          dimension as ProximityDimension,
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "proximity_within",
    "All lore entities reachable from the anchor within `radius` along the given dimension, sorted ascending by distance. Includes the anchor at distance 0.",
    {
      anchor: z.string().describe("Anchor entity (id, canonical, or alias)"),
      radius: z.coerce.number().nonnegative().describe(
        "Max accumulated magnitude. Days walk for space, days for time.",
      ),
      dimension: z.enum(PROXIMITY_DIMENSIONS).describe("'space' or 'time'"),
    },
    async ({ anchor, radius, dimension }) => {
      try {
        const results = await proximityWithin(
          campaignPath,
          anchor,
          radius,
          dimension as ProximityDimension,
        );
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
}
