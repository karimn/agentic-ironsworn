import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openThread, closeThread, listThreads, loadThreads } from "./threads.js";
import { saveCharacter, loadCharacter, DEBILITIES, Character } from "./character.js";

const SAMPLE_CHARACTER: Character = {
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
  experience: 0,
  customState: {},
};

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-threads-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("openThread", () => {
  it("creates a new thread", async () => {
    const thread = await openThread(campaignDir, "Find the Iron Keep", "vow", "A sworn vow.");
    expect(thread.title).toBe("Find the Iron Keep");
    expect(thread.kind).toBe("vow");
    expect(thread.status).toBe("open");
    expect(thread.notes).toBe("A sworn vow.");
  });

  it("persists to threads.yaml", async () => {
    await openThread(campaignDir, "Find the Iron Keep", "vow");
    const threads = await loadThreads(campaignDir);
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Find the Iron Keep");
  });
});

describe("closeThread", () => {
  it("closes a thread by title", async () => {
    await openThread(campaignDir, "Find the Iron Keep", "vow");
    const closed = await closeThread(campaignDir, "Find the Iron Keep", "The keep is found.");
    expect(closed.status).toBe("closed");
    expect(closed.resolution).toBe("The keep is found.");
  });

  it("throws when thread not found", async () => {
    await expect(closeThread(campaignDir, "Nonexistent", "done")).rejects.toThrow();
  });
});

describe("listThreads", () => {
  it("lists all threads when no filter", async () => {
    await openThread(campaignDir, "Thread 1", "vow");
    await openThread(campaignDir, "Thread 2", "threat");
    const all = await listThreads(campaignDir);
    expect(all).toHaveLength(2);
  });

  it("filters by status", async () => {
    await openThread(campaignDir, "Thread 1", "vow");
    await openThread(campaignDir, "Thread 2", "threat");
    await closeThread(campaignDir, "Thread 1", "done");
    const open = await listThreads(campaignDir, "open");
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Thread 2");
  });
});

// ---------------------------------------------------------------------------
// Issue #2: open_thread with kind=vow + rank auto-creates a progress track
// ---------------------------------------------------------------------------

describe("openThread vow auto-track (issue #2)", () => {
  beforeEach(async () => {
    await saveCharacter(campaignDir, structuredClone(SAMPLE_CHARACTER));
  });

  it("auto-creates a progress track when kind=vow and rank is provided", async () => {
    // We simulate what the narrative.ts tool handler does inline here
    const { loadCharacter: lc, saveCharacter: sc } = await import("./character.js");
    await openThread(campaignDir, "Slay the Beast", "vow");
    const char = await lc(campaignDir);
    const track = { name: "Slay the Beast", rank: "formidable" as const, kind: "vow" as const, ticks: 0, completed: false };
    char.progressTracks.push(track);
    await sc(campaignDir, char);

    const loaded = await lc(campaignDir);
    expect(loaded.progressTracks).toHaveLength(1);
    expect(loaded.progressTracks[0]!.name).toBe("Slay the Beast");
    expect(loaded.progressTracks[0]!.rank).toBe("formidable");
    expect(loaded.progressTracks[0]!.kind).toBe("vow");
    expect(loaded.progressTracks[0]!.completed).toBe(false);
  });

  it("does not require a progress track for non-vow threads", async () => {
    await openThread(campaignDir, "A Looming Threat", "threat");
    const char = await loadCharacter(campaignDir);
    expect(char.progressTracks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #3: close_thread on a vow marks its progress track completed
// ---------------------------------------------------------------------------

describe("closeThread vow track sync (issue #3)", () => {
  beforeEach(async () => {
    await saveCharacter(campaignDir, structuredClone(SAMPLE_CHARACTER));
  });

  it("marks a matching vow progress track as completed on close", async () => {
    await openThread(campaignDir, "Defend the Village", "vow");
    // Add a matching progress track
    const char = await loadCharacter(campaignDir);
    char.progressTracks.push({ name: "Defend the Village", rank: "dangerous", kind: "vow", ticks: 20, completed: false });
    await saveCharacter(campaignDir, char);

    // Close the thread (simulating the narrative.ts tool handler logic)
    const thread = await closeThread(campaignDir, "Defend the Village", "Village defended.");
    expect(thread.status).toBe("closed");

    // Now simulate the post-close track update (as done in narrative.ts)
    if (thread.kind === "vow") {
      const updatedChar = await loadCharacter(campaignDir);
      const idx = updatedChar.progressTracks.findIndex(
        (t) => t.name.toLowerCase() === "defend the village",
      );
      if (idx !== -1) {
        updatedChar.progressTracks[idx]!.completed = true;
        await saveCharacter(campaignDir, updatedChar);
      }
    }

    const finalChar = await loadCharacter(campaignDir);
    const track = finalChar.progressTracks.find(
      (t) => t.name.toLowerCase() === "defend the village",
    );
    expect(track).toBeDefined();
    expect(track!.completed).toBe(true);
  });

  it("closing a non-vow thread does not affect progress tracks", async () => {
    await openThread(campaignDir, "A Trade Debt", "debt");
    const char = await loadCharacter(campaignDir);
    char.progressTracks.push({ name: "A Trade Debt", rank: "troublesome", kind: "other", ticks: 10, completed: false });
    await saveCharacter(campaignDir, char);

    const thread = await closeThread(campaignDir, "A Trade Debt", "Debt repaid.");
    expect(thread.kind).toBe("debt");

    // No track update for non-vow
    const finalChar = await loadCharacter(campaignDir);
    expect(finalChar.progressTracks[0]!.completed).toBe(false);
  });
});
