import { describe, it, expect } from "bun:test";
import { lookupAsset } from "./assets.js";

describe("lookupAsset", () => {
  it("returns undefined for unknown asset", () => {
    expect(lookupAsset("Nonexistent")).toBeUndefined();
  });

  it("looks up Swordmaster (combat talent)", () => {
    const asset = lookupAsset("Swordmaster");
    expect(asset).toBeDefined();
    expect(asset!.type).toBe("combat_talent");
    expect(asset!.requires).toContain("sword");
    expect(asset!.abilities).toHaveLength(3);
    expect(asset!.abilities[0].default).toBe(true);
    expect(asset!.abilities[0].text).toContain("burn momentum");
  });

  it("looks up Slayer (path)", () => {
    const asset = lookupAsset("Slayer");
    expect(asset).toBeDefined();
    expect(asset!.type).toBe("path");
    expect(asset!.abilities[0].text).toContain("beast or horror");
  });

  it("looks up Hound (companion with health)", () => {
    const asset = lookupAsset("Hound");
    expect(asset).toBeDefined();
    expect(asset!.type).toBe("companion");
    expect(asset!.health).toBe(4);
    expect(asset!.abilities[0].name).toBe("Sharp");
    expect(asset!.abilities[0].text).toContain("keen senses");
  });

  it("is case-insensitive", () => {
    expect(lookupAsset("swordmaster")).toBeDefined();
    expect(lookupAsset("HOUND")).toBeDefined();
    expect(lookupAsset("slayer")).toBeDefined();
  });

  it("companions have no health for Kindred (no health track)", () => {
    const asset = lookupAsset("Kindred");
    expect(asset).toBeDefined();
    expect(asset!.type).toBe("companion");
    expect(asset!.health).toBeUndefined();
  });
});
