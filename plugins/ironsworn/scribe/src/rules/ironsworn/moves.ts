import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { roll } from "../dice.js";

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

// Prefer SCRIBE_PLUGIN_ROOT when running inside a Claude Code plugin install.
// Fall back to walking up from source when running out of the dev tree so
// `bun test` and `bun run` keep working with zero config.
function resolveMovesPath(): string {
  const pluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "ironsworn", "moves.yaml");
  }
  // Fall back to walking up from source to the plugin root for dev-time use.
  // scribe/src/rules/ironsworn/ → scribe/src/rules/ → scribe/src/ → scribe/ → plugin root
  const pluginRootFallback = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(pluginRootFallback, "data", "ironsworn", "moves.yaml");
}

let _moves: MoveData[] | null = null;

function loadMoves(): MoveData[] {
  if (!existsSync(resolveMovesPath())) {
    return [];
  }
  const raw = readFileSync(resolveMovesPath(), "utf-8");
  const parsed = parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as MoveData[];
}

export function getMoves(): MoveData[] {
  if (_moves === null) {
    _moves = loadMoves();
  }
  return _moves;
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
): MoveOutcome {
  const effectiveAdds = adds ?? 0;

  const actionDie = roll("d6").rolls[0]!;
  const challengeDice: [number, number] = [
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
  const burnOffered = momentum > 0 && momentum > actionScore;

  // Look up move data
  const moves = getMoves();
  const moveData = moves.find(
    (m) => m.name.toLowerCase() === moveName.toLowerCase(),
  );

  const outcomeText = moveData?.outcomes?.[band] ?? "";
  const effectsSuggested: Effect[] = (
    moveData?.effects_by_band?.[band] ?? []
  ).map((e) => ({ kind: e.kind, ...(e.amount !== undefined ? { amount: e.amount } : {}) }));

  return {
    moveName,
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
  };
}
