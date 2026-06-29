import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildContext, buildContradictionsSection } from "./build.js";
import { saveCharacter, DEBILITIES } from "../state/character.js";
import type { OpenContradiction } from "@agentic-rpg/core";

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

  it("emits an Open Contradictions section when unresolved rows exist for the campaign", async () => {
    const { resolveWorldContext, getWorldDb, openWorldWriteConn } = await import("@agentic-rpg/core");
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const entityId = crypto.randomUUID();
      const emb = `[${[1.0, ...Array(767).fill(0.0)].join(",")}]::FLOAT[768]`;
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO entities
           (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
            campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, 'bridgekeeper', 'Bridgekeeper', [], 'person', 'keeps the bridge', '{}', '{}', ${emb}, ?, ?, ?, ?)`,
        [entityId, ctx.campaignId, ctx.campaignId, now, now],
      );
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, entity_id, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'entity_summary_divergence', ?, 'guards the bridge', 'burned the bridge', ?, ?)`,
        [crypto.randomUUID(), entityId, ctx.campaignId, now],
      );
    } finally {
      conn.closeSync();
    }

    const result = await buildContext(campaignDir, "We approach the river.");
    expect(result.userPrefix).toContain("## Open Contradictions");
    expect(result.userPrefix).toContain("Bridgekeeper");
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

describe("buildContradictionsSection", () => {
  function entityItem(name: string, id: string): OpenContradiction {
    return {
      id,
      kind: "entity_summary_divergence",
      names: [name],
      existing_value: `${name} did one thing`,
      incoming_value: `${name} did another thing`,
      created_at: new Date().toISOString(),
    };
  }

  it("returns an empty string when there are no open contradictions", () => {
    expect(buildContradictionsSection([], ["some scene"])).toBe("");
  });

  it("renders a header and a bullet per surfaced contradiction", () => {
    const section = buildContradictionsSection(
      [entityItem("Bridgekeeper", "a")],
      [],
    );
    expect(section).toContain("## Open Contradictions");
    expect(section).toContain("Bridgekeeper");
  });

  it("caps the number of surfaced contradictions", () => {
    const items = Array.from({ length: 9 }, (_, i) => entityItem(`Entity${i}`, `id${i}`));
    const section = buildContradictionsSection(items, [], 5);
    const bulletCount = section.split("\n").filter((l) => l.trim().startsWith("-")).length;
    expect(bulletCount).toBe(5);
  });

  it("prioritizes contradictions whose entity is referenced in recent scenes", () => {
    // 6 decoys (created later → newer) plus one on-stage entity (created first → oldest).
    const decoys = Array.from({ length: 6 }, (_, i) => entityItem(`Decoy${i}`, `d${i}`));
    const onStage = entityItem("Bridgekeeper", "on-stage");
    const items = [...decoys, onStage];
    const section = buildContradictionsSection(items, ["The Bridgekeeper bars our path."], 5);
    // On-stage entity must survive the cap despite being oldest, by relevance.
    expect(section).toContain("Bridgekeeper");
  });
});
