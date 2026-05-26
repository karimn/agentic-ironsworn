import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { roll } from "@agentic-rpg/core";
import { dataSources } from "../../data/sources.js";

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
  aliases?: string[];
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

let _oracles: OracleTable[] | null = null;

function loadOracles(): OracleTable[] {
  const paths = dataSources("oracles");
  const seen = new Map<string, string>(); // name → source path
  const all: OracleTable[] = [];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parse(raw) as unknown;
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed as OracleTable[]) {
      const key = entry.name?.toLowerCase() ?? "";
      if (seen.has(key)) {
        throw new Error(
          `[scribe] oracle table name collision: "${entry.name}" appears in both "${seen.get(key)}" and "${filePath}"`,
        );
      }
      seen.set(key, filePath);
      all.push(entry);
    }
  }
  return all;
}

function getOracles(): OracleTable[] {
  if (_oracles === null) {
    _oracles = loadOracles();
  }
  return _oracles;
}

export function resetOraclesCache(): void {
  _oracles = null;
}

export function getOracleTables(): OracleTable[] {
  return getOracles();
}

// ---------------------------------------------------------------------------
// rollOracle
// ---------------------------------------------------------------------------

export function rollOracle(tableName: string): OracleRollResult {
  const oracles = getOracles();
  const needle = tableName.toLowerCase();
  const table = oracles.find(
    (t) =>
      t.name.toLowerCase() === needle ||
      t.aliases?.some((a) => a.toLowerCase() === needle),
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
