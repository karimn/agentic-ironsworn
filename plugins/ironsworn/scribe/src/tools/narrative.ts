import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordScene } from "../rag/scenes.js";
import { openThread, closeThread } from "../state/threads.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { getLore } from "../rag/lore.js";
import { loadCharacter, saveCharacter, ProgressTrack } from "../state/character.js";
import { recordMutation } from "../checkpoint.js";

// ---------------------------------------------------------------------------
// Warning helpers (exported for testing)
// ---------------------------------------------------------------------------

export async function buildSceneWarnings(
  campaignPath: string,
  npcs: string[] | undefined,
  loreIds: string[] | undefined,
): Promise<string[]> {
  const warnings: string[] = [];

  if (npcs === undefined && loreIds === undefined) {
    warnings.push(
      "Reminder: Have you recorded all NPCs and lore entities introduced in this scene? Call upsert_npc and upsert_lore if needed.",
    );
    return warnings;
  }

  if (npcs !== undefined) {
    for (const name of npcs) {
      const found = await getNpc(campaignPath, name);
      if (found === null) {
        warnings.push(`NPC not recorded: "${name}". Call upsert_npc to record this NPC.`);
      }
    }
  }

  if (loreIds !== undefined) {
    for (const id of loreIds) {
      const found = await getLore(campaignPath, id);
      if (found === null) {
        warnings.push(`Lore entity not recorded: "${id}". Call upsert_lore to record this entity.`);
      }
    }
  }

  return warnings;
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "record_scene",
    "Record a scene summary into the scene journal",
    {
      summary: z.string().describe("Scene summary text to record"),
      kind: z.string().optional().describe("Kind of scene (e.g. 'combat', 'exploration', 'social')"),
      npcs: z.array(z.string()).optional().describe("NPC names introduced in this scene to verify are recorded"),
      lore_ids: z.array(z.string()).optional().describe("Lore entity IDs or canonical names introduced in this scene to verify are recorded"),
      complication_theme: z.string().optional().describe(
        "Freeform thematic category of the complication (e.g. 'weather', 'beasts', 'fungal-network', 'physical-hazard'). Set only when the scene involves a miss/complication."
      ),
    },
    async ({ summary, kind, npcs, lore_ids, complication_theme }) => {
      try {
        await recordScene(campaignPath, summary, kind, complication_theme);
        recordMutation(campaignPath);
        const warnings = await buildSceneWarnings(campaignPath, npcs, lore_ids);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, warnings }) }],
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
    "open_thread",
    "Open a new narrative thread. When kind is 'vow', provide a rank to automatically create a matching progress track on the character.",
    {
      title: z.string().describe("Title of the thread"),
      kind: z.enum(["vow", "threat", "debt", "other"]).describe("Kind of thread"),
      notes: z.string().optional().describe("Optional notes about the thread"),
      rank: z
        .enum(["troublesome", "dangerous", "formidable", "extreme", "epic"])
        .optional()
        .describe("Difficulty rank (required for vow kind to auto-create a matching progress track)"),
    },
    async ({ title, kind, notes, rank }) => {
      try {
        const thread = await openThread(campaignPath, title, kind, notes);

        // Issue #2: auto-create a matching progress track for vow threads
        let track: ProgressTrack | undefined;
        if (kind === "vow" && rank !== undefined) {
          const character = await loadCharacter(campaignPath);
          track = { name: title, rank: rank as ProgressTrack["rank"], kind: "vow", ticks: 0, completed: false };
          character.progressTracks.push(track);
          await saveCharacter(campaignPath, character);
        }

        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ...thread, progressTrack: track ?? null }) }],
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
    "close_thread",
    "Close an existing narrative thread with a resolution. If the thread is a vow, also marks the matching progress track as completed (case-insensitive name match).",
    {
      title: z.string().describe("Title of the thread to close (case-insensitive)"),
      resolution: z.string().describe("How the thread was resolved"),
    },
    async ({ title, resolution }) => {
      try {
        const thread = await closeThread(campaignPath, title, resolution);

        // Issue #3: mark matching progress track completed when closing a vow
        let trackUpdated = false;
        if (thread.kind === "vow") {
          const character = await loadCharacter(campaignPath);
          const idx = character.progressTracks.findIndex(
            (t) => t.name.toLowerCase() === title.toLowerCase(),
          );
          if (idx !== -1) {
            character.progressTracks[idx]!.completed = true;
            await saveCharacter(campaignPath, character);
            trackUpdated = true;
          }
        }

        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ...thread, progressTrackCompleted: trackUpdated }) }],
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
    "upsert_npc",
    "Create or update an NPC entry",
    {
      name: z.string().describe("Name of the NPC"),
      description: z.string().optional().describe("Description of the NPC"),
      impression: z.string().optional().describe("Impression or notes about the NPC"),
    },
    async ({ name, description, impression }) => {
      try {
        await upsertNpc(campaignPath, name, description, impression);
        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
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
