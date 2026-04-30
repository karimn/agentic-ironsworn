import { describe, it, expect } from "bun:test";
import { rollProgress, tickProgress, TICKS_PER_MARK, classifyBand } from "./progress.js";
import { ProgressTrack } from "../../state/character.js";

const makeTrack = (rank: ProgressTrack["rank"], ticks: number = 0): ProgressTrack => ({
  name: "Test Vow",
  rank,
  kind: "vow",
  ticks,
  completed: false,
});

describe("classifyBand", () => {
  it("strong_hit when score beats both dice", () => {
    expect(classifyBand(6, 4, 5)).toBe("strong_hit");
  });
  it("weak_hit when score beats exactly one", () => {
    expect(classifyBand(5, 4, 5)).toBe("weak_hit");
    expect(classifyBand(5, 5, 4)).toBe("weak_hit");
  });
  it("miss when score beats neither", () => {
    expect(classifyBand(5, 5, 5)).toBe("miss");
    expect(classifyBand(4, 5, 6)).toBe("miss");
  });
  it("tie to a die is not a beat (strict >)", () => {
    expect(classifyBand(5, 5, 3)).toBe("weak_hit"); // beats second only
    expect(classifyBand(5, 5, 5)).toBe("miss");     // ties both = miss
  });
});

describe("TICKS_PER_MARK", () => {
  it("has correct values for all ranks", () => {
    expect(TICKS_PER_MARK.troublesome).toBe(12);
    expect(TICKS_PER_MARK.dangerous).toBe(8);
    expect(TICKS_PER_MARK.formidable).toBe(4);
    expect(TICKS_PER_MARK.extreme).toBe(2);
    expect(TICKS_PER_MARK.epic).toBe(1);
  });
});

describe("tickProgress", () => {
  it("adds ticks for one mark (troublesome)", () => {
    const result = tickProgress(makeTrack("troublesome"), 1);
    expect(result.ticks).toBe(12);
  });

  it("adds ticks for multiple marks", () => {
    const result = tickProgress(makeTrack("dangerous"), 3);
    expect(result.ticks).toBe(24);
  });

  it("clamps ticks at 40", () => {
    const result = tickProgress(makeTrack("troublesome", 36), 1);
    expect(result.ticks).toBe(40);
  });

  it("does not mutate the original track", () => {
    const original = makeTrack("formidable", 0);
    tickProgress(original, 1);
    expect(original.ticks).toBe(0);
  });
});

describe("rollProgress", () => {
  it("returns valid structure", () => {
    const track = makeTrack("dangerous", 20); // 5 marks
    const result = rollProgress(track);
    expect(result.progressScore).toBe(5);
    expect(result.challengeDice[0]).toBeGreaterThanOrEqual(1);
    expect(result.challengeDice[0]).toBeLessThanOrEqual(10);
    expect(["strong_hit", "weak_hit", "miss"]).toContain(result.band);
  });

  it("caps progressScore at 10", () => {
    const track = makeTrack("troublesome", 40); // 10 marks = score 10
    const result = rollProgress(track);
    expect(result.progressScore).toBe(10);
  });

  it("correctly identifies band boundaries", () => {
    const track = makeTrack("dangerous", 20);
    for (let i = 0; i < 1000; i++) {
      const r = rollProgress(track);
      const beatsFirst = r.progressScore > r.challengeDice[0];
      const beatsSecond = r.progressScore > r.challengeDice[1];
      if (beatsFirst && beatsSecond) expect(r.band).toBe("strong_hit");
      else if (beatsFirst || beatsSecond) expect(r.band).toBe("weak_hit");
      else expect(r.band).toBe("miss");
    }
  });
});
