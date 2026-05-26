import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { roll } from "@agentic-rpg/core";
import { dataSources } from "../../data/sources.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Band = "strong_hit" | "weak_hit" | "miss";

export interface Effect {
  kind: string;
  amount?: number;
}

export interface MoveOutcome {
  moveName: string;
  stat: string;
  statValue: number;
  adds: number;
  actionDie: number;
  challengeDice: [number, number];
  actionScore: number;
  band: Band;
  match: boolean;
  outcomeText: string;
  effectsSuggested: Effect[];
  burnOffered: boolean;
  momentumBurned: boolean;
  focused?: boolean;
  focusedBonus?: number;
}

// ---------------------------------------------------------------------------
// Move data shape from YAML
// ---------------------------------------------------------------------------

interface MoveEffectRaw {
  kind: string;
  amount?: number;
}

interface MoveData {
  name: string;
  trigger?: string;
  stat_options?: string[];
  stat_hint?: string;
  roll_type?: string;
  outcomes?: {
    strong_hit?: string;
    weak_hit?: string;
    miss?: string;
  };
  effects_by_band?: {
    strong_hit?: MoveEffectRaw[];
    weak_hit?: MoveEffectRaw[];
    miss?: MoveEffectRaw[];
  };
}

// ---------------------------------------------------------------------------
// Load moves
// ---------------------------------------------------------------------------

let _moves: MoveData[] | null = null;

function loadMoves(): MoveData[] {
  const paths = dataSources("moves");
  const seen = new Map<string, number>(); // name → index in all[]
  const all: MoveData[] = [];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parse(raw) as unknown;
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed as MoveData[]) {
      const key = entry.name?.toLowerCase() ?? "";
      if (seen.has(key)) {
        // Expansion definitions take precedence over earlier (base) definitions.
        // Data sources are ordered: core first, then expansions in load order.
        // Last writer wins, so expansions can override base moves.
        all[seen.get(key)!] = entry;
      } else {
        seen.set(key, all.length);
        all.push(entry);
      }
    }
  }
  return all;
}

export function getMoves(): MoveData[] {
  if (_moves === null) {
    _moves = loadMoves();
  }
  return _moves;
}

export function resetMovesCache(): void {
  _moves = null;
}

// ---------------------------------------------------------------------------
// resolveMove
// ---------------------------------------------------------------------------

export function resolveMove(
  moveName: string,
  stat: string,
  statValue: number,
  momentum: number,
  adds?: number,
  focused?: boolean,
  prerolledChallengeDice?: [number, number],
): MoveOutcome {
  const effectiveAdds = adds ?? 0;

  const actionDie = roll("d6").rolls[0]!;
  const challengeDice: [number, number] = prerolledChallengeDice ?? [
    roll("d10").rolls[0]!,
    roll("d10").rolls[0]!,
  ];

  const actionScore = Math.min(actionDie + statValue + effectiveAdds, 10);

  let band: Band;
  if (actionScore > challengeDice[0] && actionScore > challengeDice[1]) {
    band = "strong_hit";
  } else if (actionScore > challengeDice[0] || actionScore > challengeDice[1]) {
    band = "weak_hit";
  } else {
    band = "miss";
  }

  const match = challengeDice[0] === challengeDice[1];
  const minChallenge = Math.min(challengeDice[0], challengeDice[1]);
  const maxChallenge = Math.max(challengeDice[0], challengeDice[1]);
  const burnOffered =
    (band === "miss" && momentum > minChallenge) ||
    (band === "weak_hit" && momentum > maxChallenge);

  // Look up move data
  const moves = getMoves();
  const moveData = moves.find(
    (m) => m.name.toLowerCase() === moveName.toLowerCase(),
  );

  const FOCUSED_OUTCOME_TEXT: Record<Band, string> = {
    strong_hit: "Focused: +2 to chosen recovery action",
    weak_hit: "Focused: +1 to chosen recovery action",
    miss: "Focused: no bonus",
  };
  const FOCUSED_BONUS: Record<Band, number> = {
    strong_hit: 2,
    weak_hit: 1,
    miss: 0,
  };

  const resolvedMoveName = focused ? "Sojourn - Focused" : moveName;
  const outcomeText = focused
    ? FOCUSED_OUTCOME_TEXT[band]
    : (moveData?.outcomes?.[band] ?? "");
  const effectsSuggested: Effect[] = focused
    ? []
    : (moveData?.effects_by_band?.[band] ?? []).map((e) => ({
        kind: e.kind,
        ...(e.amount !== undefined ? { amount: e.amount } : {}),
      }));

  return {
    moveName: resolvedMoveName,
    stat,
    statValue,
    adds: effectiveAdds,
    actionDie,
    challengeDice,
    actionScore,
    band,
    match,
    outcomeText,
    effectsSuggested,
    burnOffered,
    momentumBurned: false,
    ...(focused ? { focused: true, focusedBonus: FOCUSED_BONUS[band] } : {}),
  };
}

// ---------------------------------------------------------------------------
// applyMomentumBurn
// ---------------------------------------------------------------------------

/**
 * Re-evaluate a move outcome by replacing the action score with the
 * character's current momentum value, keeping the original challenge dice.
 * Returns the updated outcome with momentumBurned=true and burnOffered=false
 * (since momentum is now spent).
 */
export function applyMomentumBurn(original: MoveOutcome, momentum: number): MoveOutcome {
  const actionScore = Math.min(momentum, 10);
  const { challengeDice } = original;

  let band: Band;
  if (actionScore > challengeDice[0] && actionScore > challengeDice[1]) {
    band = "strong_hit";
  } else if (actionScore > challengeDice[0] || actionScore > challengeDice[1]) {
    band = "weak_hit";
  } else {
    band = "miss";
  }

  const match = challengeDice[0] === challengeDice[1];

  const moves = getMoves();
  const moveData = moves.find(
    (m) => m.name.toLowerCase() === original.moveName.toLowerCase(),
  );

  const FOCUSED_OUTCOME_TEXT: Record<Band, string> = {
    strong_hit: "Focused: +2 to chosen recovery action",
    weak_hit: "Focused: +1 to chosen recovery action",
    miss: "Focused: no bonus",
  };
  const FOCUSED_BONUS: Record<Band, number> = {
    strong_hit: 2,
    weak_hit: 1,
    miss: 0,
  };

  const outcomeText = original.focused
    ? FOCUSED_OUTCOME_TEXT[band]
    : (moveData?.outcomes?.[band] ?? "");
  const effectsSuggested: Effect[] = original.focused
    ? []
    : (moveData?.effects_by_band?.[band] ?? []).map((e) => ({
        kind: e.kind,
        ...(e.amount !== undefined ? { amount: e.amount } : {}),
      }));

  return {
    ...original,
    actionScore,
    band,
    match,
    outcomeText,
    effectsSuggested,
    burnOffered: false,
    momentumBurned: true,
    ...(original.focused ? { focusedBonus: FOCUSED_BONUS[band] } : {}),
  };
}
