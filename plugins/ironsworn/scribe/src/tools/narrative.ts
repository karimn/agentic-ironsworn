import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordScene, getScene, updateScene, deleteScene, recordBeat, recordBeats, type BeatInput } from "../rag/scenes.js";
import { openThread, closeThread } from "../state/threads.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { getLore, upsertLore } from "../rag/lore.js";
import { loadCharacter, saveCharacter, ProgressTrack } from "../state/character.js";
import { recordMutation } from "../checkpoint.js";

const BeatInputSchema = z.object({
  kind: z.enum(["narration", "dialogue", "move", "choice", "oracle"]).describe(
    "Type of beat: narration (descriptive prose), dialogue (NPC/player speech), move (mechanical resolution), choice (player decision point), oracle (oracle roll + interpretation)"
  ),
  speaker: z.string().optional().describe("Speaker name for dialogue beats"),
  text: z.string().describe("Full text of the beat"),
  metadata: z.record(z.string(), z.unknown()).optional().describe(
    "Structured data for move beats (e.g. {move: 'Face Danger', stat: 'edge', outcome: 'weak_hit'})"
  ),
});

// ---------------------------------------------------------------------------
// Warning helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface SceneReferenceResult {
  warnings: string[];
  stubbed: { npcs: string[]; lore: string[] };
}

