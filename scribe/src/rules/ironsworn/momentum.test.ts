import { describe, it, expect } from "bun:test";
import { burnMomentum } from "./momentum.js";
import { Character, DEBILITIES } from "../../state/character.js";

const makeChar = (momentum: number, momentumReset: number = 2): Character => ({
  name: "Test",
  stats: { edge: 2, heart: 2, iron: 2, shadow: 2, wits: 2 },
  momentum,
  momentumReset,
  health: 5,
  spirit: 5,
  supply: 3,
  debilities: Object.fromEntries(DEBILITIES.map(d => [d, false])),
  assets: [],
  progressTracks: [],
  bonds: 0,
  customState: {},
});

describe("burnMomentum", () => {
  it("resets momentum to momentumReset", () => {
    const char = makeChar(7, 2);
    const result = burnMomentum(char);
    expect(result.after.momentum).toBe(2);
    expect(result.momentumAfter).toBe(2);
    expect(result.resetTo).toBe(2);
  });

  it("records momentumBefore correctly", () => {
    const char = makeChar(9, 2);
    const result = burnMomentum(char);
    expect(result.momentumBefore).toBe(9);
  });

  it("before is a deep clone (not same reference)", () => {
    const char = makeChar(7, 2);
    const result = burnMomentum(char);
    expect(result.before).not.toBe(result.after);
    expect(result.before.momentum).toBe(7);
    expect(result.after.momentum).toBe(2);
  });

  it("works with custom momentumReset (reduced by debilities)", () => {
    const char = makeChar(5, 0); // maimed + corrupted + ... = reset 0
    const result = burnMomentum(char);
    expect(result.after.momentum).toBe(0);
  });
});
