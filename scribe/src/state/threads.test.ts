import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openThread, closeThread, listThreads, loadThreads } from "./threads.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-threads-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true });
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
