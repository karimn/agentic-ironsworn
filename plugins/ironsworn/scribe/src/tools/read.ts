import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCharacter } from "../state/character.js";
import { listThreads } from "../state/threads.js";
import { getNpc } from "../state/npcs.js";
import { searchRules, lookupMove } from "../rag/query.js";
import { searchScenes, getRecentComplications, getRecentScenesChronological, getScene, searchBeats } from "../rag/scenes.js";
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

  server.tool(
    "get_scene",
    "Get a scene by ID, optionally including its full beat-by-beat narrative",
    {
      id: z.string().describe("ID of the scene to retrieve"),
      include_beats: z.boolean().optional().describe("Include full beat-by-beat narrative (default false)"),
    },
    async ({ id, include_beats }) => {
      try {
        const scene = await getScene(campaignPath, id, { include_beats });
        if (scene === null) {
          return {
            content: [{ type: "text", text: `Scene not found: ${id}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(scene) }],
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
    "search_beats",
    [
      "Search scene beats using semantic similarity. Finds specific moments of dialogue, narration, or move resolution across all scenes.",
      "The response includes `beats` (matched results) and `total_beats` (count of all beats in scope before the query/limit is applied).",
      "Use `total_beats` to distinguish 'no match' (total_beats > 0, beats empty) from 'no data' (total_beats === 0, scene has no beats recorded).",
    ].join(" "),
    {
      query: z.string().describe("Search query"),
      k: z.number().int().positive().optional().describe("Number of results to return (default 5)"),
      kind: z.string().optional().describe("Filter by beat kind: narration, dialogue, move, choice, oracle"),
      scene_id: z.string().optional().describe("Filter to beats from a specific scene"),
    },
    async ({ query, k, kind, scene_id }) => {
      try {
        const result = await searchBeats(campaignPath, query, k, { kind, scene_id });
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
    "get_recent_complications",
    "Retrieve recent scenes tagged with a complication theme, ordered newest-first. Use before narrating a new complication to check for thematic repetition.",
    {
      k: z.coerce.number().int().positive().optional().describe("Number of recent complications to return (default 5)"),
    },
    async ({ k }) => {
      try {
        const results = await getRecentComplications(campaignPath, k ?? 5);
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
    "session_briefing",
    [
      "Consolidated session-start view. Call this as the FIRST tool at the start of every session (or any morning-after / recap scene) before narrating anything.",
      "Returns: character digest, progress tracks bucketed into open/ready/completed, narrative threads split into open/closed_recently, and the N most recent scenes in chronological oldest-first order.",
      "Key invariant: tracks with ticks==40 are in 'ready' (completion pending), NOT 'open'. Never narrate ready/completed tracks as active threats.",
    ].join(" "),
    {
      recent_scenes_k: z.coerce.number().int().positive().optional().describe(
        "Number of recent scenes to return, oldest-first (default 5)",
      ),
      closed_threads_k: z.coerce.number().int().positive().optional().describe(
        "Number of recently-closed threads to include (default 3)",
      ),
    },
    async ({ recent_scenes_k, closed_threads_k }) => {
      try {
        const scenesK = recent_scenes_k ?? 5;
        const closedK = closed_threads_k ?? 3;

        // Load all data in parallel; degrade gracefully for each section.
        const [character, allThreads, recentScenes] = await Promise.all([
          loadCharacter(campaignPath),
          listThreads(campaignPath).catch(() => []),
          getRecentScenesChronological(campaignPath, scenesK).catch(() => []),
        ]);

        // --- Character digest ---
        const activeDebilities = Object.fromEntries(
          Object.entries(character.debilities).filter(([, v]) => v === true),
        );
        const digest = {
          name: character.name,
          momentum: character.momentum,
          health: character.health,
          spirit: character.spirit,
          supply: character.supply,
          debilities: activeDebilities,
          bonds: character.bonds,
        };

        // --- Track bucketing ---
        // open     = ticks < 40 AND completed == false
        // ready    = ticks == 40 AND completed == false (full — completion roll pending)
        // completed = completed == true
        const tracks = {
          open: character.progressTracks.filter(
            (t) => !t.completed && t.ticks < 40,
          ),
          ready: character.progressTracks.filter(
            (t) => !t.completed && t.ticks >= 40,
          ),
          completed: character.progressTracks.filter((t) => t.completed),
        };

        // --- Thread bucketing ---
        const openThreads = allThreads.filter((t) => t.status === "open");
        // closed_recently: last N closed threads, most-recently-closed first
        const closedThreads = allThreads
          .filter((t) => t.status === "closed")
          .sort((a, b) => {
            const ta = a.closedAt ?? "";
            const tb = b.closedAt ?? "";
            return tb.localeCompare(ta);
          })
          .slice(0, closedK);

        const briefing = {
          character: digest,
          tracks,
          threads: {
            open: openThreads,
            closed_recently: closedThreads,
          },
          recent_scenes: recentScenes,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(briefing) }],
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
