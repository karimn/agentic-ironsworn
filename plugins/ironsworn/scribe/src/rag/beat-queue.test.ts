import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pushBeat, drainNotices, replayFailures, shutdown, _setRecordBeatFn, _resetRecordBeatFn } from "./beat-queue.js";

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

    it("drainNotices clears the notice queue", async () => {
      mockRecordBeat.mockImplementation(async () => { throw new Error("fail"); });
      const entry = await pushBeat(campaignPath, "scene-1", { kind: "narration", text: "x" });
      await entry.settled.catch(() => {});

      drainNotices(campaignPath); // first drain
      const second = drainNotices(campaignPath);
      expect(second).toHaveLength(0);
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

      await replayFailures(campaignPath);

      // Give the worker time to run
      await new Promise((r) => setTimeout(r, 50));

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

      await replayFailures(campaignPath);
      await new Promise((r) => setTimeout(r, 50));

      expect(fs.existsSync(sidecar)).toBe(false);
    });

    it("does nothing when no sidecar file exists", async () => {
      await replayFailures(campaignPath); // should not throw
      expect(mockRecordBeat).not.toHaveBeenCalled();
    });
  });
});
