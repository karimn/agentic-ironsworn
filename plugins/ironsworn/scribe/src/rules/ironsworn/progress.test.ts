import { describe, it, expect } from "bun:test";
import { rollProgress, tickProgress, TICKS_PER_MARK, classifyBand, vowXp, VOW_XP } from "./progress.js";
import { ProgressTrack } from "../../state/character.js";

const makeTrack = (rank: ProgressTrack["rank"], ticks: number = 0, kind: ProgressTrack["kind"] = "vow"): ProgressTrack => ({
  name: "Test Track",
  rank,
  kind,
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

describe("VOW_XP table", () => {
  it("has correct strong_hit values for all ranks", () => {
    expect(VOW_XP.troublesome.strong_hit).toBe(1);
    expect(VOW_XP.dangerous.strong_hit).toBe(2);
    expect(VOW_XP.formidable.strong_hit).toBe(3);
    expect(VOW_XP.extreme.strong_hit).toBe(4);
    expect(VOW_XP.epic.strong_hit).toBe(5);
  });

  it("has correct weak_hit values for all ranks", () => {
    expect(VOW_XP.troublesome.weak_hit).toBe(0);
    expect(VOW_XP.dangerous.weak_hit).toBe(1);
    expect(VOW_XP.formidable.weak_hit).toBe(2);
    expect(VOW_XP.extreme.weak_hit).toBe(2);
    expect(VOW_XP.epic.weak_hit).toBe(3);
  });
});

describe("vowXp", () => {
  it("returns 0 for non-vow tracks regardless of outcome", () => {
    expect(vowXp(makeTrack("formidable", 0, "journey"), "strong_hit")).toBe(0);
    expect(vowXp(makeTrack("extreme",    0, "combat"),  "strong_hit")).toBe(0);
    expect(vowXp(makeTrack("dangerous",  0, "bond"),    "weak_hit")).toBe(0);
    expect(vowXp(makeTrack("epic",       0, "other"),   "strong_hit")).toBe(0);
  });

  it("returns 0 for a miss on a vow", () => {
    expect(vowXp(makeTrack("epic"), "miss")).toBe(0);
  });

  it("awards XP for a vow strong_hit matching the rank table", () => {
    expect(vowXp(makeTrack("troublesome"), "strong_hit")).toBe(1);
    expect(vowXp(makeTrack("dangerous"),   "strong_hit")).toBe(2);
    expect(vowXp(makeTrack("formidable"),  "strong_hit")).toBe(3);
    expect(vowXp(makeTrack("extreme"),     "strong_hit")).toBe(4);
    expect(vowXp(makeTrack("epic"),        "strong_hit")).toBe(5);
  });

  it("awards XP for a vow weak_hit matching the rank table", () => {
    expect(vowXp(makeTrack("troublesome"), "weak_hit")).toBe(0);
    expect(vowXp(makeTrack("dangerous"),   "weak_hit")).toBe(1);
    expect(vowXp(makeTrack("formidable"),  "weak_hit")).toBe(2);
    expect(vowXp(makeTrack("extreme"),     "weak_hit")).toBe(2);
    expect(vowXp(makeTrack("epic"),        "weak_hit")).toBe(3);
  });
});
