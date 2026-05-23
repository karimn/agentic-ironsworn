import { appendFile, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { BeatInput } from "./scenes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signature matching scenes.recordBeat — injected to allow test-time faking. */
export type RecordBeatFn = (
  campaignPath: string,
  sceneId: string,
  beat: BeatInput,
) => Promise<number>;

export interface PushResult {
  /** true when the beat was fire-and-forget (wait=false) */
  queued: boolean;
  /** Optimistically allocated 0-based index */
  beat_index: number;
  /** Error notices from previous beat failures, drained on each call */
  notices: string[];
}

interface QueueEntry {
  sceneId: string;
  beat: BeatInput;
  index: number;
  resolve: (index: number) => void;
  reject: (err: unknown) => void;
}

interface FailureRecord {
  scene_id: string;
  index: number;
  beat: BeatInput;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Module-level notice store (per campaign path)
// ---------------------------------------------------------------------------

const _notices = new Map<string, string[]>();

/**
 * Drain and return all pending error notices for the given campaign.
 * Each call clears the notice queue for that campaign.
 */
export function drainNotices(campaignPath: string): string[] {
  const notices = _notices.get(campaignPath) ?? [];
  _notices.delete(campaignPath);
  return notices;
}

function pushNotice(campaignPath: string, message: string): void {
  const list = _notices.get(campaignPath) ?? [];
  list.push(message);
  _notices.set(campaignPath, list);
}

// ---------------------------------------------------------------------------
// BeatQueue
// ---------------------------------------------------------------------------

/**
 * Async beat queue — one per campaign path.
 *
 * Beats are serialised through a single worker chain so ordering is preserved.
 * On construction, any entries from a previous run's beat-failures.jsonl are
 * automatically re-enqueued.
 */
export class BeatQueue {
  private readonly campaignPath: string;
  private readonly recordBeatFn: RecordBeatFn;
  private readonly failurePath: string;

  /** Monotonically-increasing optimistic index counter */
  private nextIndex = 0;

  /**
   * The worker chain — every new entry is appended via .then() so entries
   * are processed serially in FIFO order.  We start with a resolved promise
   * and append replay entries immediately in the constructor.
   */
  private workerChain: Promise<void> = Promise.resolve();

  constructor(campaignPath: string, recordBeatFn: RecordBeatFn) {
    this.campaignPath = campaignPath;
    this.recordBeatFn = recordBeatFn;
    this.failurePath = join(campaignPath, "beat-failures.jsonl");

    // Schedule replay of any previous failures. This is fire-and-forget —
    // callers that need to wait for replay completion can call flush().
    this.workerChain = this.workerChain.then(() => this._replayFailures());
  }

  /**
   * Enqueue a beat.
   *
   * @param sceneId  Target scene ID.
   * @param beat     Beat content to persist.
   * @param wait     When true, block until the beat is persisted and return
   *                 the real index. When false (default), return immediately
   *                 with an optimistic index.
   */
  async push(sceneId: string, beat: BeatInput, wait: boolean): Promise<PushResult> {
    const notices = drainNotices(this.campaignPath);
    const optimisticIndex = this.nextIndex++;

    if (wait) {
      // Append to the chain and await the result.
      let resolveEntry!: (i: number) => void;
      let rejectEntry!: (e: unknown) => void;
      const entryPromise = new Promise<number>((res, rej) => {
        resolveEntry = res;
        rejectEntry = rej;
      });

      this.workerChain = this.workerChain.then(() =>
        this._process({ sceneId, beat, index: optimisticIndex, resolve: resolveEntry, reject: rejectEntry }),
      );

      const realIndex = await entryPromise;
      return { queued: false, beat_index: realIndex, notices };
    } else {
      // Fire-and-forget: append to chain but do not await.
      this.workerChain = this.workerChain.then(() =>
        this._process({
          sceneId,
          beat,
          index: optimisticIndex,
          resolve: () => {},
          reject: () => {},
        }),
      );

      return { queued: true, beat_index: optimisticIndex, notices };
    }
  }

  /**
   * Wait until the current worker chain has fully drained.
   * Useful before scene export or closure.
   */
  async flush(): Promise<void> {
    await this.workerChain;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _process(entry: QueueEntry): Promise<void> {
    try {
      const realIndex = await this.recordBeatFn(
        this.campaignPath,
        entry.sceneId,
        entry.beat,
      );
      entry.resolve(realIndex);
    } catch (err) {
      entry.reject(err);
      await this._persistFailure(entry.sceneId, entry.index, entry.beat, err);
    }
  }

  private async _persistFailure(
    sceneId: string,
    index: number,
    beat: BeatInput,
    err: unknown,
  ): Promise<void> {
    const record: FailureRecord = {
      scene_id: sceneId,
      index,
      beat,
      timestamp: new Date().toISOString(),
    };
    const message = `beat_index=${index} scene=${sceneId}: ${err instanceof Error ? err.message : String(err)}`;
    pushNotice(this.campaignPath, message);
    try {
      await appendFile(this.failurePath, JSON.stringify(record) + "\n", "utf-8");
    } catch {
      // If we can't write the sidecar, the notice queue is still intact.
    }
  }

  private async _replayFailures(): Promise<void> {
    // Check if the failure file exists
    try {
      await access(this.failurePath);
    } catch {
      return; // no failure file — nothing to replay
    }

    let raw: string;
    try {
      raw = await readFile(this.failurePath, "utf-8");
    } catch {
      return;
    }

    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return;

    const surviving: FailureRecord[] = [];
    for (const line of lines) {
      let record: FailureRecord;
      try {
        record = JSON.parse(line) as FailureRecord;
      } catch {
        continue; // malformed line — skip
      }

      try {
        await this.recordBeatFn(this.campaignPath, record.scene_id, record.beat);
        // Success — do not add to surviving list (will be removed from file)
      } catch {
        // Still failing — keep in file
        surviving.push(record);
      }
    }

    // Rewrite the failure file with only the still-failing entries
    if (surviving.length === 0) {
      try {
        await writeFile(this.failurePath, "", "utf-8");
      } catch {
        // ignore
      }
    } else {
      try {
        await writeFile(
          this.failurePath,
          surviving.map((r) => JSON.stringify(r)).join("\n") + "\n",
          "utf-8",
        );
      } catch {
        // ignore
      }
    }
  }
}
