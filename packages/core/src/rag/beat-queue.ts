import * as fs from "fs";
import * as path from "path";
import { recordBeat as _defaultRecordBeat } from "./scenes.js";
import type { BeatInput } from "./scenes.js";
import { recordBeatCanon as _defaultRecordBeatCanon } from "./beat-canon.js";
import type { BeatEntity, BeatRelation, BeatCanonResult } from "./beat-canon.js";

type RecordBeatFn = (campaignPath: string, sceneId: string, beat: BeatInput) => Promise<number>;
type RecordBeatCanonFn = (campaignPath: string, sceneId: string, entities: BeatEntity[] | undefined, relations: BeatRelation[] | undefined) => Promise<BeatCanonResult>;

let _recordBeat: RecordBeatFn = _defaultRecordBeat;
let _recordBeatCanon: RecordBeatCanonFn = _defaultRecordBeatCanon;

export function _setRecordBeatFn(fn: RecordBeatFn): void {
  _recordBeat = fn;
}

export function _resetRecordBeatFn(): void {
  _recordBeat = _defaultRecordBeat;
}

export function _setRecordBeatCanonFn(fn: RecordBeatCanonFn): void {
  _recordBeatCanon = fn;
}

export function _resetRecordBeatCanonFn(): void {
  _recordBeatCanon = _defaultRecordBeatCanon;
}

export interface BeatQueueEntry {
  campaignPath: string;
  sceneId: string;
  beat: BeatInput;
  beatIndex: number | null;
  settled: Promise<void>;
  _resolve: () => void;
  _reject: (e: unknown) => void;
}

interface FailureRecord {
  sceneId: string;
  beat: BeatInput;
  failedAt: string;
}

const _queues = new Map<string, BeatQueueEntry[]>();
const _workerRunning = new Map<string, boolean>();
const _notices = new Map<string, string[]>();

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

export function drainNotices(campaignPath: string): string[] {
  const notices = _notices.get(campaignPath) ?? [];
  _notices.set(campaignPath, []);
  return notices;
}

export async function replayFailures(campaignPath: string): Promise<BeatQueueEntry[]> {
  const sidecar = _sidecarPath(campaignPath);
  if (!fs.existsSync(sidecar)) return [];

  let lines: string[];
  try {
    lines = fs.readFileSync(sidecar, "utf8").trim().split("\n").filter(Boolean);
  } catch (e) {
    process.stderr.write(`[core] beat-queue: could not read sidecar ${sidecar}: ${e}\n`);
    return [];
  }

  const records: FailureRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as FailureRecord);
    } catch {
      process.stderr.write(`[core] beat-queue: skipping malformed failure record: ${JSON.stringify(line.slice(0, 200))}\n`);
    }
  }

  if (records.length === 0) {
    _removeSidecar(campaignPath);
    return [];
  }

  _removeSidecar(campaignPath);

  const entries: BeatQueueEntry[] = [];
  for (const record of records) {
    entries.push(await pushBeat(campaignPath, record.sceneId, record.beat));
  }
  return entries;
}

export async function shutdown(campaignPath: string): Promise<void> {
  const queue = _queues.get(campaignPath);
  if (!queue || queue.length === 0) {
    _queues.delete(campaignPath);
    _workerRunning.delete(campaignPath);
    return;
  }
  const entries = [...queue];
  await Promise.allSettled(entries.map((e) => e.settled));
  _queues.delete(campaignPath);
  _workerRunning.delete(campaignPath);
}

function _ensureWorker(campaignPath: string): void {
  if (_workerRunning.get(campaignPath)) return;
  _workerRunning.set(campaignPath, true);
  _runWorker(campaignPath).catch((err: unknown) => {
    process.stderr.write(`[core] beat-queue: worker crashed unexpectedly for ${campaignPath}: ${err}\n`);
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
    let beatWriteOk = false;
    try {
      entry.beatIndex = await _recordBeat(campaignPath, entry.sceneId, entry.beat);
      beatWriteOk = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const sidecarOk = _appendSidecar(campaignPath, entry);
      const noticeDetail = sidecarOk
        ? "Beat saved to beat-failures.jsonl for replay on next startup."
        : "Sidecar write also failed — beat is permanently lost and will NOT be replayed.";
      _queueNotice(campaignPath, `[core] beat write failed for scene ${entry.sceneId}: ${msg}. ${noticeDetail}`);
      process.stderr.write(`[core] beat-queue: failed to persist beat for scene ${entry.sceneId}: ${msg}\n`);
      entry._reject(e);
      queue.shift();
      continue;
    }

    if (beatWriteOk) {
      // Canon write is a best-effort enrichment step. A failure here must NOT
      // replay the beat (which is already durably stored), so it gets its own
      // isolated try/catch that queues a notice and still resolves the entry.
      const { entities, relations } = entry.beat;
      if ((entities && entities.length > 0) || (relations && relations.length > 0)) {
        try {
          const canon = await _recordBeatCanon(campaignPath, entry.sceneId, entities, relations);
          for (const skip of canon.skipped) {
            _queueNotice(campaignPath, `[core] beat canon skipped: ${skip}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          _queueNotice(
            campaignPath,
            `[core] beat canon write failed for scene ${entry.sceneId}: ${msg}. The beat was saved; its structured canon was not.`,
          );
          process.stderr.write(`[core] beat-queue: canon write failed for scene ${entry.sceneId}: ${msg}\n`);
        }
      }
      entry._resolve();
    }

    queue.shift();
  }

  _workerRunning.set(campaignPath, false);
}

function _queueNotice(campaignPath: string, notice: string): void {
  if (!_notices.has(campaignPath)) {
    _notices.set(campaignPath, []);
  }
  _notices.get(campaignPath)!.push(notice);
}

function _sidecarPath(campaignPath: string): string {
  return path.join(campaignPath, "beat-failures.jsonl");
}

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
    process.stderr.write(`[core] beat-queue: could not write sidecar — beat permanently lost: ${e}\n`);
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