export async function buildSceneWarnings(
  campaignPath: string,
  npcs: string[] | undefined,
  loreIds: string[] | undefined,
): Promise<SceneReferenceResult> {
  const warnings: string[] = [];
  const stubbed: { npcs: string[]; lore: string[] } = { npcs: [], lore: [] };

  if (npcs === undefined && loreIds === undefined) {
    warnings.push(
      "Reminder: Have you recorded all NPCs and lore entities introduced in this scene? Call upsert_npc and upsert_lore if needed.",
    );
    return { warnings, stubbed };
  }

  if (npcs !== undefined) {
    for (const name of npcs) {
      const found = await getNpc(campaignPath, name);
      if (found === null) {
        // Auto-stub: create a minimal NPC record so the scene reference is linked
        await upsertNpc(campaignPath, name);
        stubbed.npcs.push(name);
      }
    }
  }

  if (loreIds !== undefined) {
    for (const id of loreIds) {
      const found = await getLore(campaignPath, id);
      if (found === null) {
        // Auto-stub: attempt to create a minimal lore entry (requires Ollama for embedding)
        try {
          await upsertLore(campaignPath, {
            id,
            canonical: id,
            type: "concept",
            summary: id,
          });
          stubbed.lore.push(id);
        } catch {
          // Ollama unavailable or other embedding failure — fall back to warning
          warnings.push(`Lore entity not recorded: "${id}". Call upsert_lore to record this entity.`);
        }
      }
    }
  }

  return { warnings, stubbed };
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "record_scene",
    "Record a scene summary into the scene journal. Optionally include beats — ordered narrative units capturing the full texture of the scene.",
    {
      summary: z.string().describe("Scene summary text to record"),
      kind: z.string().optional().describe("Kind of scene (e.g. 'combat', 'exploration', 'social')"),
      npcs: z.array(z.string()).optional().describe("NPC names introduced in this scene to verify are recorded"),
      lore_ids: z.array(z.string()).optional().describe("Lore entity IDs or canonical names introduced in this scene to verify are recorded"),
      complication_theme: z.string().optional().describe(
        "Freeform thematic category of the complication (e.g. 'weather', 'beasts', 'fungal-network', 'physical-hazard'). Set only when the scene involves a miss/complication."
      ),
      beats: z.array(BeatInputSchema).optional().describe(
        "Optional ordered narrative beats for the scene. When omitted, only the summary is stored (backward-compatible)."
      ),
    },
    async ({ summary, kind, npcs, lore_ids, complication_theme, beats }) => {
      try {
        const id = await recordScene(campaignPath, summary, kind, complication_theme, beats as BeatInput[] | undefined);
        recordMutation(campaignPath);
        const { warnings, stubbed } = await buildSceneWarnings(campaignPath, npcs, lore_ids);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, id, warnings, stubbed }) }],
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
    "update_scene",
    "Update an existing scene record. Only provided fields are changed. Use append_beats to add new beats without replacing existing ones.",
    {
      id: z.string().describe("ID of the scene to update"),
      summary: z.string().optional().describe("New summary text (replaces existing)"),
      kind: z.string().optional().describe("New kind of scene"),
      npcs: z.array(z.string()).optional().describe("NPC names to verify are recorded"),
      lore_ids: z.array(z.string()).optional().describe("Lore entity IDs to verify are recorded"),
      append_beats: z.array(BeatInputSchema).optional().describe(
        "New beats to append to the scene's existing beats array (does not replace existing beats)"
      ),
    },
    async ({ id, summary, kind, npcs, lore_ids, append_beats }) => {
      try {
        const existing = await getScene(campaignPath, id);
        if (existing === null) {
          return {
            content: [{ type: "text", text: `Error: Scene not found: ${id}` }],
            isError: true,
          };
        }
        await updateScene(campaignPath, id, { summary, kind });
        if (append_beats && append_beats.length > 0) {
          await recordBeats(campaignPath, id, append_beats as BeatInput[]);
        }
        recordMutation(campaignPath);
        const { warnings, stubbed } = await buildSceneWarnings(campaignPath, npcs, lore_ids);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, id, warnings, stubbed }) }],
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
    "record_beat",
    "Append a single beat to an existing scene in real time, as events happen during play. Returns the 0-based index of the appended beat.",
    {
      scene_id: z.string().describe("ID of the scene to append the beat to"),
      kind: z.enum(["dialogue", "narration", "move", "choice", "oracle"]).describe(
        "Type of beat: dialogue (NPC/player speech), narration (descriptive prose), move (mechanical resolution), choice (player decision point), oracle (oracle roll + interpretation)"
      ),
      text: z.string().describe("Full text of the beat"),
      speaker: z.string().optional().describe("Speaker name for dialogue beats"),
      metadata: z.record(z.string(), z.unknown()).optional().describe(
        "Structured data for move beats (e.g. {move: 'Face Danger', stat: 'edge', outcome: 'weak_hit'})"
      ),
    },
    async ({ scene_id, kind, text, speaker, metadata }) => {
      try {
        const beatIndex = await recordBeat(campaignPath, scene_id, { kind, text, speaker, metadata });
        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ beat_index: beatIndex }) }],
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
    "delete_scene",
    "Delete a scene record by ID",
    {
      id: z.string().describe("ID of the scene to delete"),
    },
    async ({ id }) => {
      try {
        const existing = await getScene(campaignPath, id);
        if (existing === null) {
          return {
            content: [{ type: "text", text: `Error: Scene not found: ${id}` }],
            isError: true,
          };
        }
        await deleteScene(campaignPath, id);
        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, id }) }],
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
          track = { name: title, rank: rank as ProgressTrack["rank"], kind: "vow", ticks: 0, status: "active" };
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
    "Close an existing narrative thread with a resolution. If the thread is a vow, also marks the matching progress track as fulfilled (case-insensitive name match).",
    {
      title: z.string().describe("Title of the thread to close (case-insensitive)"),
      resolution: z.string().describe("How the thread was resolved"),
    },
    async ({ title, resolution }) => {
      try {
        const thread = await closeThread(campaignPath, title, resolution);

        // Issue #3: mark matching progress track fulfilled when closing a vow
        let trackUpdated = false;
        if (thread.kind === "vow") {
          const character = await loadCharacter(campaignPath);
          const idx = character.progressTracks.findIndex(
            (t) => t.name.toLowerCase() === title.toLowerCase(),
          );
          if (idx !== -1) {
            character.progressTracks[idx]!.status = "fulfilled";
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
