import { describe, it, expect } from "bun:test";
import { roll } from "./dice.js";

describe("roll", () => {
  it("rolls a single d6", () => {
    const r = roll("d6");
    expect(r.rolls).toHaveLength(1);
    expect(r.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(r.rolls[0]).toBeLessThanOrEqual(6);
    expect(r.total).toBe(r.rolls[0]);
  });

  it("rolls 2d10", () => {
    const r = roll("2d10");
    expect(r.rolls).toHaveLength(2);
    r.rolls.forEach(d => {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    });
    expect(r.total).toBe(r.rolls[0] + r.rolls[1]);
  });

  it("rolls d100", () => {
    const r = roll("d100");
    expect(r.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(r.rolls[0]).toBeLessThanOrEqual(100);
  });

  it("applies positive modifier", () => {
    const r = roll("1d6+2");
    expect(r.total).toBe(r.rolls[0] + 2);
  });

  it("applies negative modifier", () => {
    const r = roll("1d6-1");
    expect(r.total).toBe(r.rolls[0] - 1);
  });

  it("rolls multiple dice", () => {
    const r = roll("3d6");
    expect(r.rolls).toHaveLength(3);
    expect(r.total).toBe(r.rolls.reduce((a, b) => a + b, 0));
  });

  it("throws on invalid notation", () => {
    expect(() => roll("invalid")).toThrow();
    expect(() => roll("d0")).toThrow();
  });
});
