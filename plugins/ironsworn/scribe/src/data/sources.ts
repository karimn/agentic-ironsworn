import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getActiveExpansions, type LoadedExpansion } from "../expansions/loader.js";

function corePluginRoot(): string {
  const pluginRoot = process.env["SCRIBE_PLUGIN_ROOT"];
  if (pluginRoot) return pluginRoot;
  // Dev fallback: src/data/ is 3 levels below plugin root (data→src→scribe→plugin)
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function dataSourcesFromExpansions(
  dataset: "moves" | "oracles" | "assets",
  expansions: LoadedExpansion[],
): string[] {
  const corePath = join(corePluginRoot(), "data", `${dataset}.yaml`);
  const paths = [corePath];

  for (const expansion of expansions) {
    if (!expansion.manifest.contributes.data?.includes(dataset)) continue;
    paths.push(join(expansion.installPath, "data", `${dataset}.yaml`));
  }

  return paths;
}

export function dataSources(dataset: "moves" | "oracles" | "assets"): string[] {
  return dataSourcesFromExpansions(dataset, getActiveExpansions());
}
