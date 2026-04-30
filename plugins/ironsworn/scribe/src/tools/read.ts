import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCharacter } from "../state/character.js";
import { listThreads } from "../state/threads.js";
import { getNpc } from "../state/npcs.js";
import { searchRules, lookupMove } from "../rag/query.js";
import { searchScenes } from "../rag/scenes.js";
import { lookupAsset } from "../rules/ironsworn/assets.js";

function characterDigest(char: Awaited<ReturnType<typeof loadCharacter>>) {
  const activeDebilities = Object.fromEntries(
    Object.entries(char.debilities).filter(([, v]) => v === true),
  );
  return {
    name: char.name,
    momentum: char.momentum,
    health: char.health,
    spirit: char.spirit,
    supply: char.supply,
    debilities: activeDebilities,
    bonds: char.bonds,
  };
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "get_character_digest",
    "Get a compact summary of the character's current state",
    {},
    async () => {
      try {
        const character = await loadCharacter(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify(characterDigest(character)) }],
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
    "get_character_full",
    "Get the complete character JSON including stats, assets, progress tracks, and custom state",
    {},
    async () => {
      try {
        const character = await loadCharacter(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify(character) }],
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
    "get_progress_track",
    "Find a progress track by name (case-insensitive)",
    { name: z.string().describe("Name of the progress track to look up") },
    async ({ name }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const track = character.progressTracks.find(
          (t) => t.name.toLowerCase() === name.toLowerCase(),
        );
        if (!track) {
          return {
            content: [{ type: "text", text: `Error: Progress track not found: "${name}"` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(track) }],
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
    "list_threads",
    "List narrative threads, optionally filtered by status",
    { status: z.enum(["open", "closed"]).optional().describe("Filter by thread status") },
    async ({ status }) => {
      try {
        const threads = await listThreads(campaignPath, status);
        return {
          content: [{ type: "text", text: JSON.stringify(threads) }],
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
    "get_npc",
    "Get the markdown content for an NPC by name",
    { name: z.string().describe("Name of the NPC to look up") },
    async ({ name }) => {
      try {
        const content = await getNpc(campaignPath, name);
        return {
          content: [{ type: "text", text: content ?? "NPC not found" }],
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
    "search_rules",
    "Search the Ironsworn rules using semantic and keyword search",
    {
      query: z.string().describe("Search query"),
      content_type: z.string().optional().describe("Filter by content type (e.g. 'move', 'oracle')"),
      k: z.number().int().positive().optional().describe("Number of results to return (default 5)"),
    },
    async ({ query, content_type, k }) => {
      try {
        const results = await searchRules(query, { contentType: content_type, k });
        return {
          content: [{ type: "text", text: JSON.stringify(results) }],
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
    "lookup_move",
    "Look up a specific Ironsworn move by name",
    { name: z.string().describe("Name of the move to look up") },
    async ({ name }) => {
      try {
        const result = await lookupMove(name);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
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
    "search_scenes",
    "Search recorded scenes using semantic similarity",
    {
      query: z.string().describe("Search query"),
      k: z.number().int().positive().optional().describe("Number of results to return (default 5)"),
    },
    async ({ query, k }) => {
      try {
        const results = await searchScenes(campaignPath, query, k);
        return {
          content: [{ type: "text", text: JSON.stringify(results) }],
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
    "lookup_asset",
    "Look up an Ironsworn asset by exact name — returns type, health (companions), and all abilities with default markers",
    { name: z.string().describe("Asset name to look up (e.g. 'Hound', 'Swordmaster', 'Slayer')") },
    async ({ name }) => {
      try {
        const asset = lookupAsset(name);
        if (!asset) {
          return {
            content: [{ type: "text", text: `Asset not found: "${name}"` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(asset) }],
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
