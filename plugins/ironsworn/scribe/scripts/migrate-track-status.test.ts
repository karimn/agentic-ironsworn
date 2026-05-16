import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateTrackStatus } from "./migrate-track-status";

describe("migrate-track-status", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migrate-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCharacter(tracks: unknown[]): string {
    const path = join(dir, "character.json");
    const character = {
      name: "Test",
      stats: { edge: 1, heart: 1, iron: 1, shadow: 1, wits: 1 },
      momentum: 2,
      momentumReset: 2,
      health: 5,
      spirit: 5,
      supply: 5,
      debilities: {},
      assets: [],
      progressTracks: tracks,
      companions: [],
      bonds: 0,
      experience: 0,
      customState: {},
    };
    writeFileSync(path, JSON.stringify(character, null, 2));
    return path;
  }

  function readCharacter(path: string): { progressTracks: Record<string, unknown>[] } {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  it("converts completed:true to status:fulfilled", async () => {
    const path = writeCharacter([
      { name: "Old Vow", rank: "epic", kind: "vow", ticks: 30, completed: true },
    ]);
    const result = await migrateTrackStatus(dir);
    expect(result.touched).toBe(1);
    const after = readCharacter(path);
    expect(after.progressTracks[0]).toEqual({
      name: "Old Vow", rank: "epic", kind: "vow", ticks: 30, status: "fulfilled",
    });
    expect(after.progressTracks[0]!.completed).toBeUndefined();
  });

  it("converts completed:false to status:active", async () => {
    const path = writeCharacter([
      { name: "Active Vow", rank: "dangerous", kind: "vow", ticks: 16, completed: false },
    ]);
    await migrateTrackStatus(dir);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
    expect(after.progressTracks[0]!.completed).toBeUndefined();
  });

  it("is idempotent — running twice is a no-op", async () => {
    const path = writeCharacter([
      { name: "Already Migrated", rank: "epic", kind: "vow", ticks: 0, status: "active" },
    ]);
    const r1 = await migrateTrackStatus(dir);
    expect(r1.touched).toBe(0);
    const r2 = await migrateTrackStatus(dir);
    expect(r2.touched).toBe(0);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
  });

  it("handles mixed shapes (some migrated, some legacy)", async () => {
    const path = writeCharacter([
      { name: "Already Migrated", rank: "epic", kind: "vow", ticks: 0, status: "active" },
      { name: "Legacy", rank: "dangerous", kind: "vow", ticks: 8, completed: false },
    ]);
    const result = await migrateTrackStatus(dir);
    expect(result.touched).toBe(1);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
    expect(after.progressTracks[1]!.status).toBe("active");
    expect(after.progressTracks[1]!.completed).toBeUndefined();
  });

  it("throws if character.json is missing", async () => {
    expect(migrateTrackStatus(dir)).rejects.toThrow(/character\.json/);
  });
});
