import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordObservation,
  listObservations,
  resolveObservation,
} from "./observations.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-observation-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("recordObservation", () => {
  it("inserts a row scoped to the active campaign and returns it", async () => {
    const obs = await recordObservation(campaignDir, {
      source: "referee",
      severity: "hard",
      kind: "state_drift",
      detail: 'Narrated "-2 health" with no suffer_harm call',
      turnRef: "sess-1:42",
      blocked: true,
    });

    expect(obs.id).toBeTruthy();
    expect(obs.kind).toBe("state_drift");
    expect(obs.blocked).toBe(true);

    const listed = await listObservations(campaignDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(obs.id);
    expect(listed[0]!.turn_ref).toBe("sess-1:42");
    expect(listed[0]!.campaign_id).toBe(obs.campaign_id);
  });

  it("defaults blocked to false and turn_ref to undefined", async () => {
    await recordObservation(campaignDir, {
      source: "watcher",
      severity: "soft",
      kind: "beat_starvation",
      detail: "Scene open for 6 turns with no beats",
    });
    const [obs] = await listObservations(campaignDir);
    expect(obs!.blocked).toBe(false);
    expect(obs!.turn_ref).toBeUndefined();
  });
});

describe("listObservations", () => {
  it("filters by kind and excludes resolved rows by default", async () => {
    const a = await recordObservation(campaignDir, {
      source: "referee",
      severity: "hard",
      kind: "phantom_roll",
      detail: "a",
    });
    await recordObservation(campaignDir, {
      source: "referee",
      severity: "soft",
      kind: "milestone_skip",
      detail: "b",
    });

    const phantoms = await listObservations(campaignDir, { kind: "phantom_roll" });
    expect(phantoms).toHaveLength(1);
    expect(phantoms[0]!.id).toBe(a.id);

    await resolveObservation(campaignDir, a.id, "tuned regex");
    const unresolved = await listObservations(campaignDir);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.kind).toBe("milestone_skip");

    const all = await listObservations(campaignDir, { unresolvedOnly: false });
    expect(all).toHaveLength(2);
    const resolved = all.find((o) => o.id === a.id);
    expect(resolved!.resolved_at).toBeTruthy();
    expect(resolved!.resolution).toBe("tuned regex");
  });

  it("filters by since timestamp", async () => {
    await recordObservation(campaignDir, {
      source: "referee",
      severity: "soft",
      kind: "ungrounded_entity",
      detail: "old",
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    const recent = await listObservations(campaignDir, { since: future });
    expect(recent).toHaveLength(0);
  });

  it("does not leak observations across campaigns in the same world", async () => {
    // Build an explicit world root with two campaigns sharing one world.duckdb.
    const worldRoot = await mkdtemp(join(tmpdir(), "scribe-observation-world-"));
    try {
      await writeFile(
        join(worldRoot, "world.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "test-world",
          embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
        }),
      );
      const campA = join(worldRoot, "campaigns", "alpha");
      const campB = join(worldRoot, "campaigns", "beta");
      for (const [dir, id] of [[campA, "alpha"], [campB, "beta"]] as const) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "campaign.json"), JSON.stringify({ id, name: id }));
      }

      await recordObservation(campA, {
        source: "referee",
        severity: "hard",
        kind: "state_drift",
        detail: "alpha-only",
      });

      expect(await listObservations(campA)).toHaveLength(1);
      expect(await listObservations(campB)).toHaveLength(0);
    } finally {
      await rm(worldRoot, { recursive: true, force: true });
    }
  });
});

describe("resolveObservation", () => {
  it("is scoped to the campaign — cannot resolve another campaign's row", async () => {
    const worldRoot = await mkdtemp(join(tmpdir(), "scribe-observation-world2-"));
    try {
      await writeFile(
        join(worldRoot, "world.json"),
        JSON.stringify({
          schemaVersion: 1,
          name: "test-world",
          embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
        }),
      );
      const campA = join(worldRoot, "campaigns", "alpha");
      const campB = join(worldRoot, "campaigns", "beta");
      for (const [dir, id] of [[campA, "alpha"], [campB, "beta"]] as const) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "campaign.json"), JSON.stringify({ id, name: id }));
      }

      const obs = await recordObservation(campA, {
        source: "referee",
        severity: "hard",
        kind: "state_drift",
        detail: "alpha-only",
      });

      await resolveObservation(campB, obs.id, "should not apply");
      const [stillOpen] = await listObservations(campA);
      expect(stillOpen!.resolved_at).toBeUndefined();
    } finally {
      await rm(worldRoot, { recursive: true, force: true });
    }
  });
});
