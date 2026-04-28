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
  restoreHealth,
  restoreSpirit,
  restoreSupply,
  computeMomentumReset,
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

describe("restoreHealth", () => {
  it("restores health from partial", async () => {
    await sufferHarm(campaignDir, 3); // health -> 2
    const { after } = await restoreHealth(campaignDir, 2);
    expect(after.health).toBe(4);
  });

  it("clamps health to 5 when restoring beyond max", async () => {
    await sufferHarm(campaignDir, 2); // health -> 3
    const { after } = await restoreHealth(campaignDir, 10);
    expect(after.health).toBe(5);
  });
});

describe("restoreSpirit", () => {
  it("restores spirit from partial", async () => {
    await sufferStress(campaignDir, 3); // spirit -> 2
    const { after } = await restoreSpirit(campaignDir, 2);
    expect(after.spirit).toBe(4);
  });

  it("clamps spirit to 5 when restoring beyond max", async () => {
    await sufferStress(campaignDir, 2); // spirit -> 3
    const { after } = await restoreSpirit(campaignDir, 10);
    expect(after.spirit).toBe(5);
  });
});

describe("restoreSupply", () => {
  it("restores supply from partial", async () => {
    await consumeSupply(campaignDir, 2); // supply -> 1
    const { after } = await restoreSupply(campaignDir, 3);
    expect(after.supply).toBe(4);
  });

  it("clamps supply to 5 when restoring beyond max", async () => {
    const { after } = await restoreSupply(campaignDir, 10);
    expect(after.supply).toBe(5);
  });
});
