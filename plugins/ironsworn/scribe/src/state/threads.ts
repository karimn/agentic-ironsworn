import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadKind = "vow" | "threat" | "debt" | "other";
export type ThreadStatus = "open" | "closed";

export interface Thread {
  title: string;
  kind: ThreadKind;
  status: ThreadStatus;
  notes: string;
  openedAt: string;   // ISO timestamp
  closedAt?: string;  // ISO timestamp, only set when closed
  resolution?: string;
}

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function threadsPath(campaignPath: string): string {
  return join(campaignPath, "threads.yaml");
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export async function loadThreads(campaignPath: string): Promise<Thread[]> {
  try {
    const raw = await readFile(threadsPath(campaignPath), "utf-8");
    const parsed = yamlParse(raw);
    return Array.isArray(parsed) ? (parsed as Thread[]) : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function saveThreads(campaignPath: string, threads: Thread[]): Promise<void> {
  await writeFile(threadsPath(campaignPath), yamlStringify(threads), "utf-8");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function openThread(
  campaignPath: string,
  title: string,
  kind: ThreadKind,
  notes?: string,
): Promise<Thread> {
  const threads = await loadThreads(campaignPath);
  const thread: Thread = {
    title,
    kind,
    status: "open",
    notes: notes ?? "",
    openedAt: new Date().toISOString(),
  };
  threads.push(thread);
  await saveThreads(campaignPath, threads);
  return thread;
}

export async function closeThread(
  campaignPath: string,
  title: string,
  resolution: string,
): Promise<Thread> {
  const threads = await loadThreads(campaignPath);
  const idx = threads.findIndex(
    (t) => t.title.toLowerCase() === title.toLowerCase(),
  );
  if (idx === -1) {
    throw new Error(`Thread not found: "${title}"`);
  }
  const thread = threads[idx];
  thread.status = "closed";
  thread.closedAt = new Date().toISOString();
  thread.resolution = resolution;
  await saveThreads(campaignPath, threads);
  return thread;
}

export async function listThreads(
  campaignPath: string,
  status?: ThreadStatus,
): Promise<Thread[]> {
  const threads = await loadThreads(campaignPath);
  if (status === undefined) {
    return threads;
  }
  return threads.filter((t) => t.status === status);
}
