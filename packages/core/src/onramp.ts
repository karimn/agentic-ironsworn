import { readFile } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// New-campaign-in-existing-world onramp (FW3, #198)
//
// The data layer (world.ts's resolveWorldContext, the campaign_id visibility
// filter) already supports a fresh sibling campaign inheriting world canon
// without touching a prior campaign's private overlay. What was missing was
// a *fiction workflow* for actually creating that sibling campaign — this
// module is the pure, testable half of that: detecting whether a directory
// is already inside an established world, and computing where a new
// sibling campaign's data folder should live and how a session opened at
// some cwd reaches it. `ironsworn-init.sh` implements the same walk-up /
// slugify / relative-path semantics natively in bash (so it has no runtime
// dependency on bun workspace linking just to answer "does world.json exist
// somewhere above me") — this module is the tested spec for that algorithm,
// and is available to any TS caller that wants it directly.
// ---------------------------------------------------------------------------

export interface WorldRootDetection {
  worldRoot: string;
  matchedFile: "world.json" | "world.duckdb";
  /** True when the match was `startDir` itself, false when it was a strict ancestor. */
  isSelf: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk upward from `startDir` (inclusive) looking for `world.json` or
 * `world.duckdb`, mirroring `resolveWorldContext`'s walk-up in `world.ts`.
 * Bounded by `maxLevels` so a deeply nested or symlink-looped tree can't
 * hang the caller. Returns `null` when nothing is found before the bound
 * (or the filesystem root) is reached.
 */
export async function findEnclosingWorldRoot(
  startDir: string,
  maxLevels = 25,
): Promise<WorldRootDetection | null> {
  const start = resolve(startDir);
  let current = start;
  for (let level = 0; level <= maxLevels; level++) {
    const hasWorldJson = await fileExists(join(current, "world.json"));
    const hasWorldDuckdb = await fileExists(join(current, "world.duckdb"));
    if (hasWorldJson || hasWorldDuckdb) {
      return {
        worldRoot: current,
        matchedFile: hasWorldJson ? "world.json" : "world.duckdb",
        isSelf: current === start,
      };
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return null;
}

/**
 * Slugify free text into a filesystem/campaign-id-safe slug: lowercase,
 * non-alphanumeric runs collapsed to a single `-`, no leading/trailing
 * dashes. Falls back to `"campaign"` when the input has no alphanumerics
 * at all (so a blank or purely-symbolic directory name never produces an
 * empty or invalid id).
 */
export function slugifyCampaignId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "campaign";
}

/** Title-case a slug for a human-readable default campaign name, e.g. `"iron-sandbox"` -> `"Iron Sandbox"`. */
export function titleCaseFromSlug(slug: string): string {
  const words = slug.split("-").filter((w) => w.length > 0);
  if (words.length === 0) return "New Campaign";
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

export interface CampaignOnrampPlan {
  worldRoot: string;
  campaignId: string;
  /** Absolute path to the new campaign's data folder: `<worldRoot>/campaigns/<campaignId>`. */
  campaignDir: string;
  /**
   * The value a session opened at `cwd` needs for `SCRIBE_CAMPAIGN` to reach
   * `campaignDir` — relative to `cwd`, or `"."` when `cwd` already IS the
   * campaign dir (the common case when the user mkdir'd
   * `<worldRoot>/campaigns/<id>` themselves and cd'd into it before running
   * ironsworn-init).
   */
  scribeCampaignValue: string;
}

/**
 * Compute where a new sibling campaign's data folder lives under an
 * existing world root, and what `SCRIBE_CAMPAIGN` value a session opened at
 * `cwd` needs to reach it. Pure — no fs access — so the path arithmetic is
 * unit-testable without fixtures. Never touches `world.json`/`world.duckdb`
 * at `worldRoot`, and never writes anything at `cwd` — the caller decides
 * what to scaffold from this plan.
 */
export function planCampaignOnramp(opts: {
  cwd: string;
  worldRoot: string;
  campaignId: string;
}): CampaignOnrampPlan {
  const worldRoot = resolve(opts.worldRoot);
  const cwd = resolve(opts.cwd);
  const campaignDir = join(worldRoot, "campaigns", opts.campaignId);
  const rel = relative(cwd, campaignDir);
  return {
    worldRoot,
    campaignId: opts.campaignId,
    campaignDir,
    scribeCampaignValue: rel === "" ? "." : rel,
  };
}

export type InitMode =
  | { kind: "fresh-world" }
  | { kind: "new-campaign"; worldRoot: string; auto: boolean };

/**
 * Decide which `ironsworn-init` flow applies.
 *
 * - `explicitWorldRoot` set (the `--in-world` flag) → always `"new-campaign"`
 *   (`auto: false`); the caller is expected to have already validated that
 *   the path actually contains `world.json`/`world.duckdb`.
 * - No explicit path, and nothing found walking up from cwd → `"fresh-world"`.
 * - No explicit path, found at cwd itself (`isSelf`) → `"fresh-world"` — cwd
 *   already IS a world root, so this is the existing idempotent re-run
 *   behavior, not a new sibling campaign.
 * - No explicit path, found at a strict ancestor → `"new-campaign"`
 *   (`auto: true`) — cwd is nested inside an established world (e.g. the
 *   user mkdir'd `campaigns/<id>` under an existing world root and cd'd in).
 */
export function decideInitMode(opts: {
  explicitWorldRoot?: string;
  detection: WorldRootDetection | null;
}): InitMode {
  if (opts.explicitWorldRoot !== undefined) {
    return { kind: "new-campaign", worldRoot: resolve(opts.explicitWorldRoot), auto: false };
  }
  if (opts.detection === null || opts.detection.isSelf) {
    return { kind: "fresh-world" };
  }
  return { kind: "new-campaign", worldRoot: opts.detection.worldRoot, auto: true };
}
