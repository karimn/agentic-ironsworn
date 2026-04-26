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
      k: z.number().int().positive().optional().describe("Number of results (default 5)"),
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
    "Get a lore entity and its connected entities up to N hops away. Returns { root, nodes, edges } where root has full incoming/outgoing relations populated, but nodes[*].relations is always empty (use the edges array for connectivity, or call get_lore on a specific node id to get that node's full relations).",
    {
      identifier: z.string().describe("Root entity (id, canonical, or alias)"),
      depth: z.number().int().positive().optional().describe("Number of hops to traverse (default 1)"),
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
}
