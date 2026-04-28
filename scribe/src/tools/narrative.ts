import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordScene } from "../rag/scenes.js";
import { openThread, closeThread } from "../state/threads.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { getLore } from "../rag/lore.js";

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
    },
    async ({ summary, kind, npcs, lore_ids }) => {
      try {
        await recordScene(campaignPath, summary, kind);
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
    "Open a new narrative thread",
    {
      title: z.string().describe("Title of the thread"),
      kind: z.enum(["vow", "threat", "debt", "other"]).describe("Kind of thread"),
      notes: z.string().optional().describe("Optional notes about the thread"),
    },
    async ({ title, kind, notes }) => {
      try {
        const thread = await openThread(campaignPath, title, kind, notes);
        return {
          content: [{ type: "text", text: JSON.stringify(thread) }],
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
    "Close an existing narrative thread with a resolution",
    {
      title: z.string().describe("Title of the thread to close (case-insensitive)"),
      resolution: z.string().describe("How the thread was resolved"),
    },
    async ({ title, resolution }) => {
      try {
        const thread = await closeThread(campaignPath, title, resolution);
        return {
          content: [{ type: "text", text: JSON.stringify(thread) }],
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
