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
  await saveCharacter(campaignDir, { ...SAMPLE });
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
