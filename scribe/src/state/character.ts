import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Asset {
  name: string;
  abilities: boolean[];
  customState?: Record<string, string>;
}

export interface ProgressTrack {
  name: string;
  rank: "troublesome" | "dangerous" | "formidable" | "extreme" | "epic";
  kind: "vow" | "combat" | "journey" | "bond" | "other";
  ticks: number; // 0..40
  completed: boolean;
}

export interface Character {
  name: string;
  stats: {
    edge: number;
    heart: number;
    iron: number;
    shadow: number;
    wits: number;
  };
  momentum: number;      // -6..+10
  momentumReset: number; // default 2; reduced by impacting debilities
  health: number;        // 0-5
  spirit: number;        // 0-5
  supply: number;        // 0-5
  debilities: Record<string, boolean>;
  assets: Asset[];
  progressTracks: ProgressTrack[];
  bonds: number;
  customState: Record<string, string>;
}

export interface MutationResult {
  before: Character;
  after: Character;
}

// ---------------------------------------------------------------------------
// Debilities
// ---------------------------------------------------------------------------

export const DEBILITIES = [
  "wounded",
  "shaken",
  "unprepared",
  "encumbered",
  "maimed",
  "corrupted",
  "cursed",
  "tormented",
  "battered",
] as const;

export type Debility = (typeof DEBILITIES)[number];

// Impacting debilities — each reduces momentumReset by 1
export const IMPACTING_DEBILITIES: Debility[] = [
  "maimed",
  "corrupted",
  "cursed",
  "tormented",
  "battered",
];

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

function characterPath(campaignPath: string): string {
  return join(campaignPath, "character.json");
}

function journalPath(campaignPath: string): string {
  return join(campaignPath, "state-journal.jsonl");
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export async function loadCharacter(campaignPath: string): Promise<Character> {
  const raw = await readFile(characterPath(campaignPath), "utf-8");
  return JSON.parse(raw) as Character;
}

export async function saveCharacter(
  campaignPath: string,
  char: Character,
): Promise<void> {
  await writeFile(characterPath(campaignPath), JSON.stringify(char, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export async function appendJournal(
  campaignPath: string,
  entry: {
    timestamp: string;
    kind: string;
    before: Character;
    after: Character;
  },
): Promise<void> {
  await appendFile(journalPath(campaignPath), JSON.stringify(entry) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function computeMomentumReset(char: Character): number {
  const activeImpacting = IMPACTING_DEBILITIES.filter(
    (d) => char.debilities[d] === true,
  ).length;
  return 2 - activeImpacting;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setNestedField(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null || typeof current[part] !== "object") {
      throw new Error(`Path segment "${part}" does not exist or is not an object`);
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

async function mutate(
  campaignPath: string,
  kind: string,
  fn: (char: Character) => void,
): Promise<MutationResult> {
  const loaded = await loadCharacter(campaignPath);
  const before = structuredClone(loaded);
  fn(loaded);
  const after = loaded;
  await saveCharacter(campaignPath, after);
  await appendJournal(campaignPath, {
    timestamp: new Date().toISOString(),
    kind,
    before,
    after,
  });
  return { before, after };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function takeMomentum(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "takeMomentum", (char) => {
    char.momentum = clamp(char.momentum + n, -6, 10);
  });
}

export async function sufferHarm(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "sufferHarm", (char) => {
    char.health = clamp(char.health - n, 0, 5);
  });
}

export async function sufferStress(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "sufferStress", (char) => {
    char.spirit = clamp(char.spirit - n, 0, 5);
  });
}

export async function consumeSupply(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "consumeSupply", (char) => {
    char.supply = clamp(char.supply - n, 0, 5);
  });
}

export async function restoreHealth(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "restoreHealth", (char) => {
    char.health = clamp(char.health + n, 0, 5);
  });
}

export async function restoreSpirit(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "restoreSpirit", (char) => {
    char.spirit = clamp(char.spirit + n, 0, 5);
  });
}

export async function restoreSupply(
  campaignPath: string,
  n: number,
): Promise<MutationResult> {
  return mutate(campaignPath, "restoreSupply", (char) => {
    char.supply = clamp(char.supply + n, 0, 5);
  });
}

export async function inflictDebility(
  campaignPath: string,
  name: string,
): Promise<MutationResult> {
  if (!(DEBILITIES as readonly string[]).includes(name)) {
    throw new Error(`Unknown debility: "${name}". Valid debilities: ${DEBILITIES.join(", ")}`);
  }
  return mutate(campaignPath, "inflictDebility", (char) => {
    char.debilities[name] = true;
    char.momentumReset = computeMomentumReset(char);
  });
}

export async function clearDebility(
  campaignPath: string,
  name: string,
): Promise<MutationResult> {
  if (!(DEBILITIES as readonly string[]).includes(name)) {
    throw new Error(`Unknown debility: "${name}". Valid debilities: ${DEBILITIES.join(", ")}`);
  }
  return mutate(campaignPath, "clearDebility", (char) => {
    char.debilities[name] = false;
    char.momentumReset = computeMomentumReset(char);
  });
}

export async function overrideField(
  campaignPath: string,
  path: string,
  value: unknown,
): Promise<MutationResult> {
  return mutate(campaignPath, "overrideField", (char) => {
    setNestedField(char as unknown as Record<string, unknown>, path, value);
  });
}
