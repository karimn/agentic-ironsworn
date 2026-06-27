import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pushBeat, drainNotices, replayFailures, shutdown, _setRecordBeatFn, _resetRecordBeatFn } from "./beat-queue.js";
import { recordScene } from "./scenes.js";
import { getLore } from "./lore.js";

// ---------------------------------------------------------------------------
// Ollama availability check (same pattern as extraction.test.ts)
// ---------------------------------------------------------------------------

let _ollamaReady: boolean | null = null;
async function ollamaAvailable(): Promise<boolean> {
  if (_ollamaReady !== null) return _ollamaReady;
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    _ollamaReady = res.ok;
  } catch {
    _ollamaReady = false;
  }
  return _ollamaReady;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "beat-queue-test-"));
}

function cleanupTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BeatQueue", () => {
  let campaignPath: string;
  let mockRecordBeat: ReturnType<typeof mock<(cp: string, sid: string, beat: unknown) => Promise<number>>>;

  beforeEach(async () => {
    campaignPath = makeTmpDir();
    mockRecordBeat = mock(async () => 0);
    _setRecordBeatFn(mockRecordBeat as unknown as (cp: string, sid: string, beat: import("./scenes.js").BeatInput) => Promise<number>);
    await shutdown(campaignPath);
  });

  afterEach(() => {
    cleanupTmpDir(campaignPath);
  });

  afterAll(() => {
    _resetRecordBeatFn();
  });

  describe("worker error recovery", () => {
    it("can process new beats after a prior catastrophic worker crash", async () => {
      // Simulate a worker that throws *outside* the per-beat try/catch by
      // making the first call throw synchronously before returning a number.
      let callCount = 0;
      mockRecordBeat.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("catastrophic-crash");
        return callCount - 2; // beat index for subsequent calls
      });

      // First beat — will fail; worker catches it and moves on
      const e1 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "bad" });
      await e1.settled.catch(() => {}); // swallow the expected rejection

      // Queue should still function — a second push must complete successfully
      const e2 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "good" });
      await e2.settled;

      expect(mockRecordBeat).toHaveBeenCalledTimes(2);
    });
  });

  describe("pushBeat", () => {
    it("returns an entry with a settled promise immediately", async () => {
      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "The fire crackles." });
      expect(entry).toHaveProperty("settled");
      expect(entry.settled).toBeInstanceOf(Promise);
    });

    it("resolves settled promise after worker processes the beat", async () => {
      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "The fire crackles." });
      await entry.settled;
      expect(mockRecordBeat).toHaveBeenCalledTimes(1);
      expect(mockRecordBeat).toHaveBeenCalledWith(campaignPath, "scene-1", { kind: "narration", text: "The fire crackles." });
    });

    it("processes multiple beats in the order they were pushed", async () => {
      const calls: string[] = [];
      mockRecordBeat.mockImplementation(async (_cp, _sid, beat) => {
        calls.push((beat as { text: string }).text);
        return calls.length - 1;
      });

      const e1 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "first" });
      const e2 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "second" });
      const e3 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "third" });

      await Promise.all([e1.settled, e2.settled, e3.settled]);

      expect(calls).toEqual(["first", "second", "third"]);
    });

    it("queues beats from different scenes serially (one worker per campaign)", async () => {
      const order: string[] = [];
      mockRecordBeat.mockImplementation(async (_cp, sceneId) => {
        order.push(sceneId);
        return 0;
      });

      const e1 = await pushBeat(campaignPath, "scene-A", { kind: "narration", text: "a" });
      const e2 = await pushBeat(campaignPath, "scene-B", { kind: "narration", text: "b" });
      await Promise.all([e1.settled, e2.settled]);

      expect(order).toEqual(["scene-A", "scene-B"]);
    });
  });

  describe("wait semantics", () => {
    it("settled resolves only after recordBeat completes", async () => {
      const order: string[] = [];
      mockRecordBeat.mockImplementation(async () => {
        order.push("recordBeat");
        return 0;
      });

      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      await entry.settled;
      order.push("settled");

      // recordBeat must have run before settled resolved
      expect(order[0]).toBe("recordBeat");
      expect(order[1]).toBe("settled");
    });

    it("not awaiting settled does not block caller", async () => {
      // pushBeat itself should resolve quickly even if worker is still running
      let resolveRecord!: () => void;
      mockRecordBeat.mockImplementation(
        () => new Promise<number>((res) => { resolveRecord = () => res(0); }),
      );

      const before = Date.now();
      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      const elapsed = Date.now() - before;

      // pushBeat returned without waiting for the slow recordBeat
      expect(elapsed).toBeLessThan(200);
      expect(entry.settled).toBeInstanceOf(Promise);

      // Clean up — resolve the pending worker so the queue drains
      resolveRecord();
      await entry.settled;
    });
  });

  describe("failure handling", () => {
    it("rejects settled promise when recordBeat throws", async () => {
      mockRecordBeat.mockImplementation(async () => { throw new Error("Ollama unavailable"); });

      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      await expect(entry.settled).rejects.toThrow("Ollama unavailable");
    });

    it("writes failed beat to beat-failures.jsonl sidecar", async () => {
      mockRecordBeat.mockImplementation(async () => { throw new Error("Ollama unavailable"); });

      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "lost beat" });
      await entry.settled.catch(() => {});

      const sidecar = path.join(campaignPath, "beat-failures.jsonl");
      expect(fs.existsSync(sidecar)).toBe(true);

      const lines = fs.readFileSync(sidecar, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0]!);
      expect(record.sceneId).toBe("scene-1");
      expect(record.beat.text).toBe("lost beat");
      expect(record).toHaveProperty("failedAt");
    });

    it("queues a notice when recordBeat fails", async () => {
      mockRecordBeat.mockImplementation(async () => { throw new Error("embed failed"); });

      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      await entry.settled.catch(() => {});

      const notices = drainNotices(campaignPath);
      expect(notices.length).toBeGreaterThan(0);
      expect(notices[0]).toContain("beat");
    });

    it("notice indicates permanent loss when sidecar write also fails", async () => {
      // Make the recordBeat fail AND the sidecar write fail (read-only campaign dir)
      mockRecordBeat.mockImplementation(async () => { throw new Error("db error"); });

      // Use a campaign path that is a file (not a dir) so mkdirSync fails
      const filePath = path.join(campaignPath, "not-a-dir");
      fs.writeFileSync(filePath, "i am a file");

      const entry = await pushBeat(filePath, "scene-1", { kind: "narration", text: "x" });
      await entry.settled.catch(() => {});

      const notices = drainNotices(filePath);
      expect(notices.length).toBeGreaterThan(0);
      // When the sidecar can't be written, the notice must warn the beat is permanently lost
      expect(notices[0]).toContain("permanently lost");
    });

    it("drainNotices clears the notice queue", async () => {
      mockRecordBeat.mockImplementation(async () => { throw new Error("fail"); });
      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      await entry.settled.catch(() => {});

      drainNotices(campaignPath); // first drain
      const second = drainNotices(campaignPath);
      expect(second).toHaveLength(0);
    });
  });

  describe("fire-and-forget response shape", () => {
    it("beat_index is null before the worker processes the beat", async () => {
      let resolveRecord!: (n: number) => void;
      mockRecordBeat.mockImplementation(
        () => new Promise<number>((res) => { resolveRecord = res; }),
      );

      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "pending" });
      // beatIndex must be null before the worker completes (fire-and-forget semantics)
      expect(entry.beatIndex).toBeNull();

      // Resolve and wait — beatIndex is now set
      resolveRecord(7);
      await entry.settled;
      expect(entry.beatIndex).toBe(7);
    });

    it("notices from prior failed beats surface on the next push call", async () => {
      // First push fails, queuing a notice
      mockRecordBeat.mockImplementationOnce(async () => { throw new Error("fail"); });
      const e1 = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "a" });
      await e1.settled.catch(() => {});

      // drainNotices now returns the notice from the failed beat
      const notices = drainNotices(campaignPath);
      expect(notices.length).toBeGreaterThan(0);
      expect(notices[0]).toContain("beat write failed");
    });
  });

  describe("replayFailures", () => {
    it("re-enqueues beats from beat-failures.jsonl on startup", async () => {
      // Pre-populate a sidecar file
      const sidecar = path.join(campaignPath, "beat-failures.jsonl");
      const record = JSON.stringify({
        sceneId: "scene-1",
        beat: { kind: "narration", text: "replayed beat" },
        failedAt: new Date().toISOString(),
      });
      fs.writeFileSync(sidecar, record + "\n");

      const entries = await replayFailures(campaignPath);
      await Promise.allSettled(entries.map((e) => e.settled));

      expect(mockRecordBeat).toHaveBeenCalledWith(
        campaignPath,
        "scene-1",
        { kind: "narration", text: "replayed beat" },
      );
    });

    it("removes the sidecar file after successful replay", async () => {
      const sidecar = path.join(campaignPath, "beat-failures.jsonl");
      const record = JSON.stringify({
        sceneId: "scene-1",
        beat: { kind: "narration", text: "replayed" },
        failedAt: new Date().toISOString(),
      });
      fs.writeFileSync(sidecar, record + "\n");

      const entries = await replayFailures(campaignPath);
      await Promise.allSettled(entries.map((e) => e.settled));

      expect(fs.existsSync(sidecar)).toBe(false);
    });

    it("does nothing when no sidecar file exists", async () => {
      const entries = await replayFailures(campaignPath); // should not throw
      expect(entries).toHaveLength(0);
      expect(mockRecordBeat).not.toHaveBeenCalled();
    });

    it("returns entries that settle without relying on a timer", async () => {
      // This test replaces the flaky setTimeout(50) pattern — replay entries must
      // be directly awaitable so tests are deterministic on slow CI.
      const sidecar = path.join(campaignPath, "beat-failures.jsonl");
      const lines = [
        JSON.stringify({ sceneId: "s1", beat: { kind: "narration", text: "beat-A" }, failedAt: new Date().toISOString() }),
        JSON.stringify({ sceneId: "s2", beat: { kind: "narration", text: "beat-B" }, failedAt: new Date().toISOString() }),
      ];
      fs.writeFileSync(sidecar, lines.join("\n") + "\n");

      const entries = await replayFailures(campaignPath);
      expect(entries).toHaveLength(2);

      // Await all settled promises — no timer needed
      await Promise.allSettled(entries.map((e) => e.settled));

      expect(mockRecordBeat).toHaveBeenCalledTimes(2);
    });

    it("skips malformed JSONL lines and still replays valid ones", async () => {
      const sidecar = path.join(campaignPath, "beat-failures.jsonl");
      const valid = JSON.stringify({ sceneId: "s1", beat: { kind: "narration", text: "good" }, failedAt: new Date().toISOString() });
      fs.writeFileSync(sidecar, `not-valid-json\n${valid}\n{truncated`);

      const entries = await replayFailures(campaignPath);
      await Promise.allSettled(entries.map((e) => e.settled));

      // Only the valid record was replayed
      expect(mockRecordBeat).toHaveBeenCalledTimes(1);
      expect(mockRecordBeat).toHaveBeenCalledWith(campaignPath, "s1", { kind: "narration", text: "good" });
    });
  });
});

describe("pushBeat — structured canon", () => {
  it("writes a beat's entities and relations, surfacing skips as notices", async () => {
    if (!(await ollamaAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "beat-queue-canon-"));
    const sceneId = await recordScene(dir, "Vera guards Stonehaven; a stranger watches.");

    const entry = await pushBeat(dir, sceneId, {
      kind: "narration",
      text: "Vera guards Stonehaven.",
      entities: [
        { canonical: "Vera", type: "person", summary: "A guard." },
        { canonical: "Stonehaven", type: "place", summary: "A settlement." },
      ],
      relations: [
        { from: "Vera", to: "Stonehaven", label: "GUARDS" },
        { from: "Vera", to: "The Stranger", label: "WATCHED_BY" }, // unresolved → skipped
      ],
    });
    await entry.settled;

    expect(await getLore(dir, "Vera")).not.toBeNull();
    expect(await getLore(dir, "Stonehaven")).not.toBeNull();
    const notices = drainNotices(dir);
    expect(notices.some((n) => n.includes("The Stranger"))).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});
