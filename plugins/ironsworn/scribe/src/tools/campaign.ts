import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadCharacter, saveCharacter } from "../state/character.js";
import { loadThreads, saveThreads } from "../state/threads.js";
import { listNpcs, writeNpcRaw } from "../state/npcs.js";
import { exportLore, upsertLore, linkLore, type LoreType } from "../rag/lore.js";
import { exportScenes, importScene } from "../rag/scenes.js";

interface CampaignExport {
  version: 1;
  exported_at: string;
  character: unknown;
  threads: unknown[];
  npcs: Record<string, string>;
  lore_entities: unknown[];
  lore_relations: unknown[];
  scenes: unknown[];
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "export_campaign",
    "Serialise all campaign data to a portable JSON file. Includes character, threads, NPCs, lore, and scenes. Set include_scenes=false for a lighter world-pack export (lore + NPCs + threads only).",
    {
      output_path: z.string().describe("Absolute path where the JSON export will be written"),
      include_scenes: z.boolean().optional().describe("Include scene summaries (default true); false = world-pack mode"),
    },
    async ({ output_path, include_scenes }) => {
      try {
        const [character, threads, npcs, { entities, relations }, scenes] = await Promise.all([
          loadCharacter(campaignPath).catch(() => null),
          loadThreads(campaignPath),
          listNpcs(campaignPath),
          exportLore(campaignPath).catch(() => ({ entities: [], relations: [] })),
          include_scenes !== false
            ? exportScenes(campaignPath).catch(() => [])
            : Promise.resolve([]),
        ]);

        const payload: CampaignExport = {
          version: 1,
          exported_at: new Date().toISOString(),
          character,
          threads,
          npcs,
          lore_entities: entities,
          lore_relations: relations,
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
        const data = JSON.parse(raw) as CampaignExport;

        if (data.version !== 1) {
          return {
            content: [{ type: "text", text: `Unsupported export version: ${data.version}` }],
            isError: true,
          };
        }

        const counts = { character: 0, threads: 0, npcs: 0, lore_entities: 0, lore_relations: 0, scenes: 0 };

        if (data.character) {
          await saveCharacter(campaignPath, data.character as Parameters<typeof saveCharacter>[1]);
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
            });
            counts.lore_relations++;
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
