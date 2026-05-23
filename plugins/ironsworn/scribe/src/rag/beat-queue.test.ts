import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// BeatQueue unit tests
// ---------------------------------------------------------------------------
// These tests exercise BeatQueue in isolation using a fake recordBeat
// implementation so they do not require Ollama or DuckDB.

import { BeatQueue, drainNotices } from "./beat-queue.js";
import type { BeatInput } from "./scenes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-beat-queue-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// Build a fake recordBeat that resolves immediately or rejects on demand.
function makeFakeRecordBeat(opts: {
  failOnCalls?: Set<number>; // 0-indexed call numbers that should reject
  delayMs?: number;
} = {}) {
  let callCount = 0;
  const calls: Array<{ sceneId: string; beat: BeatInput }> = [];

  async function fakeRecordBeat(
    _campaignPath: string,
    sceneId: string,
    beat: BeatInput,
  ): Promise<number> {
    const n = callCount++;
    if (opts.delayMs) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    if (opts.failOnCalls?.has(n)) {
      throw new Error(`fake failure on call ${n}`);
    }
    calls.push({ sceneId, beat });
    return n;
  }

  return { fakeRecordBeat, calls, getCallCount: () => callCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BeatQueue.push — immediate enqueue", () => {
  it("returns optimistic index = 0 for first beat without waiting", async () => {
    const { fakeRecordBeat } = makeFakeRecordBeat();
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    const result = await q.push("scene-1", { kind: "narration", text: "Hello" }, false);
    expect(result.queued).toBe(true);
    expect(result.beat_index).toBe(0);
    expect(result.notices).toEqual([]);
  });

  it("increments optimistic index for successive pushes", async () => {
    const { fakeRecordBeat } = makeFakeRecordBeat({ delayMs: 20 });
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    const r1 = await q.push("scene-1", { kind: "narration", text: "A" }, false);
    const r2 = await q.push("scene-1", { kind: "dialogue", speaker: "X", text: "B" }, false);
    const r3 = await q.push("scene-1", { kind: "move", text: "C" }, false);

    expect(r1.beat_index).toBe(0);
    expect(r2.beat_index).toBe(1);
    expect(r3.beat_index).toBe(2);
  });

  it("processes beats in FIFO order", async () => {
    const { fakeRecordBeat, calls } = makeFakeRecordBeat();
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    await q.push("scene-1", { kind: "narration", text: "first" }, false);
    await q.push("scene-1", { kind: "narration", text: "second" }, false);
    await q.flush();

    expect(calls[0]?.beat.text).toBe("first");
    expect(calls[1]?.beat.text).toBe("second");
  });
});

describe("BeatQueue.push — wait=true", () => {
  it("blocks until persistence completes and returns queued=false", async () => {
    const { fakeRecordBeat, calls } = makeFakeRecordBeat();
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    const result = await q.push("scene-2", { kind: "narration", text: "sync beat" }, true);
    expect(result.queued).toBe(false);
    expect(result.beat_index).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.beat.text).toBe("sync beat");
  });

  it("wait=true beats are serialized after previously-queued beats", async () => {
    const order: string[] = [];
    async function orderedFake(
      _path: string,
      _id: string,
      beat: BeatInput,
    ): Promise<number> {
      order.push(beat.text);
      return order.length - 1;
    }

    const q = new BeatQueue(campaignDir, orderedFake);

    void q.push("s", { kind: "narration", text: "async" }, false);
    await q.push("s", { kind: "narration", text: "sync" }, true);

    expect(order).toEqual(["async", "sync"]);
  });
});

describe("BeatQueue — failure handling", () => {
  it("failed beats are written to beat-failures.jsonl", async () => {
    const { fakeRecordBeat } = makeFakeRecordBeat({ failOnCalls: new Set([0]) });
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    await q.push("scene-3", { kind: "narration", text: "doomed beat" }, true).catch(() => {});
    await q.flush();

    const failurePath = join(campaignDir, "beat-failures.jsonl");
    const content = await readFile(failurePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as {
      scene_id: string;
      index: number;
      beat: BeatInput;
      timestamp: string;
    };
    expect(entry.scene_id).toBe("scene-3");
    expect(entry.beat.text).toBe("doomed beat");
    expect(entry.index).toBe(0);
    expect(typeof entry.timestamp).toBe("string");
  });

  it("drainNotices returns accumulated failure messages", async () => {
    const { fakeRecordBeat } = makeFakeRecordBeat({ failOnCalls: new Set([0]) });
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    await q.push("scene-4", { kind: "narration", text: "fail beat" }, true).catch(() => {});
    await q.flush();

    const notices = drainNotices(campaignDir);
    expect(notices.length).toBeGreaterThan(0);
    expect(drainNotices(campaignDir)).toHaveLength(0);
  });

  it("successful beats after failure produce no notices", async () => {
    const { fakeRecordBeat } = makeFakeRecordBeat();
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    await q.push("scene-5", { kind: "narration", text: "ok beat" }, true);
    await q.flush();

    expect(drainNotices(campaignDir)).toHaveLength(0);
  });
});

describe("BeatQueue.flush", () => {
  it("resolves only after the worker has processed all pending beats", async () => {
    const { fakeRecordBeat, getCallCount } = makeFakeRecordBeat({ delayMs: 10 });
    const q = new BeatQueue(campaignDir, fakeRecordBeat);

    void q.push("s", { kind: "narration", text: "1" }, false);
    void q.push("s", { kind: "narration", text: "2" }, false);
    void q.push("s", { kind: "narration", text: "3" }, false);

    await q.flush();
    expect(getCallCount()).toBe(3);
  });
});

describe("BeatQueue — replay on re-init", () => {
  it("re-enqueues entries from beat-failures.jsonl on construction", async () => {
    const q1 = new BeatQueue(campaignDir, async () => {
      throw new Error("db down");
    });
    await q1.push("scene-6", { kind: "narration", text: "lost beat" }, true).catch(() => {});
    await q1.flush();

    const replayed: string[] = [];
    const q2 = new BeatQueue(campaignDir, async (_path, _id, beat) => {
      replayed.push(beat.text);
      return replayed.length - 1;
    });
    await q2.flush();

    expect(replayed).toContain("lost beat");
  });
});
