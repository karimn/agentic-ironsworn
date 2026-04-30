export interface RollResult {
  rolls: number[];
  total: number;
}

// Format: [N]d<SIDES>[+/-<MOD>]
const DICE_NOTATION = /^(\d+)?d(\d+)([+-]\d+)?$/i;

export function roll(notation: string): RollResult {
  const match = notation.trim().match(DICE_NOTATION);
  if (!match) {
    throw new Error(`Invalid dice notation: "${notation}". Expected format like "d6", "2d10", "1d6+2".`);
  }

  const count = match[1] !== undefined ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  const modifier = match[3] !== undefined ? parseInt(match[3], 10) : 0;

  if (sides < 1) {
    throw new Error(`Invalid dice notation: "${notation}". Number of sides must be at least 1.`);
  }

  if (count < 1) {
    throw new Error(`Invalid dice notation: "${notation}". Number of dice must be at least 1.`);
  }

  const rolls: number[] = Array.from({ length: count }, () =>
    Math.floor(Math.random() * sides) + 1
  );

  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;

  return { rolls, total };
}
