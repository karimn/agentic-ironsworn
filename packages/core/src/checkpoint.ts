import { checkpointLore } from "./rag/lore.js";
import { checkpointScenes } from "./rag/scenes.js";

const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
const CHECKPOINT_EVERY_N_WRITES = 20;

let writesSinceCheckpoint = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

async function flush(reason: string, campaignPath: string): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    await Promise.all([
      checkpointLore(campaignPath),
      checkpointScenes(campaignPath),
    ]);
    writesSinceCheckpoint = 0;
    process.stderr.write(`[core] checkpoint complete (${reason})\n`);
  } catch (e) {
    process.stderr.write(`[core] checkpoint failed (${reason}): ${e}\n`);
  } finally {
    flushing = false;
  }
}

export function startPeriodicCheckpoint(campaignPath: string): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    if (writesSinceCheckpoint > 0) {
      void flush("interval", campaignPath);
    }
  }, CHECKPOINT_INTERVAL_MS);
  timer.unref();
}

export function recordMutation(campaignPath: string): void {
  writesSinceCheckpoint++;
  if (writesSinceCheckpoint >= CHECKPOINT_EVERY_N_WRITES) {
    void flush("write-threshold", campaignPath);
  }
}
