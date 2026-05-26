import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadThreads, saveThreads } from "../state/threads.js";
import { listNpcs, writeNpcRaw } from "../state/npcs.js";
import { exportLore, exportProvenance, upsertLore, linkLore, checkpointLore, replayProvenance, type LoreType } from "../rag/lore.js";
import { exportProximity, linkProximity, type ProximityDimension, type CompassPoint, type OrderKind } from "../rag/proximity.js";
import { exportScenes, importScene, checkpointScenes, type BeatExport } from "../rag/scenes.js";
import { shutdown as drainBeatQueue } from "../rag/beat-queue.js";

interface CampaignExport {
  version: 2;
  exported_at: string;
  character: unknown;
  threads: unknown[];
  npcs: Record<string, string>;
  lore_entities: unknown[];
  lore_relations: unknown[];
  lore_proximity: unknown[];
  lore_provenance: unknown[];
  scenes: unknown[];
}

async function _loadCharacterData(campaignPath: string): Promise<unknown> {
  try {
    const raw = await readFile(join(campaignPath, "character.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _saveCharacterData(campaignPath: string, data: unknown): Promise<void> {
  const filePath = join(campaignPath, "character.json");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "checkpoint_now",
    "Force an immediate DuckDB checkpoint, flushing the WAL to the tracked .duckdb files. Use after bulk writes or before ending a session.",
    {},
    async () => {
      try {
        await drainBeatQueue(campaignPath);
        await Promise.all([
          checkpointLore(campaignPath),
          checkpointScenes(campaignPath),
        ]);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Checkpoint complete" }) }],
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
    "export_campaign",
    "Serialise all campaign data to a portable JSON file. Includes character, threads, NPCs, lore, and scenes. Set include_scenes=false for a lighter world-pack export (lore + NPCs + threads only).",
    {
      output_path: z.string().describe("Absolute path where the JSON export will be written"),
      include_scenes: z.boolean().optional().describe("Include scene summaries (default true); false = world-pack mode"),
    },
    async ({ output_path, include_scenes }) => {
      try {
        await drainBeatQueue(campaignPath);
        await Promise.all([
          checkpointLore(campaignPath).catch(() => undefined),
          checkpointScenes(campaignPath).catch(() => undefined),
        ]);

        const [character, threads, npcs, { entities, relations }, proximity, provenance, scenes] = await Promise.all([
          _loadCharacterData(campaignPath),
          loadThreads(campaignPath),
          listNpcs(campaignPath),
          exportLore(campaignPath).catch(() => ({ entities: [], relations: [] })),
          exportProximity(campaignPath).catch(() => []),
          exportProvenance(campaignPath).catch(() => []),
          include_scenes !== false
            ? exportScenes(campaignPath).catch(() => [])
            : Promise.resolve([]),
        ]);

        const payload: CampaignExport = {
          version: 2,
          exported_at: new Date().toISOString(),
          character,
          threads,
          npcs,
          lore_entities: entities,
          lore_relations: relations,
          lore_proximity: proximity,
          lore_provenance: provenance,
          scenes,
        };

        await mkdir(dirname(output_path), { recursive: true });
        await writeFile(output_path, JSON.stringify(payload, null, 2), "utf-8");

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              output_path,
              counts: {
                lore_entities: entities.length,
                lore_relations: relations.length,
                lore_proximity: proximity.length,
                lore_provenance: provenance.length,
                npcs: Object.keys(npcs).length,
                threads: threads.length,
                scenes: scenes.length,
              },
            }),
          }],
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
    "import_campaign",
    "Reconstruct campaign data from a JSON export file. Idempotent — re-importing the same file will not duplicate records. Lore and scene import requires Ollama to be running for embedding regeneration.",
    {
      input_path: z.string().describe("Absolute path to the JSON export file"),
    },
    async ({ input_path }) => {
      try {
        const raw = await readFile(input_path, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const exportVersion = parsed["version"] as number;

        if (exportVersion !== 1 && exportVersion !== 2) {
          return {
            content: [{ type: "text", text: `Unsupported export version: ${exportVersion}` }],
            isError: true,
          };
        }

        const data = parsed as unknown as CampaignExport;

        const counts = { character: 0, threads: 0, npcs: 0, lore_entities: 0, lore_relations: 0, lore_proximity: 0, lore_provenance: 0, scenes: 0 };

        if (data.character) {
          await _saveCharacterData(campaignPath, data.character);
          counts.character = 1;
        }

        if (Array.isArray(data.threads)) {
          await saveThreads(campaignPath, data.threads as Parameters<typeof saveThreads>[1]);
          counts.threads = data.threads.length;
        }

        if (data.npcs && typeof data.npcs === "object") {
          for (const [filename, content] of Object.entries(data.npcs)) {
            await writeNpcRaw(campaignPath, filename, content);
            counts.npcs++;
          }
        }

        if (Array.isArray(data.lore_entities)) {
          for (const entity of data.lore_entities) {
            const e = entity as Record<string, unknown>;
            await upsertLore(campaignPath, {
              id: String(e["id"]),
              canonical: String(e["canonical"]),
              type: String(e["type"]) as LoreType,
              summary: String(e["summary"]),
              content: (e["content"] ?? {}) as Record<string, unknown>,
              metadata: (e["metadata"] ?? {}) as Record<string, unknown>,
              aliases: Array.isArray(e["aliases"]) ? (e["aliases"] as unknown[]).map(String) : [],
              _created_at: e["created_at"] != null ? String(e["created_at"]) : undefined,
              _skipRecordingProvenance: true,
            });
            counts.lore_entities++;
          }
        }

        if (Array.isArray(data.lore_relations)) {
          for (const rel of data.lore_relations) {
            const r = rel as Record<string, unknown>;
            await linkLore(campaignPath, {
              from: String(r["from_id"]),
              to: String(r["to_id"]),
              relation: String(r["relation"]),
              notes: r["notes"] != null ? String(r["notes"]) : undefined,
              metadata: (r["metadata"] ?? {}) as Record<string, unknown>,
              _created_at: r["created_at"] != null ? String(r["created_at"]) : undefined,
              _skipRecordingProvenance: true,
            });
            counts.lore_relations++;
          }
        }

        if (Array.isArray(data.lore_proximity)) {
          for (const edge of data.lore_proximity) {
            const e = edge as Record<string, unknown>;
            const dimension = String(e["dimension"]) as ProximityDimension;
            const direction = e["direction"] != null ? (String(e["direction"]) as CompassPoint) : undefined;
            const order_kind = e["order_kind"] != null ? (String(e["order_kind"]) as OrderKind) : undefined;
            const magRaw = e["magnitude"];
            const magnitude = typeof magRaw === "number" ? magRaw : Number(magRaw);

            const input: Parameters<typeof linkProximity>[1] = {
              from: String(e["from_id"]),
              to: String(e["to_id"]),
              dimension,
              magnitude,
              metadata: (e["metadata"] ?? {}) as Record<string, unknown>,
              _created_at: e["created_at"] != null ? String(e["created_at"]) : undefined,
              _skipRecordingProvenance: true,
            };
            if (direction !== undefined) input.direction = direction;
            if (order_kind !== undefined) input.order_kind = order_kind;
            if (e["notes"] != null) input.notes = String(e["notes"]);

            await linkProximity(campaignPath, input);
            counts.lore_proximity++;
          }
        }

        if (Array.isArray(data.lore_provenance)) {
          for (const entry of data.lore_provenance) {
            const p = entry as Record<string, unknown>;
            await replayProvenance(campaignPath, {
              id: String(p["id"]),
              subject_kind: String(p["subject_kind"]) as "entity" | "relation" | "proximity",
              subject_id: String(p["subject_id"]),
              source_kind: String(p["source_kind"]),
              source_id: p["source_id"] != null ? String(p["source_id"]) : null,
              excerpt: p["excerpt"] != null ? String(p["excerpt"]) : null,
              confidence: typeof p["confidence"] === "number" ? p["confidence"] : null,
              created_at: String(p["created_at"]),
            });
            counts.lore_provenance++;
          }
        }

        if (Array.isArray(data.scenes)) {
          for (const scene of data.scenes) {
            const s = scene as Record<string, unknown>;
            const inserted = await importScene(
              campaignPath,
              String(s["id"]),
              String(s["text"]),
              String(s["timestamp"]),
              String(s["kind"] ?? "scene"),
          s["complication_theme"] != null ? String(s["complication_theme"]) : undefined,
          Array.isArray(s["beats"]) ? (s["beats"] as BeatExport[]) : undefined,
          s["quality_notes"] != null ? String(s["quality_notes"]) : undefined,
            );
            if (inserted) counts.scenes++;
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: true, imported: counts }),
          }],
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
