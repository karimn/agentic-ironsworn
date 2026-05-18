import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { dataSources } from "../../data/sources.js";

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

let _assets: AssetDefinition[] | null = null;

function loadAssets(): AssetDefinition[] {
  const paths = dataSources("assets");
  const seen = new Map<string, string>(); // name → source path
  const all: AssetDefinition[] = [];

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parse(raw) as unknown;
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed as AssetDefinition[]) {
      const key = entry.name?.toLowerCase() ?? "";
      if (seen.has(key)) {
        throw new Error(
          `[scribe] asset name collision: "${entry.name}" appears in both "${seen.get(key)}" and "${filePath}"`,
        );
      }
      seen.set(key, filePath);
      all.push(entry);
    }
  }
  return all;
}

function getAssets(): AssetDefinition[] {
  if (_assets === null) {
    _assets = loadAssets();
  }
  return _assets;
}

export function resetAssetsCache(): void {
  _assets = null;
}

// ---------------------------------------------------------------------------
// lookupAsset
// ---------------------------------------------------------------------------

export function lookupAsset(name: string): AssetDefinition | undefined {
  const needle = name.toLowerCase();
  return getAssets().find((a) => a.name.toLowerCase() === needle);
}
