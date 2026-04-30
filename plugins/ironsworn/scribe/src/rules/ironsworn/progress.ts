import { roll } from "../dice.js";
import { ProgressTrack } from "../../state/character.js";

export const TICKS_PER_MARK: Record<ProgressTrack["rank"], number> = {
  troublesome: 12,
  dangerous: 8,
  formidable: 4,
  extreme: 2,
  epic: 1,
};

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
