import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { roll } from "../rules/dice.js";
import { resolveMove, applyMomentumBurn } from "../rules/ironsworn/moves.js";
import { rollProgress } from "../rules/ironsworn/progress.js";
import { rollOracle, rollYesNo } from "../rules/ironsworn/oracles.js";
import { loadCharacter, saveCharacter, appendJournal } from "../state/character.js";
import { burnMomentum } from "../rules/ironsworn/momentum.js";

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "roll_dice",
    "Roll dice using standard notation (e.g. 'd6', '2d10', '1d6+2')",
    { notation: z.string().describe("Dice notation, e.g. 'd6', '2d10', '1d6+2'") },
    async ({ notation }) => {
      try {
        const result = roll(notation);
        return {
          content: [{ type: "text", text: JSON.stringify({ rolls: result.rolls, total: result.total }) }],
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
    "resolve_move",
    "Resolve an Ironsworn move roll, optionally burning momentum. " +
    "Pass challenge_die_1 and challenge_die_2 (from a prior roll) together with burn_momentum=true " +
    "to apply a momentum burn against existing challenge dice without re-rolling.",
    {
      move_name: z.string().describe("Name of the move to resolve"),
      stat: z.string().describe("Stat to use (edge, heart, iron, shadow, wits, health, spirit, supply)"),
      adds: z.number().int().optional().describe("Additional adds to the action score"),
      burn_momentum: z.boolean().optional().describe("Whether to burn momentum if it would improve the outcome"),
      challenge_die_1: z.number().int().min(1).max(10).optional().describe(
        "First challenge die value from a prior roll (1-10). Required when burn_momentum=true to avoid re-rolling.",
      ),
      challenge_die_2: z.number().int().min(1).max(10).optional().describe(
        "Second challenge die value from a prior roll (1-10). Required when burn_momentum=true to avoid re-rolling.",
      ),
    },
    async ({ move_name, stat, adds, burn_momentum, challenge_die_1, challenge_die_2 }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const RESOURCE_STATS = ["health", "spirit", "supply"] as const;
        const statValue =
          (character.stats as Record<string, number>)[stat] ??
          (RESOURCE_STATS.includes(stat as (typeof RESOURCE_STATS)[number])
            ? character[stat as (typeof RESOURCE_STATS)[number]]
            : undefined);
        if (statValue === undefined) {
          return {
            content: [{ type: "text", text: `Error: Unknown stat "${stat}". Valid stats: edge, heart, iron, shadow, wits, health, spirit, supply` }],
            isError: true,
          };
        }

        // If caller supplied pre-rolled challenge dice (e.g. for a momentum burn),
        // pass them through so we do not roll new dice.
        const prerolledChallengeDice: [number, number] | undefined =
          challenge_die_1 !== undefined && challenge_die_2 !== undefined
            ? [challenge_die_1, challenge_die_2]
            : undefined;

        const outcome = resolveMove(move_name, stat, statValue, character.momentum, adds, undefined, prerolledChallengeDice);

        if (burn_momentum && outcome.burnOffered) {
          // Re-evaluate the outcome using momentum as the action score,
          // keeping the same challenge dice — do NOT roll fresh dice.
          const burnedOutcome = applyMomentumBurn(outcome, character.momentum);
          const burnResult = burnMomentum(character);
          await saveCharacter(campaignPath, burnResult.after);
          await appendJournal(campaignPath, {
            timestamp: new Date().toISOString(),
            kind: "burnMomentum",
            before: burnResult.before,
            after: burnResult.after,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(burnedOutcome) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(outcome) }],
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
    "roll_progress",
    "Roll progress for a named progress track (case-insensitive)",
    { track_name: z.string().describe("Name of the progress track to roll against") },
    async ({ track_name }) => {
      try {
        const character = await loadCharacter(campaignPath);
        const track = character.progressTracks.find(
          (t) => t.name.toLowerCase() === track_name.toLowerCase(),
        );
        if (!track) {
          return {
            content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
            isError: true,
          };
        }
        const result = rollProgress(track);
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
    "roll_oracle",
    "Roll on a named oracle table",
    { table_name: z.string().describe("Name of the oracle table to roll on") },
    async ({ table_name }) => {
      try {
        const result = rollOracle(table_name);
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
    "roll_yes_no",
    "Ask the oracle a yes/no question with a given likelihood",
    {
      likelihood: z
        .enum(["almost_certain", "likely", "50_50", "unlikely", "small_chance"])
        .describe("How likely a 'yes' result is"),
    },
    async ({ likelihood }) => {
      try {
        const result = rollYesNo(likelihood);
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
}
