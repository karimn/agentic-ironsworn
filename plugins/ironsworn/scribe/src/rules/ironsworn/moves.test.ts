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
    // With stat=5, adds=4, actionDie must be ≥1, so min possible is 10
    // Run many times to ensure cap is applied
    for (let i = 0; i < 1000; i++) {
      const r = resolveMove("Strike", "iron", 5, 0, 4);
      expect(r.actionScore).toBeLessThanOrEqual(10);
    }
  });

  it("detects match when challenge dice are equal", () => {
    // Run many times to catch a match
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
    // High momentum, low stat — very likely to trigger burnOffered
    let foundBurn = false;
    for (let i = 0; i < 1000; i++) {
      const r = resolveMove("Face Danger", "edge", 0, 10);
      if (r.burnOffered) { foundBurn = true; break; }
    }
    expect(foundBurn).toBe(true);
  });

  it("sets burnOffered=false when momentum < actionScore", () => {
    // Negative momentum, high stat — never burn offered
    for (let i = 0; i < 100; i++) {
      const r = resolveMove("Face Danger", "edge", 5, -6);
      // With stat=5, adds=0, min actionScore=(1+5)=6 > momentum=-6
      expect(r.burnOffered).toBe(false);
    }
  });

  it("correctly identifies band boundaries", () => {
    // We need to verify the band logic, not just run randomly.
    // Use the returned values to assert the band is computed correctly.
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
});
