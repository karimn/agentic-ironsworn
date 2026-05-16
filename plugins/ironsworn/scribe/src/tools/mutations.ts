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
  gainExperience,
  spendExperience,
  appendJournal,
  companionSufferHarm,
  companionRestoreHealth,
  upsertCompanion,
  upgradeAsset,
  closeTrack,
  Character,
} from "../state/character.js";
import type { ProgressTrack } from "../state/character.js";
import { burnMomentum } from "../rules/ironsworn/momentum.js";
import { tickProgress, vowXp, TICKS_PER_MARK } from "../rules/ironsworn/progress.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { recordMutation } from "../checkpoint.js";
import { openThread, closeThread, loadThreads } from "../state/threads.js";

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
    experience: char.experience,
  };
}

export function register(server: McpServer, campaignPath: string): void {
  server.tool(
    "take_momentum",
    "Add or remove momentum from the character",
    { amount: z.coerce.number().int().describe("Amount to add (positive) or remove (negative)") },
    async ({ amount }) => {
      try {
        const result = await takeMomentum(campaignPath, amount);
        recordMutation(campaignPath);
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
        recordMutation(campaignPath);
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
    "Reduce character health by the given amount",
    { amount: z.coerce.number().int().positive().describe("Amount of harm to suffer") },
    async ({ amount }) => {
      try {
        const result = await sufferHarm(campaignPath, amount);
        recordMutation(campaignPath);
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
    "Reduce character spirit by the given amount",
    { amount: z.coerce.number().int().positive().describe("Amount of stress to suffer") },
    async ({ amount }) => {
      try {
        const result = await sufferStress(campaignPath, amount);
        recordMutation(campaignPath);
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
    "Reduce character supply by the given amount",
    { amount: z.coerce.number().int().positive().describe("Amount of supply to consume") },
    async ({ amount }) => {
      try {
        const result = await consumeSupply(campaignPath, amount);
        recordMutation(campaignPath);
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
    "Restore character health by the given amount (clamped to max 5)",
    { amount: z.coerce.number().int().positive().describe("Amount of health to restore") },
    async ({ amount }) => {
      try {
        const result = await restoreHealth(campaignPath, amount);
        recordMutation(campaignPath);
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
    "Restore character spirit by the given amount (clamped to max 5)",
    { amount: z.coerce.number().int().positive().describe("Amount of spirit to restore") },
    async ({ amount }) => {
      try {
        const result = await restoreSpirit(campaignPath, amount);
        recordMutation(campaignPath);
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
    "Restore character supply by the given amount (clamped to max 5)",
    { amount: z.coerce.number().int().positive().describe("Amount of supply to restore") },
    async ({ amount }) => {
      try {
        const result = await restoreSupply(campaignPath, amount);
        recordMutation(campaignPath);
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
        recordMutation(campaignPath);
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
        recordMutation(campaignPath);
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
    [
      "Tick a named progress track by the given number of marks.",
      "",
      "Use `reach_milestone` for vow advancement (RAW Reach a Milestone).",
      "Use `tick_progress` for: journey waypoints (1 mark per Undertake hit),",
      "combat harm (rank-dependent ticks per harm point), bond progress (1 raw tick),",
      "and scene-challenge progress.",
      "",
      "IMPORTANT — unit clarification:",
      "  `marks` is the number of *progress marks* (boxes), NOT raw ticks.",
      "  Each mark equals a rank-dependent number of ticks:",
      "    troublesome=12, dangerous=8, formidable=4, extreme=2, epic=1.",
      "  Example: marks=2 on a dangerous track adds 2*8=16 ticks.",
      "",
      "The response always includes an `applied` object with:",
      "  - prior_ticks: ticks before this call",
      "  - requested_marks: the marks value that was passed (or 1 if default)",
      "  - ticks_added: actual ticks added after clamping",
      "  - clamped: true if the result was clamped at the 40-tick maximum",
      "",
      "When clamping occurs, a `warnings` array is also returned.",
    ].join("\n"),
    {
      track_name: z.string().describe("Name of the progress track to tick (case-insensitive)"),
      marks: z.coerce.number().int().positive().optional().describe(
        "Number of progress marks (boxes) to tick, not raw ticks (default 1). Each mark adds rank-dependent ticks: troublesome=12, dangerous=8, formidable=4, extreme=2, epic=1.",
      ),
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
        const requestedMarks = marks ?? 1;
        const track = character.progressTracks[idx]!;
        if (track.status !== "active") {
          return {
            content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
            isError: true,
          };
        }
        const priorTicks = track.ticks;
        const ticksRequested = requestedMarks * TICKS_PER_MARK[track.rank];
        const before = structuredClone(character);
        const updatedTrack = tickProgress(track, requestedMarks);
        const ticksAdded = updatedTrack.ticks - priorTicks;
        const clamped = ticksAdded < ticksRequested;
        character.progressTracks[idx] = updatedTrack;
        await saveCharacter(campaignPath, character);
        await appendJournal(campaignPath, {
          timestamp: new Date().toISOString(),
          kind: "tickProgress",
          before,
          after: character,
        });
        recordMutation(campaignPath);
        const applied = {
          requested_marks: requestedMarks,
          ticks_added: ticksAdded,
          prior_ticks: priorTicks,
          clamped,
        };
        const warnings: string[] = clamped
          ? [`Requested ${requestedMarks} marks (${ticksRequested} ticks) would exceed max; clamped at 40`]
          : [];
        const payload: Record<string, unknown> = { ok: true, track: updatedTrack, applied };
        if (warnings.length > 0) payload.warnings = warnings;
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
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
    "reach_milestone",
    [
      "Apply RAW Reach a Milestone events to a vow track. Vow-only.",
      "",
      "RAW: when the player overcomes a critical obstacle directly tied to a vow,",
      "call this with the vow's track_name. The tool reads the track's rank and",
      "applies the canonical milestone amount (troublesome=3 boxes, dangerous=2,",
      "formidable=1, extreme=2 ticks, epic=1 tick). One call = one milestone event.",
      "",
      "For non-vow tracks (journey waypoints, combat harm, bonds, scene challenges)",
      "use tick_progress instead — those have their own tick semantics.",
    ].join("\n"),
    {
      track_name: z.string().describe("Name of the vow track (case-insensitive)"),
      count: z.coerce.number().int().positive().optional().describe(
        "Number of milestone events to apply (default 1).",
      ),
    },
    async ({ track_name, count }) => {
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
        const track = character.progressTracks[idx]!;
        if (track.kind !== "vow") {
          return {
            content: [{ type: "text", text: `Error: reach_milestone applies to vow tracks only. Track "${track.name}" is kind="${track.kind}". For journey waypoints, combat harm, or bonds, use tick_progress.` }],
            isError: true,
          };
        }
        if (track.status !== "active") {
          return {
            content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
            isError: true,
          };
        }
        const milestonesApplied = count ?? 1;
        const priorTicks = track.ticks;
        const ticksRequested = milestonesApplied * TICKS_PER_MARK[track.rank];
        const before = structuredClone(character);
        const updatedTrack = tickProgress(track, milestonesApplied);
        const ticksAdded = updatedTrack.ticks - priorTicks;
        const clamped = ticksAdded < ticksRequested;
        character.progressTracks[idx] = updatedTrack;
        await saveCharacter(campaignPath, character);
        await appendJournal(campaignPath, {
          timestamp: new Date().toISOString(),
          kind: "reachMilestone",
          before,
          after: character,
        });
        recordMutation(campaignPath);
        const applied = {
          milestones_applied: milestonesApplied,
          ticks_added: ticksAdded,
          prior_ticks: priorTicks,
          clamped,
        };
        const warnings: string[] = clamped
          ? [`Requested ${milestonesApplied} milestone(s) (${ticksRequested} ticks) would exceed max; clamped at 40`]
          : [];
        const payload: Record<string, unknown> = { ok: true, track: updatedTrack, applied };
        if (warnings.length > 0) payload.warnings = warnings;
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
        const newTrack: ProgressTrack = { name, rank, kind, ticks: 0, status: "active" };
        character.progressTracks.push(newTrack);
        await saveCharacter(campaignPath, character);

        // Auto-open a matching thread for vow tracks (idempotent — skip if exists).
        let threadCreated = false;
        if (kind === "vow") {
          const threads = await loadThreads(campaignPath);
          const exists = threads.some((t) => t.title.toLowerCase() === name.toLowerCase());
          if (!exists) {
            await openThread(campaignPath, name, "vow");
            threadCreated = true;
          }
        }

        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track: newTrack, threadCreated }) }],
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
    [
      "Fulfill a progress track: marks it fulfilled.",
      "For vow tracks, also grants XP based on the rank and the roll outcome from roll_progress.",
      "Non-vow tracks (journey, combat, etc.) always grant 0 XP.",
      "",
      "Canonical vow fulfillment flow:",
      "1. roll_progress — roll against the vow's progress score to see the outcome",
      "2. fulfill_progress — (this tool) marks the track complete, awards XP, and auto-closes the matching thread.",
      "   Pass 'resolution' to record how the vow ended. Do NOT call close_thread separately — it is redundant.",
    ].join("\n"),
    {
      track_name: z.string().describe("Name of the progress track to fulfill (case-insensitive)"),
      outcome: z
        .enum(["strong_hit", "weak_hit", "miss"])
        .describe("The outcome of the roll_progress roll for this track"),
      resolution: z.string().optional().describe("How the vow was resolved — passed to the matching thread on close"),
    },
    async ({ track_name, outcome, resolution }) => {
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
        const track = character.progressTracks[idx]!;
        track.status = "fulfilled";
        const xpGained = vowXp(track, outcome);
        character.experience += xpGained;
        await saveCharacter(campaignPath, character);
        await appendJournal(campaignPath, {
          timestamp: new Date().toISOString(),
          kind: "fulfillProgress",
          before,
          after: character,
        });

        // Auto-close the matching thread for vow tracks (best-effort — non-fatal if missing).
        let threadClosed = false;
        if (track.kind === "vow") {
          const threads = await loadThreads(campaignPath);
          const openMatch = threads.find(
            (t) => t.title.toLowerCase() === track_name.toLowerCase() && t.status === "open",
          );
          if (openMatch) {
            await closeThread(campaignPath, openMatch.title, resolution ?? "Fulfilled.");
            threadClosed = true;
          }
        }

        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track: character.progressTracks[idx], xpGained, experience: character.experience, threadClosed }) }],
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
    "close_track",
    [
      "Dismiss/close a progress track without awarding XP.",
      "Use this for non-vow tracks (combat, journey, bond, other) that have resolved fictionally",
      "but were never formally fulfilled via fulfill_progress — e.g. a battle that ended narratively,",
      "a journey that was abandoned, or any track sitting at 40/40 after the fiction has moved on.",
      "Also works for vow tracks when you want to abandon a vow without XP.",
      "",
      "The track's status is set to 'fulfilled' (same as fulfill_progress) but no XP is awarded.",
      "After closing, the track will no longer appear in session_briefing's 'ready' or 'open' buckets.",
    ].join("\n"),
    {
      track_name: z.string().describe("Name of the progress track to close/dismiss (case-insensitive)"),
    },
    async ({ track_name }) => {
      try {
        const result = await closeTrack(campaignPath, track_name);
        recordMutation(campaignPath);
        const track = result.after.progressTracks.find(
          (t) => t.name.toLowerCase() === track_name.toLowerCase(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, track, xpAwarded: 0 }) }],
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
        recordMutation(campaignPath);
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
        recordMutation(campaignPath);
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
  server.tool(
    "companion_suffer_harm",
    "Reduce a companion's health by the given amount",
    {
      companion_name: z.string().describe("Name of the companion (case-insensitive)"),
      amount: z.coerce.number().int().positive().describe("Amount of harm to suffer"),
    },
    async ({ companion_name, amount }) => {
      try {
        const result = await companionSufferHarm(campaignPath, companion_name, amount);
        recordMutation(campaignPath);
        const companion = result.after.companions.find(
          (c) => c.name.toLowerCase() === companion_name.toLowerCase(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, companion }) }],
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
    "companion_restore_health",
    "Restore a companion's health by the given amount",
    {
      companion_name: z.string().describe("Name of the companion (case-insensitive)"),
      amount: z.coerce.number().int().positive().describe("Amount of health to restore"),
    },
    async ({ companion_name, amount }) => {
      try {
        const result = await companionRestoreHealth(campaignPath, companion_name, amount);
        recordMutation(campaignPath);
        const companion = result.after.companions.find(
          (c) => c.name.toLowerCase() === companion_name.toLowerCase(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, companion }) }],
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
    "upsert_companion",
    "Add a new companion or update an existing companion's health",
    {
      companion_name: z.string().describe("Name of the companion"),
      health: z.coerce.number().int().min(0).max(5).describe("Health value (0-5)"),
    },
    async ({ companion_name, health }) => {
      try {
        const result = await upsertCompanion(campaignPath, companion_name, health);
        recordMutation(campaignPath);
        const companion = result.after.companions.find(
          (c) => c.name.toLowerCase() === companion_name.toLowerCase(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, companion }) }],
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
    "gain_experience",
    "Add experience points to the character",
    { amount: z.coerce.number().int().positive().describe("Amount of experience to gain") },
    async ({ amount }) => {
      try {
        const result = await gainExperience(campaignPath, amount);
        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, experience: result.after.experience }) }],
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
    "spend_experience",
    "Spend experience points from the character",
    { amount: z.coerce.number().int().positive().describe("Amount of experience to spend") },
    async ({ amount }) => {
      try {
        const result = await spendExperience(campaignPath, amount);
        recordMutation(campaignPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, experience: result.after.experience }) }],
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
    "upgrade_asset",
    "Unlock an asset ability by index. Use after spend_experience to persist the upgrade to the character sheet.",
    {
      asset_name: z.string().describe("Name of the asset (case-insensitive, e.g. 'Hound', 'Swordmaster')"),
      ability_index: z.coerce.number().int().min(0).describe("Zero-based index of the ability to unlock"),
    },
    async ({ asset_name, ability_index }) => {
      try {
        const result = await upgradeAsset(campaignPath, asset_name, ability_index);
        recordMutation(campaignPath);
        const asset = result.after.assets.find(
          (a) => a.name.toLowerCase() === asset_name.toLowerCase(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, asset }) }],
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
