import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadCharacter, saveCharacter, appendJournal, type Character } from "../state/character.js";
import { roll } from "../rules/dice.js";
import { getLoreDb } from "../rag/lore-db.js";
import { runDbMigrations, runCharacterMigrations, type DbMigration, type CharacterMigration } from "../migrations/index.js";

export type { DbMigration, CharacterMigration };

export interface ExpansionManifest {
  name: string;
  version: string;
  ironswornCompat?: string;
  contributes: {
    data?: ("moves" | "oracles" | "assets")[];
    server?: boolean;
    context?: boolean;
    skills?: string[];
  };
  agentBriefing?: string;
}

export interface ExpansionContext {
  campaignPath: string;
  loadCharacter(campaignPath: string): Promise<Character>;
  saveCharacter(campaignPath: string, char: Character): Promise<void>;
  appendJournal: typeof appendJournal;
  roll(notation: string): { rolls: number[]; total: number };
  getLoreDb: typeof getLoreDb;
  runDbMigrations(conn: unknown, migrations: DbMigration[]): Promise<void>;
  runCharacterMigrations: typeof runCharacterMigrations;
}

export interface ExpansionModule {
  register(server: McpServer, ctx: ExpansionContext): void | Promise<void>;
}

export interface LoadedExpansion {
  name: string;
  manifest: ExpansionManifest;
  installPath: string;
}

let _active: LoadedExpansion[] | null = null;

export function installedPluginsPath(): string {
  return (
    process.env["SCRIBE_PLUGINS_JSON"] ??
    join(homedir(), ".claude", "plugins", "installed_plugins.json")
  );
}

function getPluginVersion(): string {
  const pluginRoot = process.env["SCRIBE_PLUGIN_ROOT"];
  if (!pluginRoot) return "0.0.0";
  try {
    const json = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8"),
    ) as { version?: string };
    return json.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function compareSemver(a: string, b: string): number {
  const p = (s: string) => s.split(".").map(Number) as [number, number, number];
  const [aM, am, ap] = p(a);
  const [bM, bm, bp] = p(b);
  return aM - bM || am - bm || ap - bp;
}

function satisfiesCompat(running: string, range: string | undefined): boolean {
  if (!range) return true;
  const m = range.match(/^>=(\d+\.\d+\.\d+)$/);
  if (!m) return true;
  return compareSemver(running, m[1]) >= 0;
}

export async function discoverExpansions(): Promise<LoadedExpansion[]> {
  const enabled = new Set(
    (process.env["SCRIBE_EXPANSIONS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (enabled.size === 0) return [];

  const jsonPath = installedPluginsPath();
  if (!existsSync(jsonPath)) return [];

  let parsed: { plugins: Record<string, Array<{ installPath?: string }>> };
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf-8")) as typeof parsed;
  } catch {
    return [];
  }

  const runningVersion = getPluginVersion();
  const result: LoadedExpansion[] = [];

  for (const [key, entries] of Object.entries(parsed.plugins ?? {})) {
    const pluginName = key.split("@")[0] ?? "";
    if (!pluginName.startsWith("ironsworn-")) continue;
    const expansionName = pluginName.slice("ironsworn-".length);
    if (!enabled.has(expansionName)) continue;

    const installPath = entries[0]?.installPath;
    if (!installPath) continue;

    const manifestPath = join(installPath, "expansion.json");
    if (!existsSync(manifestPath)) {
      process.stderr.write(`[scribe] expansion ${expansionName}: no expansion.json at ${installPath}\n`);
      continue;
    }

    let manifest: ExpansionManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ExpansionManifest;
    } catch {
      process.stderr.write(`[scribe] expansion ${expansionName}: failed to parse expansion.json\n`);
      continue;
    }

    if (!satisfiesCompat(runningVersion, manifest.ironswornCompat)) {
      process.stderr.write(
        `[scribe] expansion ${expansionName} requires ironsworn ${manifest.ironswornCompat ?? "any"} (running ${runningVersion}) — skipping\n`,
      );
      continue;
    }

    result.push({ name: expansionName, manifest, installPath });
  }

  return result;
}

export function getActiveExpansions(): LoadedExpansion[] {
  return _active ?? [];
}

export async function loadExpansions(
  server: McpServer,
  campaignPath: string,
): Promise<LoadedExpansion[]> {
  const expansions = await discoverExpansions();
  _active = expansions;

  for (const expansion of expansions) {
    if (!expansion.manifest.contributes.server) continue;
    const indexPath = join(expansion.installPath, "server", "index.ts");
    if (!existsSync(indexPath)) {
      process.stderr.write(`[scribe] expansion ${expansion.name}: contributes.server=true but no server/index.ts\n`);
      continue;
    }
    try {
      const mod = (await import(indexPath)) as ExpansionModule;
      const ctx: ExpansionContext = {
        campaignPath,
        loadCharacter,
        saveCharacter,
        appendJournal,
        roll,
        getLoreDb,
        runDbMigrations: runDbMigrations as ExpansionContext["runDbMigrations"],
        runCharacterMigrations,
      };
      await mod.register(server, ctx);
      process.stderr.write(`[scribe] loaded expansion: ${expansion.name} v${expansion.manifest.version}\n`);
    } catch (e) {
      process.stderr.write(`[scribe] expansion ${expansion.name}: failed to load server — ${e}\n`);
    }
  }

  return expansions;
}
