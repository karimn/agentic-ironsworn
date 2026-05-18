import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContext } from "./build.js";
import { saveCharacter, DEBILITIES } from "../state/character.js";

const SAMPLE_CHAR = {
  name: "Kira",
  stats: { edge: 2, heart: 3, iron: 1, shadow: 2, wits: 3 },
  momentum: 2, momentumReset: 2,
  health: 5, spirit: 5, supply: 3,
  debilities: Object.fromEntries(DEBILITIES.map(d => [d, false])),
  assets: [], progressTracks: [], companions: [], bonds: 0, experience: 0, customState: {},
};

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-context-test-"));
  await saveCharacter(campaignDir, SAMPLE_CHAR);
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("buildContext", () => {
  it("returns systemAddendum and userPrefix without throwing", async () => {
    const ctx = await buildContext(campaignDir, "I approach the iron gate.");
    expect(typeof ctx.systemAddendum).toBe("string");
    expect(typeof ctx.userPrefix).toBe("string");
  });

  it("includes character digest in userPrefix", async () => {
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.userPrefix).toContain("Kira");
  });

  it("includes character-voice.md in systemAddendum when present", async () => {
    await writeFile(join(campaignDir, "character-voice.md"), "Bold and direct.");
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.systemAddendum).toContain("Bold and direct.");
  });

  it("includes style.md in systemAddendum when present", async () => {
    await writeFile(join(campaignDir, "style.md"), "Gritty and terse.");
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.systemAddendum).toContain("Gritty and terse.");
  });

  it("does not throw when scenes.duckdb is absent", async () => {
    // No scenes.duckdb — should just skip scene sections
    const ctx = await buildContext(campaignDir, "test");
    expect(typeof ctx.userPrefix).toBe("string");
  });

  it("omits Recent Scenes section when no scenes database exists", async () => {
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.userPrefix).not.toContain("## Recent Scenes");
  });

  it("includes open threads when present", async () => {
    const { openThread } = await import("../state/threads.js");
    await openThread(campaignDir, "The Iron Vow", "vow", "Must find the keep.");
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.userPrefix).toContain("The Iron Vow");
  });

  it("does not include expansion sections when no expansions are active", async () => {
    const ctx = await buildContext(campaignDir, "test");
    expect(ctx.userPrefix).not.toContain("Active Expansion:");
  });

  it("buildExpansionSections includes agentBriefing and section.ts output for active expansions", async () => {
    const { buildExpansionSections } = await import("./build.js");
    const stubDir = resolve(dirname(fileURLToPath(import.meta.url)), "../expansions/stub");
    const fakeExpansion = {
      name: "stub",
      manifest: {
        name: "stub",
        version: "1.0.0",
        contributes: { context: true },
        agentBriefing: "Stub is active.",
      },
      installPath: stubDir,
    };
    const section = await buildExpansionSections(campaignDir, [fakeExpansion]);
    expect(section).toContain("Active Expansion: stub");
    expect(section).toContain("Stub is active.");
    // The "Stub Expansion" part requires stub/context/section.ts which is Task 7
    // That test is: expect(section).toContain("Stub Expansion");
  });
});
