/**
 * BeatQueue — async fire-and-forget beat persistence.
 *
 * The MCP `record_beat` tool pushes entries here and returns immediately.
 * A serial worker per campaign path drains the queue in the background,
 * calling `recordBeat` from scenes.ts for each entry.
 *
 * On failure:
 *  - The failed beat is appended to `<campaignPath>/beat-failures.jsonl`
 *  - An error notice is queued for the agent to see on its next tool response
 *  - `entry.settled` rejects so callers using `wait: true` learn immediately
 *
 * On server startup, call `replayFailures(campaignPath)` to re-enqueue any
 * beats that failed in a previous session.
 */

import * as fs from "fs";
import * as path from "path";
import { recordBeat as _defaultRecordBeat } from "./scenes.js";
import type { BeatInput } from "./scenes.js";

// ---------------------------------------------------------------------------
// Pluggable recordBeat — injectable for testing without module-level mocking
// ---------------------------------------------------------------------------

type RecordBeatFn = (campaignPath: string, sceneId: string, beat: BeatInput) => Promise<number>;

let _recordBeat: RecordBeatFn = _defaultRecordBeat;

/**
 * Override the `recordBeat` implementation used by the queue worker.
 * Intended for unit tests only — not part of the public production API.
 */
export function _setRecordBeatFn(fn: RecordBeatFn): void {
  _recordBeat = fn;
}

/** Restore the default implementation (call in afterAll/afterEach in tests). */
export function _resetRecordBeatFn(): void {
  _recordBeat = _defaultRecordBeat;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BeatQueueEntry {
  campaignPath: string;
  sceneId: string;
  beat: BeatInput;
  /**
   * The 0-based index of the beat in its scene, set by the worker after
   * `recordBeat` completes. `null` until then (i.e. before `settled` resolves).
   */
  beatIndex: number | null;
  /** Resolves when the worker persists the beat; rejects on failure. */
  settled: Promise<void>;
  /** @internal */
  _resolve: () => void;
  /** @internal */
  _reject: (e: unknown) => void;
}

interface FailureRecord {
  sceneId: string;
  beat: BeatInput;
  failedAt: string;
}

// ---------------------------------------------------------------------------
// Module state — one queue + worker flag per campaign path
// ---------------------------------------------------------------------------

const _queues = new Map<string, BeatQueueEntry[]>();
const _workerRunning = new Map<string, boolean>();
const _notices = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push a beat onto the async queue and return an entry whose `settled` promise
 * resolves when the worker has persisted it (or rejects on failure).
 *
 * Returns immediately — the caller does NOT need to await this function, but
 * can await `entry.settled` if it needs to block (e.g. before export).
 */
export async function pushBeat(
  campaignPath: string,
  sceneId: string,
  beat: BeatInput,
): Promise<BeatQueueEntry> {
  let _resolve!: () => void;
  let _reject!: (e: unknown) => void;
  const settled = new Promise<void>((res, rej) => {
    _resolve = res;
    _reject = rej;
  });

  const entry: BeatQueueEntry = { campaignPath, sceneId, beat, beatIndex: null, settled, _resolve, _reject };

  if (!_queues.has(campaignPath)) {
    _queues.set(campaignPath, []);
  }
  _queues.get(campaignPath)!.push(entry);

  void _ensureWorker(campaignPath);

  return entry;
}

/**
 * Drain and return any pending error notices for this campaign.
 * Call this in every MCP tool handler before returning to the agent so
 * failures surface naturally on the next interaction.
 */
export function drainNotices(campaignPath: string): string[] {
  const notices = _notices.get(campaignPath) ?? [];
  _notices.set(campaignPath, []);
  return notices;
}

/**
 * Re-enqueue any beats recorded in `beat-failures.jsonl` from a previous
 * session. Call once on server startup before registering tools.
 *
 * Returns the enqueued entries so callers can await their settled promises
 * deterministically (no setTimeout needed in tests or shutdown paths).
 */
export async function replayFailures(campaignPath: string): Promise<BeatQueueEntry[]> {
  const sidecar = _sidecarPath(campaignPath);
  if (!fs.existsSync(sidecar)) return [];

  let lines: string[];
  try {
    lines = fs.readFileSync(sidecar, "utf8").trim().split("\n").filter(Boolean);
  } catch (e) {
    process.stderr.write(`[scribe] beat-queue: could not read sidecar ${sidecar}: ${e}\n`);
    return [];
  }

  const records: FailureRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as FailureRecord);
    } catch {
      process.stderr.write(`[scribe] beat-queue: skipping malformed failure record: ${JSON.stringify(line.slice(0, 200))}\n`);
    }
  }

  if (records.length === 0) {
    _removeSidecar(campaignPath);
    return [];
  }

  // Re-enqueue; remove the sidecar optimistically — if replay fails again,
  // the worker will write a fresh sidecar entry.
  _removeSidecar(campaignPath);

  const entries: BeatQueueEntry[] = [];
  for (const record of records) {
    entries.push(await pushBeat(campaignPath, record.sceneId, record.beat));
  }
  return entries;
}

