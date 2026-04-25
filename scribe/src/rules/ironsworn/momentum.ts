import { Character } from "../../state/character.js";

export interface BurnResult {
  before: Character;
  after: Character;
  momentumBefore: number;
  momentumAfter: number;
  resetTo: number;
}

export function burnMomentum(character: Character): BurnResult {
  const before = structuredClone(character);
  const momentumBefore = character.momentum;
  const resetTo = character.momentumReset;
  const after: Character = { ...character, momentum: resetTo };
  return {
    before,
    after,
    momentumBefore,
    momentumAfter: resetTo,
    resetTo,
  };
}
