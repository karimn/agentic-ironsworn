import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findEnclosingWorldRoot,
  slugifyCampaignId,
  titleCaseFromSlug,
  planCampaignOnramp,
  decideInitMode,
} from "./onramp.js";

// ---------------------------------------------------------------------------
// findEnclosingWorldRoot — the fs-walking half
// ---------------------------------------------------------------------------

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "onramp-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("findEnclosingWorldRoot", () => {
  it("returns null when nothing is found (bounded by maxLevels, doesn't hang)", async () => {
    const deep = join(root, "a", "b", "c");
    await mkdir(deep, { recursive: true });
    // Small maxLevels so the walk stops well short of any real world.json
    // that might exist above the OS tmp dir.
    const result = await findEnclosingWorldRoot(deep, 2);
    expect(result).toBeNull();
  });

  it("finds world.json at the start directory itself (isSelf: true)", async () => {
    await writeFile(join(root, "world.json"), "{}");
    const result = await findEnclosingWorldRoot(root);
    expect(result).not.toBeNull();
    expect(result!.worldRoot).toBe(root);
    expect(result!.matchedFile).toBe("world.json");
    expect(result!.isSelf).toBe(true);
  });

  it("finds world.duckdb at a strict ancestor (isSelf: false)", async () => {
    await writeFile(join(root, "world.duckdb"), "");
    const nested = join(root, "campaigns", "sandbox");
    await mkdir(nested, { recursive: true });
    const result = await findEnclosingWorldRoot(nested);
    expect(result).not.toBeNull();
    expect(result!.worldRoot).toBe(root);
    expect(result!.matchedFile).toBe("world.duckdb");
    expect(result!.isSelf).toBe(false);
  });

  it("prefers the nearest ancestor over a more distant one", async () => {
    await writeFile(join(root, "world.json"), "{}");
    const inner = join(root, "campaigns", "default");
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, "world.json"), "{}"); // shouldn't happen in practice, but nearest wins
    const result = await findEnclosingWorldRoot(inner);
    expect(result!.worldRoot).toBe(inner);
  });

  it("respects maxLevels and does not find an ancestor beyond the bound", async () => {
    await writeFile(join(root, "world.json"), "{}");
    const deep = join(root, "a", "b", "c", "d");
    await mkdir(deep, { recursive: true });
    // root -> a -> b -> c -> d is 4 levels up; bound it to 2.
    const result = await findEnclosingWorldRoot(deep, 2);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// slugifyCampaignId / titleCaseFromSlug — pure string helpers
// ---------------------------------------------------------------------------

describe("slugifyCampaignId", () => {
  it("lowercases and dash-separates", () => {
    expect(slugifyCampaignId("Iron Sandbox")).toBe("iron-sandbox");
  });

  it("collapses runs of non-alphanumerics into a single dash", () => {
    expect(slugifyCampaignId("Zura!!  Sandbox__2")).toBe("zura-sandbox-2");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugifyCampaignId("--sandbox--")).toBe("sandbox");
  });

  it("falls back to 'campaign' when there are no alphanumerics", () => {
    expect(slugifyCampaignId("!!!")).toBe("campaign");
    expect(slugifyCampaignId("")).toBe("campaign");
    expect(slugifyCampaignId("   ")).toBe("campaign");
  });
});

describe("titleCaseFromSlug", () => {
  it("title-cases each dash-separated word", () => {
    expect(titleCaseFromSlug("iron-sandbox")).toBe("Iron Sandbox");
  });

  it("handles a single word", () => {
    expect(titleCaseFromSlug("sandbox")).toBe("Sandbox");
  });

  it("falls back to 'New Campaign' for an empty slug", () => {
    expect(titleCaseFromSlug("")).toBe("New Campaign");
  });
});

// ---------------------------------------------------------------------------
// planCampaignOnramp — pure path arithmetic
// ---------------------------------------------------------------------------

describe("planCampaignOnramp", () => {
  it("computes campaignDir under <worldRoot>/campaigns/<id>", () => {
    const plan = planCampaignOnramp({
      cwd: "/homes/user/zura-world",
      worldRoot: "/homes/user/zura-world",
      campaignId: "sandbox",
    });
    expect(plan.campaignDir).toBe("/homes/user/zura-world/campaigns/sandbox");
  });

  it("returns '.' for scribeCampaignValue when cwd already IS the campaign dir", () => {
    const plan = planCampaignOnramp({
      cwd: "/homes/user/zura-world/campaigns/sandbox",
      worldRoot: "/homes/user/zura-world",
      campaignId: "sandbox",
    });
    expect(plan.scribeCampaignValue).toBe(".");
  });

  it("computes a descending relative path when cwd is the world root", () => {
    const plan = planCampaignOnramp({
      cwd: "/homes/user/zura-world",
      worldRoot: "/homes/user/zura-world",
      campaignId: "sandbox",
    });
    expect(plan.scribeCampaignValue).toBe("campaigns/sandbox");
  });

  it("computes a '../'-prefixed relative path when cwd is a sibling satellite folder", () => {
    const plan = planCampaignOnramp({
      cwd: "/homes/user/zura-sandbox-project",
      worldRoot: "/homes/user/zura-world",
      campaignId: "sandbox",
    });
    expect(plan.scribeCampaignValue).toBe("../zura-world/campaigns/sandbox");
  });
});

// ---------------------------------------------------------------------------
// decideInitMode — the fresh-world vs. new-campaign decision
// ---------------------------------------------------------------------------

describe("decideInitMode", () => {
  it("is fresh-world when there is no explicit path and no detection", () => {
    expect(decideInitMode({ detection: null })).toEqual({ kind: "fresh-world" });
  });

  it("is fresh-world when detection matches cwd itself (isSelf: true)", () => {
    const mode = decideInitMode({
      detection: { worldRoot: "/w", matchedFile: "world.json", isSelf: true },
    });
    expect(mode).toEqual({ kind: "fresh-world" });
  });

  it("is new-campaign (auto: true) when detection matches a strict ancestor", () => {
    const mode = decideInitMode({
      detection: { worldRoot: "/w", matchedFile: "world.json", isSelf: false },
    });
    expect(mode).toEqual({ kind: "new-campaign", worldRoot: "/w", auto: true });
  });

  it("is new-campaign (auto: false) when an explicit world root is given, even if detection is isSelf", () => {
    const mode = decideInitMode({
      explicitWorldRoot: "/explicit-world",
      detection: { worldRoot: "/w", matchedFile: "world.json", isSelf: true },
    });
    expect(mode).toEqual({ kind: "new-campaign", worldRoot: "/explicit-world", auto: false });
  });

  it("is new-campaign (auto: false) when an explicit world root is given and there is no detection", () => {
    const mode = decideInitMode({ explicitWorldRoot: "/explicit-world", detection: null });
    expect(mode).toEqual({ kind: "new-campaign", worldRoot: "/explicit-world", auto: false });
  });
});