/**
 * Drain the queue for a campaign path and wait for the worker to finish.
 * Useful in tests and graceful-shutdown paths.
 */
export async function shutdown(campaignPath: string): Promise<void> {
  const queue = _queues.get(campaignPath);
  if (!queue || queue.length === 0) {
    _queues.delete(campaignPath);
    _workerRunning.delete(campaignPath);
    return;
  }
  // Wait for all settled promises (ignoring rejections — callers handle those)
  const entries = [...queue];
  await Promise.allSettled(entries.map((e) => e.settled));
  _queues.delete(campaignPath);
  _workerRunning.delete(campaignPath);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

function _ensureWorker(campaignPath: string): void {
  if (_workerRunning.get(campaignPath)) return;
  _workerRunning.set(campaignPath, true);
  _runWorker(campaignPath).catch((err: unknown) => {
    // Defensive guard — _runWorker's while-loop already catches per-beat errors,
    // so this only fires on truly unexpected failures (programming errors, OOM, etc.)
    process.stderr.write(`[scribe] beat-queue: worker crashed unexpectedly for ${campaignPath}: ${err}\n`);
    _workerRunning.set(campaignPath, false);
  });
}

async function _runWorker(campaignPath: string): Promise<void> {
  const queue = _queues.get(campaignPath);
  if (!queue) {
    _workerRunning.set(campaignPath, false);
    return;
  }

  while (queue.length > 0) {
    const entry = queue[0]!;
    try {
      entry.beatIndex = await _recordBeat(campaignPath, entry.sceneId, entry.beat);
      entry._resolve();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const sidecarOk = _appendSidecar(campaignPath, entry);
      const noticeDetail = sidecarOk
        ? "Beat saved to beat-failures.jsonl for replay on next startup."
        : "Sidecar write also failed — beat is permanently lost and will NOT be replayed.";
      _queueNotice(campaignPath, `[scribe] beat write failed for scene ${entry.sceneId}: ${msg}. ${noticeDetail}`);
      process.stderr.write(`[scribe] beat-queue: failed to persist beat for scene ${entry.sceneId}: ${msg}\n`);
      entry._reject(e);
    }
    queue.shift();
  }

  _workerRunning.set(campaignPath, false);
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function _queueNotice(campaignPath: string, notice: string): void {
  if (!_notices.has(campaignPath)) {
    _notices.set(campaignPath, []);
  }
  _notices.get(campaignPath)!.push(notice);
}

// ---------------------------------------------------------------------------
// Sidecar helpers
// ---------------------------------------------------------------------------

function _sidecarPath(campaignPath: string): string {
  return path.join(campaignPath, "beat-failures.jsonl");
}

/** Returns true if the sidecar was written successfully, false on failure. */
function _appendSidecar(campaignPath: string, entry: BeatQueueEntry): boolean {
  const record: FailureRecord = {
    sceneId: entry.sceneId,
    beat: entry.beat,
    failedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(campaignPath, { recursive: true });
    fs.appendFileSync(_sidecarPath(campaignPath), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (e) {
    process.stderr.write(`[scribe] beat-queue: could not write sidecar — beat permanently lost: ${e}\n`);
    return false;
  }
}

function _removeSidecar(campaignPath: string): void {
  try {
    fs.unlinkSync(_sidecarPath(campaignPath));
  } catch {
    // Already gone — fine
  }
}
