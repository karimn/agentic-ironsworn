import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordScene, getScene, updateScene, deleteScene, recordBeat, recordBeats, setSceneEntityRefs, type BeatInput } from "../rag/scenes.js";
import { openThread, closeThread } from "../state/threads.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { getLore, upsertLore } from "../rag/lore.js";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn, getWorldEmbedding } from "../rag/world-db.js";
import { slugify } from "../rag/lore.js";
import { recordMutation } from "../checkpoint.js";
import { pushBeat, drainNotices } from "../rag/beat-queue.js";

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

export interface SceneReferenceResult {
  warnings: string[];
  stubbed: { npcs: string[]; lore: string[] };
}

// ---------------------------------------------------------------------------
// Auto-stub + scene_entity_refs FK writing
// ---------------------------------------------------------------------------

/**
 * Resolve or auto-stub entities for scene refs, then write scene_entity_refs rows.
 *
 * For each name in `npcs`: look up visible person entity; if not found, create a
 * campaign-scoped person entity (auto-stub). For each id in `loreIds`: look up visible
 * entity; if not found, create a campaign-scoped concept entity.
 *
 * All resolved/stubbed entities are written to scene_entity_refs with role='present'.
 *
 * Returns stubbed names (no warnings emitted for auto-stubs — these are FK-backed now).
 */
async function _resolveAndWriteEntityRefs(
  campaignPath: string,
  sceneId: string,
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

  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const refs: { entity_id: string; role: string }[] = [];

  // --- NPCs ---
  if (npcs !== undefined) {
    for (const name of npcs) {
      // First try getNpc (uses the entity store)
      const found = await getNpc(campaignPath, name);
      if (found !== null) {
        // Resolve the UUID for this person entity
        const conn = await instance.connect();
        try {
          const result = await conn.runAndReadAll(
            `SELECT id FROM entities
             WHERE type = 'person'
               AND (campaign_id IS NULL OR campaign_id = ?)
               AND (lower(canonical) = ? OR lower(slug) = ?
                    OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?))
             ORDER BY (campaign_id IS NOT NULL) DESC LIMIT 1`,
            [ctx.campaignId, name.toLowerCase(), name.toLowerCase(), name.toLowerCase()],
          );
          const rows = result.getRowObjectsJS() as Record<string, unknown>[];
          if (rows.length > 0) {
            refs.push({ entity_id: String(rows[0]!["id"]), role: "present" });
          }
        } finally {
          conn.closeSync();
        }
      } else {
        // Auto-stub: create a minimal person entity
        await upsertNpc(campaignPath, name);
        stubbed.npcs.push(name);
        // Get the newly created entity's UUID
        const conn = await instance.connect();
        try {
          const result = await conn.runAndReadAll(
            `SELECT id FROM entities
             WHERE type = 'person' AND campaign_id = ? AND lower(canonical) = ?
             ORDER BY created_at DESC LIMIT 1`,
            [ctx.campaignId, name.toLowerCase()],
          );
          const rows = result.getRowObjectsJS() as Record<string, unknown>[];
          if (rows.length > 0) {
            refs.push({ entity_id: String(rows[0]!["id"]), role: "present" });
          }
        } finally {
          conn.closeSync();
        }
      }
    }
  }

  // --- Lore IDs ---
  if (loreIds !== undefined) {
    for (const id of loreIds) {
      const found = await getLore(campaignPath, id);
      if (found !== null) {
        refs.push({ entity_id: found.id, role: "present" });
      } else {
        // Auto-stub: create a concept entity (requires Ollama for embedding; falls back gracefully)
        try {
          const result = await upsertLore(campaignPath, {
            id,
            canonical: id,
            type: "concept",
            summary: id,
          });
          stubbed.lore.push(id);
          refs.push({ entity_id: result.id, role: "present" });
        } catch {
          // Ollama unavailable — fall back to warning (no FK ref written)
          warnings.push(`Lore entity not recorded: "${id}". Call upsert_lore to record this entity.`);
        }
      }
    }
  }

  // Write scene_entity_refs
  if (refs.length > 0) {
    await setSceneEntityRefs(campaignPath, sceneId, refs);
  }

  return { warnings, stubbed };
}

/**
 * buildSceneWarnings — exported for backward compat with tests.
 *
 * When called from record_scene / update_scene, this now writes scene_entity_refs
 * and auto-stubs unknown entities. The name "warnings" is historical — most callers
 * now get an empty warnings array (auto-stubs replaced warnings).
 */
