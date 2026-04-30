import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetType = "combat_talent" | "companion" | "path" | "ritual";

export interface AssetAbility {
  name?: string;
  text: string;
  default: boolean;
}

export interface AssetDefinition {
  name: string;
  type: AssetType;
  requires?: string;
  health?: number; // companions only
  abilities: AssetAbility[];
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

// Prefer SCRIBE_PLUGIN_ROOT when running inside a Claude Code plugin install.
// Fall back to walking up from source when running out of the dev tree so
// `bun test` and `bun run` keep working with zero config.
function resolveAssetsPath(): string {
  const pluginRoot = process.env.SCRIBE_PLUGIN_ROOT;
  if (pluginRoot) {
    return resolve(pluginRoot, "data", "assets.yaml");
  }
  // scribe/src/rules/ironsworn/ → scribe/src/rules/ → scribe/src/ → scribe/ → plugin root
  const pluginRootFallback = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return resolve(pluginRootFallback, "data", "assets.yaml");
}

let _assets: AssetDefinition[] | null = null;

function loadAssets(): AssetDefinition[] {
  if (!existsSync(resolveAssetsPath())) {
    return [];
  }
  const raw = readFileSync(resolveAssetsPath(), "utf-8");
  const parsed = parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as AssetDefinition[];
}

function getAssets(): AssetDefinition[] {
  if (_assets === null) {
    _assets = loadAssets();
  }
  return _assets;
}

// ---------------------------------------------------------------------------
// lookupAsset
// ---------------------------------------------------------------------------

export function lookupAsset(name: string): AssetDefinition | undefined {
  const needle = name.toLowerCase();
  return getAssets().find((a) => a.name.toLowerCase() === needle);
}
