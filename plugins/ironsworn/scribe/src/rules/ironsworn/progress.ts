import { roll } from "../dice.js";
import { ProgressTrack } from "../../state/character.js";

export const TICKS_PER_MARK: Record<ProgressTrack["rank"], number> = {
  troublesome: 12,
  dangerous: 8,
  formidable: 4,
  extreme: 2,
  epic: 1,
};

export const STRESS_BY_RANK: Record<ProgressTrack["rank"], number> = {
  troublesome: 1,
  dangerous: 2,
  formidable: 3,
  extreme: 4,
  epic: 5,
};

/**
 * Ordered rank ladder used by `recommit_vow` to bump rank one tier on a
 * Fulfill Your Vow miss. Epic stays epic (no further escalation).
 */
export const RANK_LADDER: ProgressTrack["rank"][] = [
  "troublesome",
  "dangerous",
  "formidable",
  "extreme",
  "epic",
];

/**
 * XP awarded when fulfilling a vow, indexed by rank then outcome.
 * Only vows award XP (journeys, combat, etc. grant 0).
 * Source: Ironsworn core rules, Fulfill Your Vow move.
 */
export const VOW_XP: Record<ProgressTrack["rank"], Record<"strong_hit" | "weak_hit", number>> = {
  troublesome: { strong_hit: 1, weak_hit: 0 },
  dangerous:   { strong_hit: 2, weak_hit: 1 },
  formidable:  { strong_hit: 3, weak_hit: 2 },
  extreme:     { strong_hit: 4, weak_hit: 2 },
  epic:        { strong_hit: 5, weak_hit: 3 },
};

/**
 * Returns the XP earned for fulfilling a progress track.
 * Only vows award XP; all other track kinds return 0.
 */
export function vowXp(
  track: ProgressTrack,
  outcome: "strong_hit" | "weak_hit" | "miss",
): number {
  if (track.kind !== "vow") return 0;
  if (outcome === "miss") return 0;
  return VOW_XP[track.rank][outcome];
}

export interface ProgressRollResult {
  track: ProgressTrack;
  progressScore: number;
  challengeDice: [number, number];
  band: "strong_hit" | "weak_hit" | "miss";
  match: boolean;
}

export function tickProgress(track: ProgressTrack, marks: number = 1): ProgressTrack {
  const newTicks = Math.min(track.ticks + marks * TICKS_PER_MARK[track.rank], 40);
  return { ...track, ticks: newTicks };
}

export function classifyBand(
  score: number,
  c1: number,
  c2: number,
): "strong_hit" | "weak_hit" | "miss" {
  if (score > c1 && score > c2) return "strong_hit";
  if (score > c1 || score > c2) return "weak_hit";
  return "miss";
}

export function rollProgress(track: ProgressTrack): ProgressRollResult {
  const progressScore = Math.min(Math.floor(track.ticks / 4), 10);
  const c1 = roll("d10").total;
  const c2 = roll("d10").total;
  const challengeDice: [number, number] = [c1, c2];

  return {
    track,
    progressScore,
    challengeDice,
    band: classifyBand(progressScore, c1, c2),
    match: c1 === c2,
  };
}

export interface EpilogueRollResult {
  bonds: number;
  progressScore: number;
  challengeDice: [number, number];
  outcome: "strong" | "weak" | "miss";
  match: boolean;
  oraclePrompt: string | null;
}

export function rollEpilogue(bonds: number): EpilogueRollResult {
  const progressScore = Math.min(bonds, 10);
  const c1 = roll("d10").total;
  const c2 = roll("d10").total;
  const band = classifyBand(progressScore, c1, c2);
  const outcome = band === "strong_hit" ? "strong" : band === "weak_hit" ? "weak" : "miss";
  const oraclePrompt =
    band === "strong_hit" ? null :
    band === "weak_hit" ? "Envision an unexpected turn in your new life." :
    "Envision how your fears are realized.";

  return {
    bonds,
    progressScore,
    challengeDice: [c1, c2],
    outcome,
    match: c1 === c2,
    oraclePrompt,
  };
}
