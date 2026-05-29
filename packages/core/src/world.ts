import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorldContext {
  worldRoot: string;     // dir containing world.duckdb + world.json
  campaignId: string;    // active campaign id
  campaignPath: string;  // the campaign folder (for character.json, state-journal.jsonl)
  worldDbPath: string;   // <worldRoot>/world.duckdb
}

export interface EmbeddingPin {
  model: string;
  version: string;
  dim: number;
}

export interface WorldJson {
  schemaVersion: number;
  embedding: EmbeddingPin;
  name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CURRENT_WORLD_SCHEMA_VERSION = 1;

/** Matches the Ollama nomic-embed-text model used by getLoreEmbedding (768-dim). */
export const DEFAULT_EMBEDDING_PIN: EmbeddingPin = {
  model: "nomic-embed-text",
  version: "1.5",
  dim: 768,
};

// ---------------------------------------------------------------------------
// resolveWorldContext
// ---------------------------------------------------------------------------

/**
 * Walk up from `campaignPath` looking for a directory that contains
 * `world.json` or `world.duckdb`. That directory becomes `worldRoot`.
 *
 * Fallback (when no world.json/world.duckdb is found before the filesystem
 * root): if `campaignPath` looks like `.../campaigns/<id>` we use
 * `dirname(dirname(campaignPath))` (one level above "campaigns/") as the world
 * root — the canonical multi-campaign layout from the spec. Otherwise we fall
 * back to `campaignPath` itself (single-campaign legacy/dev case).
 */
export async function resolveWorldContext(campaignPath: string): Promise<WorldContext> {
  // Walk up looking for world.json or world.duckdb
  let worldRoot: string | null = null;
  let current = campaignPath;
  while (true) {
    const parent = dirname(current);
    // Stop at filesystem root
    if (parent === current) break;

    const hasWorldJson = await fileExists(join(current, "world.json"));
    const hasWorldDuckdb = await fileExists(join(current, "world.duckdb"));
    if (hasWorldJson || hasWorldDuckdb) {
      worldRoot = current;
      break;
    }
    current = parent;
  }

  let resolvedWorldRoot: string;
  if (worldRoot === null) {
    // Fallback: canonical layout is <worldRoot>/campaigns/<campaignId>
    const parentDir = dirname(campaignPath);
    const grandparentDir = dirname(parentDir);
    if (basename(parentDir) === "campaigns" && grandparentDir !== parentDir) {
      // Looks like .../campaigns/<id> — use grandparent as world root
      resolvedWorldRoot = grandparentDir;
    } else {
      // Single-campaign legacy/dev case: worldRoot is the campaign folder itself
      resolvedWorldRoot = campaignPath;
    }
  } else {
    resolvedWorldRoot = worldRoot;
  }

  // Determine campaignId: prefer campaign.json { "id": ... }, else use basename
  let campaignId: string;
  try {
    const raw = await readFile(join(campaignPath, "campaign.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    campaignId = typeof parsed["id"] === "string" ? parsed["id"] : basename(campaignPath);
  } catch {
    campaignId = basename(campaignPath);
  }

  return {
    worldRoot: resolvedWorldRoot,
    campaignId,
    campaignPath,
    worldDbPath: join(resolvedWorldRoot, "world.duckdb"),
  };
}

// ---------------------------------------------------------------------------
// world.json helpers
// ---------------------------------------------------------------------------

/** Read and parse `<worldRoot>/world.json`. Returns null on ENOENT. */
export async function loadWorldJson(worldRoot: string): Promise<WorldJson | null> {
  try {
    const raw = await readFile(join(worldRoot, "world.json"), "utf8");
    return JSON.parse(raw) as WorldJson;
  } catch (e: unknown) {
    if (isEnoent(e)) return null;
    throw e;
  }
}

/** Write pretty-printed JSON to `<worldRoot>/world.json`, mkdir -p as needed. */
export async function writeWorldJson(worldRoot: string, data: WorldJson): Promise<void> {
  await mkdir(worldRoot, { recursive: true });
  await writeFile(join(worldRoot, "world.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Guard against silent embedding corruption (spec Decision 3).
 *
 * Throws an actionable Error when `pin` differs from `active` in model,
 * version, or dim. The message names both descriptors and suggests either
 * restoring the original model or running a re-embed migration.
 */
export function assertEmbeddingPin(
  pin: EmbeddingPin,
  active: EmbeddingPin = DEFAULT_EMBEDDING_PIN,
): void {
  const pinStr = `${pin.model} v${pin.version} (${pin.dim}-dim)`;
  const activeStr = `${active.model} v${active.version} (${active.dim}-dim)`;
  if (pin.model !== active.model || pin.version !== active.version || pin.dim !== active.dim) {
    throw new Error(
      `Embedding model mismatch: world.json pin is ${pinStr} but the active embedder is ${activeStr}. ` +
      `To fix: restore the original model (${pin.model} v${pin.version}) or run a re-embed migration ` +
      `to recompute all embeddings with the new model and update the pin.`,
    );
  }
}

/**
 * Ensure `<worldRoot>/world.json` exists with a valid pin.
 *
 * - If absent: creates it with `schemaVersion`, `DEFAULT_EMBEDDING_PIN`, and `name`, then returns it.
 * - If present: returns as-is (does NOT overwrite).
 */
export async function ensureWorldJson(worldRoot: string, name: string): Promise<WorldJson> {
  const existing = await loadWorldJson(worldRoot);
  if (existing !== null) return existing;
  const fresh: WorldJson = {
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    embedding: DEFAULT_EMBEDDING_PIN,
    name,
  };
  await writeWorldJson(worldRoot, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function isEnoent(e: unknown): boolean {
  return (
    e != null &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}
