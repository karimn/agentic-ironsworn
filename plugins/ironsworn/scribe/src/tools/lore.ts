import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  upsertLore,
  getLore,
  searchLore,
  linkLore,
  getLoreGraph,
  canonizeEntity,
  decanonizeEntity,
  canonizeRelation,
  decanonizeRelation,
  LORE_TYPES,
  type LoreType,
  recall,
  type RecallOptions,
} from "@agentic-rpg/core";
import {
  recomputeCommunities,
  listCommunities,
  getCommunity,
  searchCommunities,
} from "@agentic-rpg/core";
import {
  extractLoreFromScene,
  extractUnprocessedScenes,
} from "@agentic-rpg/core";
import {
  linkProximity,
  proximityDistance,
  proximityWithin,
  PROXIMITY_DIMENSIONS,
  COMPASS_POINTS,
  type ProximityDimension,
} from "@agentic-rpg/core";
import { recordMutation } from "@agentic-rpg/core";
import {
  listContradictions,
  resolveContradiction,
} from "@agentic-rpg/core";
import { listCanonizeCandidates } from "@agentic-rpg/core";
import { getCanonBriefing } from "@agentic-rpg/core";
import { groundingHint } from "@agentic-rpg/core";

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
    "upsert_entity",
    "Create or update any world entity (place, person, faction, material, concept, creature, event, truth, thread). On rename, the old canonical is appended to aliases. Supersedes upsert_npc and upsert_lore.",
    {
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
    "canonize_entity",
    "Promote an entity to world canon (campaign_id = NULL); visible to all sibling campaigns. Reversible via decanonize_entity.",
    {
      identifier: z.string().describe("ID, canonical name, slug, or alias of the entity to canonize"),
    },
    async ({ identifier }) => {
      try {
        const result = await canonizeEntity(campaignPath, identifier);
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
    "decanonize_entity",
    "Move a world-canon entity back into a specific campaign (campaign_id = into_campaign). Reverses canonize_entity.",
    {
      identifier: z.string().describe("ID, canonical name, slug, or alias of the entity to decanonize"),
      into_campaign: z.string().describe("The campaign ID to assign the entity to"),
    },
    async ({ identifier, into_campaign }) => {
      try {
        const result = await decanonizeEntity(campaignPath, identifier, into_campaign);
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
    "canonize_relation",
    "Promote a relation to world canon (campaign_id = NULL); visible to all sibling campaigns. Reversible via decanonize_relation.",
    {
      relation_id: z.string().describe("UUID of the relation (from link_lore result.relation_id)"),
    },
    async ({ relation_id }) => {
      try {
        await canonizeRelation(campaignPath, relation_id);
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, relation_id }) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "decanonize_relation",
    "Move a world-canon relation back into a specific campaign. Reverses canonize_relation.",
    {
      relation_id: z.string().describe("UUID of the relation to decanonize"),
      into_campaign: z.string().describe("The campaign ID to assign the relation to"),
    },
    async ({ relation_id, into_campaign }) => {
      try {
        await decanonizeRelation(campaignPath, relation_id, into_campaign);
        recordMutation(campaignPath);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, relation_id, into_campaign }) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "upsert_lore",
    "Create or update a lore entity. On rename (changed canonical), the old name is automatically appended to aliases. (alias of upsert_entity; kept one release)",
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
      include_sibling_campaigns: z.boolean().optional().describe("When true, search across all campaigns in the world (default false)"),
    },
    async ({ identifier, include_sibling_campaigns }) => {
      try {
        const entity = await getLore(campaignPath, identifier, { includeSiblings: include_sibling_campaigns ?? false });
        // Retrieval discipline (#6): a direct entity read returns the stored
        // record only — nudge the agent to recall before narrating. Only when
        // an entity was actually found (no nudge on a miss).
        const content: Array<{ type: "text"; text: string }> = [
          { type: "text", text: JSON.stringify(entity) },
        ];
        if (entity !== null) {
          content.push({ type: "text", text: groundingHint(entity.canonical) });
        }
        return { content };
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
      // Coerce: MCP transports occasionally deliver numerics as strings.
      // Coerce-then-validate keeps the int/positive guarantees while accepting both.
      k: z.coerce.number().int().positive().optional().describe("Number of results (default 5)"),
      include_sibling_campaigns: z.boolean().optional().describe("When true, search across all campaigns in the world (default false)"),
    },
    async ({ query, type, k, include_sibling_campaigns }) => {
      try {
        const limit = k ?? 5;
        const results = await searchLore(campaignPath, query, limit, type as LoreType | undefined, { includeSiblings: include_sibling_campaigns ?? false });
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
      include_sibling_campaigns: z.boolean().optional().describe("When true, search across all campaigns in the world (default false)"),
    },
    async ({ query, k, include_sibling_campaigns }) => {
      try {
        const results = await searchCommunities(campaignPath, query, k, undefined, { includeSiblings: include_sibling_campaigns ?? false });
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
    "recall",
    [
      "Unified grounding dossier: one call returns matching entities, their recent scenes, and relevant community summaries.",
      "Replaces the parallel search_lore + search_lore_global pattern for scene grounding.",
      "Use this as the first tool call before narrating any scene that introduces or invokes a place, NPC, faction, or past event.",
      "search_lore and search_lore_global remain available for targeted lookups (entity-resolution checks, name-collision detection).",
      "Returns { query, entities: [{ id, slug, canonical, type, summary, score, scenes: [{ id, text, timestamp, kind }] }], communities: [{ id, level, summary, score }] }.",
    ].join(" "),
    {
      query: z.string().describe("Search query — what to ground (e.g. 'Caldren village', 'Lona the healer', 'the iron-oath network')"),
      kind: z.enum(LORE_TYPES).optional().describe("Filter entities to a specific type"),
      near: z.object({ entity: z.string() }).optional().describe(
        "Restrict entity results to 1-hop lore-graph neighbors of this entity (id, canonical, or alias)"
      ),
      limit: z.coerce.number().int().positive().optional().describe("Max entities to return (default 5)"),
      scenes_per_entity: z.coerce.number().int().positive().optional().describe(
        "Max recent scenes per entity (default 2)"
      ),
      communities: z.coerce.number().int().positive().optional().describe(
        "Max community summaries to return (default 3)"
      ),
      include_sibling_campaigns: z.boolean().optional().describe(
        "When true, search across all campaigns in the world (default false)"
      ),
    },
    async ({ query, kind, near, limit, scenes_per_entity, communities, include_sibling_campaigns }) => {
      try {
        const opts: RecallOptions = {
          kind: kind as LoreType | undefined,
          near: near ? { entity: near.entity } : undefined,
          limit,
          scenes_per_entity,
          communities,
          include_sibling_campaigns,
        };
        const result = await recall(campaignPath, query, opts);
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
    "link_lore",
    "Create a typed relationship between two lore entities. Idempotent on (from, to, relation).",
    {
      from: z.string().describe("Source entity (id, canonical, or alias)"),
      to: z.string().describe("Target entity (id, canonical, or alias)"),
      relation: z.string().describe("Relationship type (free-form, e.g. 'sworn_on', 'corrupts')"),
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
      // Same MCP transport quirk as search_lore.k — accept numeric or stringified number.
      depth: z.coerce.number().int().positive().optional().describe("Number of hops to traverse (default 1)"),
      include_sibling_campaigns: z.boolean().optional().describe("When true, traverse across all campaigns in the world (default false)"),
    },
    async ({ identifier, depth, include_sibling_campaigns }) => {
      try {
        const graph = await getLoreGraph(campaignPath, identifier, depth ?? 1, { includeSiblings: include_sibling_campaigns ?? false });
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

  server.tool(
    "list_contradictions",
    "List open (unresolved) contradiction flags raised at write time. Call before canonize to see what needs adjudication.",
    {
      include_resolved: z.boolean().optional()
        .describe("Include already-resolved flags (default false)"),
      limit: z.coerce.number().int().min(1).max(100).optional()
        .describe("Max results 1–100 (default 20)"),
    },
    async ({ include_resolved, limit }) => {
      try {
        const flags = await listContradictions(campaignPath, {
          includeResolved: include_resolved ?? false,
          limit: limit ?? 20,
        });
        return { content: [{ type: "text", text: JSON.stringify(flags) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "resolve_contradiction",
    "Mark a contradiction flag as resolved. Call after adjudicating — e.g. after canonizing the correct version or confirming the two facts genuinely coexist.",
    {
      id: z.string().describe("UUID of the contradiction flag"),
      resolution: z.string().optional()
        .describe("Optional note on how it was resolved"),
    },
    async ({ id, resolution }) => {
      try {
        await resolveContradiction(campaignPath, id, resolution);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, id }) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "list_canonize_candidates",
    "The canonize ritual's candidate surfacing (FW2, resolves OQ5): ranked campaign-scoped entities and relations that have stabilized into the story this pass, backing the /canonize command. Ranked by scene-spread (distinct scenes referencing the entity, or the lesser of a relation's two endpoints) and relation degree — recurrence and centrality signals already tracked elsewhere. Each candidate carries `blocked`/`blocked_reason`: true when an unresolved contradiction touches it, per `list_contradictions` — a blocked candidate must NOT be passed to canonize_entity/canonize_relation until resolve_contradiction runs. Distinct from list_contradictions (which lists conflicts) and search_lore (which finds by meaning) — this ranks what's eligible to bless.",
    {
      limit: z.coerce.number().int().min(1).max(100).optional()
        .describe("Max results 1–100 (default 20)"),
    },
    async ({ limit }) => {
      try {
        const candidates = await listCanonizeCandidates(campaignPath, { limit: limit ?? 20 });
        return { content: [{ type: "text", text: JSON.stringify(candidates) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_canon_briefing",
    "The new-campaign-in-existing-world onramp's canon briefing (FW3, #198): world-scoped (campaign_id IS NULL) entities ranked by relation degree, their active relations, and the broadest community summaries — the 'what's already true here' a PC entering an established world could plausibly know or discover. This is the same data buildContext auto-injects into a fresh sibling campaign's first session (before any scenes are recorded); call it directly to re-fetch or show the briefing again later in the same campaign. Pairs with the canonize ritual (/canonize, FW2) — canon blessed in a prior campaign is exactly what shows up here.",
    {
      entity_limit: z.coerce.number().int().min(1).max(50).optional()
        .describe("Max entities to return (default 15)"),
      relation_limit: z.coerce.number().int().min(1).max(50).optional()
        .describe("Max relations to return (default 15)"),
      community_limit: z.coerce.number().int().min(1).max(20).optional()
        .describe("Max community summaries to return (default 5)"),
    },
    async ({ entity_limit, relation_limit, community_limit }) => {
      try {
        const briefing = await getCanonBriefing(campaignPath, {
          entityLimit: entity_limit,
          relationLimit: relation_limit,
          communityLimit: community_limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(briefing) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
}
