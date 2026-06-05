import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openThread, closeThread, listThreads, loadThreads, saveThreads } from "./threads.js";
import type { Thread } from "./threads.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-threads-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("openThread", () => {
  it("creates a new thread", async () => {
    const thread = await openThread(campaignDir, "Find the Iron Keep", "goal", "A sworn goal.");
    expect(thread.title).toBe("Find the Iron Keep");
    expect(thread.kind).toBe("goal");
    expect(thread.status).toBe("open");
    expect(thread.notes).toBe("A sworn goal.");
  });

  it("persists to entity store (world.duckdb)", async () => {
    await openThread(campaignDir, "Find the Iron Keep", "goal");
    const threads = await loadThreads(campaignDir);
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Find the Iron Keep");
  });
});

describe("closeThread", () => {
  it("closes a thread by title", async () => {
    await openThread(campaignDir, "Find the Iron Keep", "goal");
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
    await openThread(campaignDir, "Thread 1", "goal");
    await openThread(campaignDir, "Thread 2", "threat");
    const all = await listThreads(campaignDir);
    expect(all).toHaveLength(2);
  });

  it("filters by status", async () => {
    await openThread(campaignDir, "Thread 1", "goal");
    await openThread(campaignDir, "Thread 2", "threat");
    await closeThread(campaignDir, "Thread 1", "done");
    const open = await listThreads(campaignDir, "open");
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Thread 2");
  });
});

// ---------------------------------------------------------------------------
// Phase 2: entity-backed thread tests (world.duckdb)
// ---------------------------------------------------------------------------

describe("saveThreads / loadThreads round-trip", () => {
  it("saveThreads upserts threads and loadThreads reads them back", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-threads-save-"));
    try {
      const now = new Date().toISOString();
      const threads: Thread[] = [
        {
          title: "Slay the dragon",
          kind: "goal",
          status: "open",
          notes: "The dragon lurks in the eastern peaks.",
          openedAt: now,
        },
        {
          title: "Debt to Mira",
          kind: "debt",
          status: "closed",
          notes: "Owed a favour.",
          openedAt: now,
          closedAt: now,
          resolution: "Favour repaid.",
        },
      ];
      await saveThreads(dir2, threads);
      const loaded = await loadThreads(dir2);
      expect(loaded).toHaveLength(2);
      const titles = loaded.map((t) => t.title);
      expect(titles).toContain("Slay the dragon");
      expect(titles).toContain("Debt to Mira");
      const debt = loaded.find((t) => t.title === "Debt to Mira")!;
      expect(debt.status).toBe("closed");
      expect(debt.resolution).toBe("Favour repaid.");
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("saveThreads is idempotent — re-saving does not duplicate", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-threads-idem-"));
    try {
      const now = new Date().toISOString();
      const threads: Thread[] = [
        { title: "Find the vault", kind: "goal", status: "open", notes: "Hidden somewhere.", openedAt: now },
      ];
      await saveThreads(dir2, threads);
      await saveThreads(dir2, threads);
      const loaded = await loadThreads(dir2);
      expect(loaded).toHaveLength(1);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe("thread campaign isolation", () => {
  it("threads from one campaign are invisible to a sibling campaign dir", async () => {
    await openThread(campaignDir, "Secret thread", "threat", "Only in this campaign.");
    const dir2 = await mkdtemp(join(tmpdir(), "scribe-threads-sibling-"));
    try {
      const threads = await listThreads(dir2);
      const found = threads.some((t) => t.title === "Secret thread");
      expect(found).toBe(false);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});
