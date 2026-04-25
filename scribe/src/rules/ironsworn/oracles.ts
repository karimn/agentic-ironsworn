import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { roll } from "../dice.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OracleEntry {
  min: number;
  max: number;
  outcome: string;
}

interface OracleTable {
  name: string;
  dice: "d6" | "d10" | "d100";
  rolls: OracleEntry[];
}

export interface OracleRollResult {
  tableName: string;
  roll: number;
  outcome: string;
}

export type YesNoLikelihood =
  | "almost_certain"
  | "likely"
  | "50_50"
  | "unlikely"
  | "small_chance";

export interface YesNoResult {
  yes: boolean;
  roll: number;
  twist: boolean;
}

// ---------------------------------------------------------------------------
// Oracle data loading
// ---------------------------------------------------------------------------

// scribe/src/rules/ironsworn/ → 4 levels up → repo root
const ORACLES_PATH = (() => {
  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(repoRoot, "data", "ironsworn", "oracles.yaml");
})();

let _oracles: OracleTable[] | null = null;

function loadOracles(): OracleTable[] {
  if (!existsSync(ORACLES_PATH)) {
    return [];
  }
  const raw = readFileSync(ORACLES_PATH, "utf-8");
  const parsed = parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as OracleTable[];
}

function getOracles(): OracleTable[] {
  if (_oracles === null) {
    _oracles = loadOracles();
  }
  return _oracles;
}

// ---------------------------------------------------------------------------
// rollOracle
// ---------------------------------------------------------------------------

export function rollOracle(tableName: string): OracleRollResult {
  const oracles = getOracles();
  const table = oracles.find(
    (t) => t.name.toLowerCase() === tableName.toLowerCase(),
  );

  if (!table) {
    throw new Error(`Oracle table not found: ${tableName}`);
  }

  const rollValue = roll(table.dice).rolls[0]!;

  const entry = table.rolls.find(
    (e) => rollValue >= e.min && rollValue <= e.max,
  );

  if (!entry) {
    throw new Error(
      `No oracle entry for roll ${rollValue} in table ${tableName}`,
    );
  }

  return { tableName: table.name, roll: rollValue, outcome: entry.outcome };
}

// ---------------------------------------------------------------------------
// rollYesNo
// ---------------------------------------------------------------------------

const THRESHOLDS: Record<YesNoLikelihood, number> = {
  almost_certain: 91,
  likely: 76,
  "50_50": 51,
  unlikely: 26,
  small_chance: 11,
};

export function rollYesNo(likelihood: YesNoLikelihood): YesNoResult {
  const rollValue = roll("d100").rolls[0]!;
  const threshold = THRESHOLDS[likelihood];
  const yes = rollValue <= threshold;

  // Twist on doubles: tens digit equals units digit (00 counts as double)
  // For roll=100, treat as 00: Math.floor(100/10)%10 = 0, 100%10 = 0 → twist
  const tens = Math.floor(rollValue / 10) % 10;
  const units = rollValue % 10;
  const twist = tens === units;

  return { yes, roll: rollValue, twist };
}
