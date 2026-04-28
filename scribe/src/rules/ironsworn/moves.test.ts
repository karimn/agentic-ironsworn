import { describe, it, expect } from "bun:test";
import { resolveMove } from "./moves.js";

describe("resolveMove", () => {
  it("returns a valid outcome structure", () => {
    const result = resolveMove("Face Danger", "edge", 2, 3);
    expect(["strong_hit", "weak_hit", "miss"]).toContain(result.band);
    expect(result.actionDie).toBeGreaterThanOrEqual(1);
    expect(result.actionDie).toBeLessThanOrEqual(6);
    expect(result.challengeDice[0]).toBeGreaterThanOrEqual(1);
    expect(result.challengeDice[0]).toBeLessThanOrEqual(10);
    expect(result.challengeDice[1]).toBeGreaterThanOrEqual(1);
    expect(result.challengeDice[1]).toBeLessThanOrEqual(10);
  });

  it("computes actionScore correctly", () => {
    const result = resolveMove("Strike", "iron", 3, 0, 1);
    expect(result.actionScore).toBe(Math.min(result.actionDie + 3 + 1, 10));
  });

  it("caps actionScore at 10", () => {
    for (let i = 0; i < 1000; i++) {
      const r = resolveMove("Strike", "iron", 5, 0, 4);
      expect(r.actionScore).toBeLessThanOrEqual(10);
    }
  });

  it("detects match when challenge dice are equal", () => {
    let foundMatch = false;
    for (let i = 0; i < 10_000; i++) {
      const r = resolveMove("Face Danger", "edge", 0, 0);
      if (r.challengeDice[0] === r.challengeDice[1]) {
        expect(r.match).toBe(true);
        foundMatch = true;
        break;
      }
    }
    expect(foundMatch).toBe(true);
  });

  it("sets burnOffered when momentum > actionScore", () => {
    let foundBurn = false;
    for (let i = 0; i < 1000; i++) {
      const r = resolveMove("Face Danger", "edge", 0, 10);
      if (r.burnOffered) { foundBurn = true; break; }
    }
    expect(foundBurn).toBe(true);
  });

  it("sets burnOffered=false when momentum < actionScore", () => {
    for (let i = 0; i < 100; i++) {
      const r = resolveMove("Face Danger", "edge", 5, -6);
      expect(r.burnOffered).toBe(false);
    }
  });

  it("correctly identifies band boundaries", () => {
    for (let i = 0; i < 1000; i++) {
      const r = resolveMove("Face Danger", "edge", 2, 0);
      const { actionScore, challengeDice, band } = r;
      const beatsFirst = actionScore > challengeDice[0];
      const beatsSecond = actionScore > challengeDice[1];
      if (beatsFirst && beatsSecond) expect(band).toBe("strong_hit");
      else if (beatsFirst || beatsSecond) expect(band).toBe("weak_hit");
      else expect(band).toBe("miss");
    }
  });

  it("does not offer burn when momentum ties the max challenge die on a weak hit", () => {
    for (let i = 0; i < 10_000; i++) {
      const r = resolveMove("Face Danger", "edge", 0, 7);
      const maxChallenge = Math.max(r.challengeDice[0], r.challengeDice[1]);
      const minChallenge = Math.min(r.challengeDice[0], r.challengeDice[1]);
      if (r.band === "weak_hit") {
        expect(r.burnOffered).toBe(7 > maxChallenge);
      }
      if (r.band === "miss") {
        expect(r.burnOffered).toBe(7 > minChallenge);
      }
      if (r.band === "strong_hit") {
        expect(r.burnOffered).toBe(false);
      }
    }
  });

  describe("focused roll (Sojourn)", () => {
    it("overrides moveName to 'Sojourn - Focused' when focused=true", () => {
      for (let i = 0; i < 20; i++) {
        const r = resolveMove("Sojourn", "heart", 3, 0, 0, true);
        expect(r.moveName).toBe("Sojourn - Focused");
      }
    });

    it("sets focused=true in the returned outcome", () => {
      for (let i = 0; i < 20; i++) {
        const r = resolveMove("Sojourn", "heart", 3, 0, 0, true);
        expect(r.focused).toBe(true);
      }
    });

    it("returns focusedBonus=2 on strong_hit", () => {
      let found = false;
      for (let i = 0; i < 1000; i++) {
        const r = resolveMove("Sojourn", "heart", 5, 0, 4, true);
        if (r.band === "strong_hit") {
          expect(r.focusedBonus).toBe(2);
          expect(r.outcomeText).toBe("Focused: +2 to chosen recovery action");
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("returns focusedBonus=1 on weak_hit", () => {
      let found = false;
      for (let i = 0; i < 10_000; i++) {
        const r = resolveMove("Sojourn", "heart", 2, 0, 0, true);
        if (r.band === "weak_hit") {
          expect(r.focusedBonus).toBe(1);
          expect(r.outcomeText).toBe("Focused: +1 to chosen recovery action");
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("returns focusedBonus=0 on miss", () => {
      let found = false;
      for (let i = 0; i < 10_000; i++) {
        const r = resolveMove("Sojourn", "heart", 0, 0, 0, true);
        if (r.band === "miss") {
          expect(r.focusedBonus).toBe(0);
          expect(r.outcomeText).toBe("Focused: no bonus");
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("returns effectsSuggested=[] when focused=true", () => {
      for (let i = 0; i < 20; i++) {
        const r = resolveMove("Sojourn", "heart", 3, 0, 0, true);
        expect(r.effectsSuggested).toEqual([]);
      }
    });

    it("does not set focused or focusedBonus when focused is not passed", () => {
      const r = resolveMove("Face Danger", "edge", 2, 0);
      expect(r.focused).toBeUndefined();
      expect(r.focusedBonus).toBeUndefined();
    });
  });
});