export async function buildSceneWarnings(
  campaignPath: string,
  npcs: string[] | undefined,
  loreIds: string[] | undefined,
  sceneId?: string,
): Promise<SceneReferenceResult> {
  // If no sceneId, we're in the legacy path (update_scene without entity refs)
  // Still do the auto-stub + entity existence check, just skip scene_entity_refs write.
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
        await upsertNpc(campaignPath, name);
        stubbed.npcs.push(name);
      }
    }
  }

  if (loreIds !== undefined) {
    for (const id of loreIds) {
      const found = await getLore(campaignPath, id);
      if (found === null) {
        try {
          await upsertLore(campaignPath, {
            id,
            canonical: id,
            type: "concept",
            summary: id,
          });
          stubbed.lore.push(id);
        } catch {
          warnings.push(`Lore entity not recorded: "${id}". Call upsert_lore to record this entity.`);
        }
      }
    }
  }

  // If we have a sceneId, also write FK refs
  if (sceneId !== undefined && (stubbed.npcs.length > 0 || stubbed.lore.length > 0 || (npcs && npcs.length > 0) || (loreIds && loreIds.length > 0))) {
    try {
      const result = await _resolveAndWriteEntityRefs(campaignPath, sceneId, npcs, loreIds);
      // Merge: the refs are already written; merge any additional stubbed names
      for (const n of result.stubbed.npcs) {
        if (!stubbed.npcs.includes(n)) stubbed.npcs.push(n);
      }
      for (const l of result.stubbed.lore) {
        if (!stubbed.lore.includes(l)) stubbed.lore.push(l);
      }
    } catch {
      // Non-fatal: entity ref writing failure should not break record_scene
    }
  }

  return { warnings, stubbed };
}

const THREAD_KINDS = ["goal", "threat", "debt", "other"] as const;

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
      quality_notes: z.string().optional().describe(
        "Optional fiction/RP quality feedback for this scene (e.g. 'Combat felt dangerous — layered pressure worked well', 'Complication theme was repetitive'). Captured for GM improvement and included in semantic search."
      ),
      place: z.string().optional().describe(
        "Optional place entity name or UUID to anchor the scene geographically. Resolved to a place_entity UUID on the scene row."
      ),
    },
    async ({ summary, kind, npcs, lore_ids, complication_theme, beats, quality_notes, place }) => {
      try {
        const id = await recordScene(campaignPath, summary, kind, complication_theme, beats as BeatInput[] | undefined, quality_notes, place);
        recordMutation(campaignPath);
        // Write scene_entity_refs + auto-stub unknown names
        const { warnings, stubbed } = await _resolveAndWriteEntityRefs(campaignPath, id, npcs, lore_ids);
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
      quality_notes: z.string().optional().describe(
        "Fiction/RP quality feedback to set or replace on this scene"
      ),
    },
    async ({ id, summary, kind, npcs, lore_ids, append_beats, quality_notes }) => {
      try {
        const existing = await getScene(campaignPath, id);
        if (existing === null) {
          return {
            content: [{ type: "text", text: `Error: Scene not found: ${id}` }],
            isError: true,
          };
        }
        await updateScene(campaignPath, id, { summary, kind, quality_notes });
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
    "Append a single beat to an existing scene in real time, as events happen during play. " +
    "Returns immediately by default (fire-and-forget); the embedding and DB write happen in the background. " +
    "Pass wait=true only when you need the beat fully persisted before continuing (e.g. before export_campaign or close_scene).",
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
      wait: z.boolean().optional().describe(
        "If true, block until the beat is fully persisted before returning. Default: false (fire-and-forget)."
      ),
    },
    async ({ scene_id, kind, text, speaker, metadata, wait }) => {
      const existing = await getScene(campaignPath, scene_id);
      if (existing === null) {
        return {
          content: [{ type: "text", text: `Error: Scene not found: ${scene_id}` }],
          isError: true,
        };
      }

      const entry = await pushBeat(campaignPath, scene_id, { kind, text, speaker, metadata });

      if (wait) {
        try {
          await entry.settled;
        } catch (e) {
          const notices = drainNotices(campaignPath);
          const body: Record<string, unknown> = {
            error: e instanceof Error ? e.message : String(e),
          };
          if (notices.length > 0) body.notices = notices;
          return {
            content: [{ type: "text", text: JSON.stringify(body) }],
            isError: true,
          };
        }
      }

      recordMutation(campaignPath);

      const notices = drainNotices(campaignPath);
      for (const notice of notices) {
        void server.sendLoggingMessage({ level: "warning", data: notice });
      }

      const responseBody: Record<string, unknown> = { queued: true };
      if (entry.beatIndex !== null) responseBody.beat_index = entry.beatIndex;
      if (notices.length > 0) responseBody.notices = notices;

      return {
        content: [{ type: "text", text: JSON.stringify(responseBody) }],
      };
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
    "Open a new narrative thread.",
    {
      title: z.string().describe("Title of the thread"),
      kind: z.enum(THREAD_KINDS).describe("Kind of thread"),
      notes: z.string().optional().describe("Optional notes about the thread"),
    },
    async ({ title, kind, notes }) => {
      try {
        const thread = await openThread(campaignPath, title, kind, notes);
        recordMutation(campaignPath);
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
    "Close an existing narrative thread with a resolution.",
    {
      title: z.string().describe("Title of the thread to close (case-insensitive)"),
      resolution: z.string().describe("How the thread was resolved"),
    },
    async ({ title, resolution }) => {
      try {
        const thread = await closeThread(campaignPath, title, resolution);
        recordMutation(campaignPath);
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
