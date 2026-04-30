import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordScene } from "../rag/scenes.js";
import { openThread, closeThread } from "../state/threads.js";
import { upsertNpc } from "../state/npcs.js";

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "record_scene",
    "Record a scene summary into the scene journal",
    {
      summary: z.string().describe("Scene summary text to record"),
      kind: z.string().optional().describe("Kind of scene (e.g. 'combat', 'exploration', 'social')"),
    },
    async ({ summary, kind }) => {
      try {
        await recordScene(campaignPath, summary, kind);
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
