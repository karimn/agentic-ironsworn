import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadCharacter,
  saveCharacter,
  takeMomentum,
  sufferHarm,
  sufferStress,
  consumeSupply,
  restoreHealth,
  restoreSpirit,
  restoreSupply,
  inflictDebility,
  clearDebility,
  overrideField,
  appendJournal,
  Character,
} from "../state/character.js";
import { burnMomentum } from "../rules/ironsworn/momentum.js";
import { tickProgress } from "../rules/ironsworn/progress.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function characterDigest(char: Character) {
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
    "take_momentum",
    "Add or remove momentum from the character",
    { delta: z.number().int().describe("Amount to add (positive) or remove (negative)") },
    async ({ delta }) => {
      try {
        const result = await takeMomentum(campaignPath, delta);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "burn_momentum",
    "Burn momentum to reset it to the momentum reset value",
    {},
    async () => {
      try {
        const character = await loadCharacter(campaignPath);
        const result = burnMomentum(character);
        await saveCharacter(campaignPath, result.after);
        await appendJournal(campaignPath, {
          timestamp: new Date().toISOString(),
          kind: "burnMomentum",
          before: result.before,
          after: result.after,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "suffer_harm",
    "Reduce character health by n points",
    { n: z.number().int().positive().describe("Amount of harm to suffer") },
    async ({ n }) => {
      try {
        const result = await sufferHarm(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "suffer_stress",
    "Reduce character spirit by n points",
    { n: z.number().int().positive().describe("Amount of stress to suffer") },
    async ({ n }) => {
      try {
        const result = await sufferStress(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "consume_supply",
    "Reduce character supply by n points",
    { n: z.number().int().positive().describe("Amount of supply to consume") },
    async ({ n }) => {
      try {
        const result = await consumeSupply(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "restore_health",
    "Restore character health by n points (clamped to max 5)",
    { n: z.number().int().positive().describe("Amount of health to restore") },
    async ({ n }) => {
      try {
        const result = await restoreHealth(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "restore_spirit",
    "Restore character spirit by n points (clamped to max 5)",
    { n: z.number().int().positive().describe("Amount of spirit to restore") },
    async ({ n }) => {
      try {
        const result = await restoreSpirit(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "restore_supply",
    "Restore character supply by n points (clamped to max 5)",
    { n: z.number().int().positive().describe("Amount of supply to restore") },
    async ({ n }) => {
      try {
        const result = await restoreSupply(campaignPath, n);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "inflict_debility",
    "Mark a debility as active on the character",
    { name: z.string().describe("Name of the debility to inflict") },
    async ({ name }) => {
      try {
        const result = await inflictDebility(campaignPath, name);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "clear_debility",
    "Clear a debility from the character",
    { name: z.string().describe("Name of the debility to clear") },
    async ({ name }) => {
      try {
        const result = await clearDebility(campaignPath, name);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "tick_progress",
    "Tick a named progress track by the given number of marks",
    {
      track_name: z.string().describe("Name of the progress track to tick (case-insensitive)"),
      marks: z.number().int().positive().optional().describe("Number of marks to tick (default 1)"),
    },
    async ({ track_name, marks }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const idx = character.progressTracks.findIndex(
          (t) => t.name.toLowerCase() === track_name.toLowerCase(),
        );
        if (idx === -1) {
          return {
            content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
            isError: true,
          };
        }
        const before = structuredClone(character);
        const updatedTrack = tickProgress(character.progressTracks[idx]!, marks ?? 1);
        character.progressTracks[idx] = updatedTrack;
        await saveCharacter(campaignPath, character);
        await appendJournal(campaignPath, {
          timestamp: new Date().toISOString(),
          kind: "tickProgress",
          before,
          after: character,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track: updatedTrack }) }],
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
    "create_progress_track",
    "Create a new progress track on the character",
    {
      name: z.string().describe("Name of the progress track"),
      rank: z
        .enum(["troublesome", "dangerous", "formidable", "extreme", "epic"])
        .describe("Difficulty rank of the track"),
      kind: z
        .enum(["vow", "combat", "journey", "bond", "other"])
        .describe("Kind of progress track"),
    },
    async ({ name, rank, kind }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const newTrack = { name, rank, kind, ticks: 0, completed: false };
        character.progressTracks.push(newTrack);
        await saveCharacter(campaignPath, character);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track: newTrack }) }],
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
    "fulfill_progress",
    "Mark a progress track as completed",
    { track_name: z.string().describe("Name of the progress track to fulfill (case-insensitive)") },
    async ({ track_name }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const idx = character.progressTracks.findIndex(
          (t) => t.name.toLowerCase() === track_name.toLowerCase(),
        );
        if (idx === -1) {
          return {
            content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
            isError: true,
          };
        }
        character.progressTracks[idx]!.completed = true;
        await saveCharacter(campaignPath, character);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track: character.progressTracks[idx] }) }],
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
    "override",
    "Override an arbitrary character field by dot-path",
    {
      path: z.string().describe("Dot-path to the field to override (e.g. 'stats.edge', 'health')"),
      value: z.unknown().describe("New value to set"),
    },
    async ({ path, value }) => {
      try {
        const result = await overrideField(campaignPath, path, value);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, state: characterDigest(result.after) }) }],
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
    "undo_last",
    "Undo the last character mutation by restoring from the journal",
    {},
    async () => {
      try {
        const journalFilePath = join(campaignPath, "state-journal.jsonl");
        let raw: string;
        try {
          raw = await readFile(journalFilePath, "utf-8");
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Nothing to undo" }) }],
            };
          }
          throw err;
        }

        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, message: "Nothing to undo" }) }],
          };
        }

        const lastLine = lines[lines.length - 1]!;
        const entry = JSON.parse(lastLine) as { before: Character; after: Character };
        await saveCharacter(campaignPath, entry.before);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, restored: characterDigest(entry.before) }) }],
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
