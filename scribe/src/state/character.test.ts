import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCharacter,
  saveCharacter,
  takeMomentum,
  sufferHarm,
  sufferStress,
  consumeSupply,
  inflictDebility,
  clearDebility,
  overrideField,
  computeMomentumReset,
  companionSufferHarm,
  companionRestoreHealth,
  upsertCompanion,
  DEBILITIES,
  Character,
} from "./character.js";

const SAMPLE: Character = {
  name: "Kira",
  stats: { edge: 2, heart: 3, iron: 1, shadow: 2, wits: 3 },
  momentum: 2,
  momentumReset: 2,
  health: 5,
  spirit: 5,
  supply: 3,
  debilities: Object.fromEntries(DEBILITIES.map((d) => [d, false])),
  assets: [],
  progressTracks: [],
  companions: [],
  bonds: 0,
  customState: {},
};

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-test-"));
  await saveCharacter(campaignDir, structuredClone(SAMPLE));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true });
});

describe("loadCharacter / saveCharacter", () => {
  it("round-trips character JSON", async () => {
    const loaded = await loadCharacter(campaignDir);
    expect(loaded.name).toBe("Kira");
    expect(loaded.stats.heart).toBe(3);
  });
});

describe("takeMomentum", () => {
  it("adds momentum", async () => {
    const { after } = await takeMomentum(campaignDir, 3);
    expect(after.momentum).toBe(5);
  });

  it("clamps momentum to +10", async () => {
    const { after } = await takeMomentum(campaignDir, 20);
    expect(after.momentum).toBe(10);
  });

  it("clamps momentum to -6", async () => {
    const { after } = await takeMomentum(campaignDir, -20);
    expect(after.momentum).toBe(-6);
  });
});

describe("sufferHarm", () => {
  it("reduces health", async () => {
    const { after } = await sufferHarm(campaignDir, 2);
    expect(after.health).toBe(3);
  });

  it("clamps health to 0", async () => {
    const { after } = await sufferHarm(campaignDir, 10);
    expect(after.health).toBe(0);
  });
});

describe("inflictDebility / clearDebility", () => {
  it("sets debility to true", async () => {
    const { after } = await inflictDebility(campaignDir, "wounded");
    expect(after.debilities.wounded).toBe(true);
  });

  it("recomputes momentumReset when impacting debility added", async () => {
    const { after } = await inflictDebility(campaignDir, "maimed");
    expect(after.momentumReset).toBe(1);
  });

  it("clears debility", async () => {
    await inflictDebility(campaignDir, "wounded");
    const { after } = await clearDebility(campaignDir, "wounded");
    expect(after.debilities.wounded).toBe(false);
  });

  it("throws on invalid debility name", async () => {
    await expect(inflictDebility(campaignDir, "invalid")).rejects.toThrow();
  });
});

describe("computeMomentumReset", () => {
  it("returns 2 with no impacting debilities", () => {
    expect(computeMomentumReset(SAMPLE)).toBe(2);
  });

  it("reduces by 1 per impacting debility", () => {
    const char = {
      ...SAMPLE,
      debilities: { ...SAMPLE.debilities, maimed: true, corrupted: true },
    };
    expect(computeMomentumReset(char)).toBe(0);
  });
});

describe("overrideField", () => {
  it("sets a nested field by dot-path", async () => {
    const { after } = await overrideField(campaignDir, "stats.edge", 4);
    expect(after.stats.edge).toBe(4);
  });

  it("sets a top-level field", async () => {
    const { after } = await overrideField(campaignDir, "bonds", 3);
    expect((after as any).bonds).toBe(3);
  });

  it("throws on missing intermediate segment", async () => {
    await expect(overrideField(campaignDir, "notAField.sub", "x")).rejects.toThrow();
  });
});

describe("upsertCompanion", () => {
  it("adds a new companion", async () => {
    const { after } = await upsertCompanion(campaignDir, "Grey", 4);
    expect(after.companions).toHaveLength(1);
    expect(after.companions[0]).toEqual({ name: "Grey", health: 4 });
  });

  it("updates health of an existing companion", async () => {
    await upsertCompanion(campaignDir, "Grey", 4);
    const { after } = await upsertCompanion(campaignDir, "Grey", 2);
    expect(after.companions).toHaveLength(1);
    expect(after.companions[0]!.health).toBe(2);
  });

  it("clamps health to 5 on upsert", async () => {
    const { after } = await upsertCompanion(campaignDir, "Grey", 10);
    expect(after.companions[0]!.health).toBe(5);
  });

  it("clamps health to 0 on upsert", async () => {
    const { after } = await upsertCompanion(campaignDir, "Grey", -3);
    expect(after.companions[0]!.health).toBe(0);
  });
});

describe("companionSufferHarm", () => {
  beforeEach(async () => {
    await upsertCompanion(campaignDir, "Grey", 4);
  });

  it("reduces companion health", async () => {
    const { after } = await companionSufferHarm(campaignDir, "Grey", 2);
    expect(after.companions[0]!.health).toBe(2);
  });

  it("clamps companion health to 0", async () => {
    const { after } = await companionSufferHarm(campaignDir, "Grey", 10);
    expect(after.companions[0]!.health).toBe(0);
  });

  it("throws when companion not found", async () => {
    await expect(companionSufferHarm(campaignDir, "Unknown", 1)).rejects.toThrow(
      "Companion not found",
    );
  });

  it("is case-insensitive for companion name", async () => {
    const { after } = await companionSufferHarm(campaignDir, "grey", 1);
    expect(after.companions[0]!.health).toBe(3);
  });
});

describe("companionRestoreHealth", () => {
  beforeEach(async () => {
    await upsertCompanion(campaignDir, "Grey", 2);
  });

  it("restores companion health", async () => {
    const { after } = await companionRestoreHealth(campaignDir, "Grey", 2);
    expect(after.companions[0]!.health).toBe(4);
  });

  it("clamps companion health to 5", async () => {
    const { after } = await companionRestoreHealth(campaignDir, "Grey", 10);
    expect(after.companions[0]!.health).toBe(5);
  });

  it("throws when companion not found", async () => {
    await expect(companionRestoreHealth(campaignDir, "Unknown", 1)).rejects.toThrow(
      "Companion not found",
    );
  });
});

describe("loadCharacter backwards compat", () => {
  it("defaults companions to [] when missing from JSON", async () => {
    // Write a character file that lacks the companions field
    const char = structuredClone(SAMPLE);
    const { companions: _removed, ...charWithoutCompanions } = char as any;
    await saveCharacter(campaignDir, charWithoutCompanions as any);
    const loaded = await loadCharacter(campaignDir);
    expect(loaded.companions).toEqual([]);
  });
});
