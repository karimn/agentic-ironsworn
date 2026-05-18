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

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(s: string): [number, number, number] | null {
  const m = s.match(SEMVER_RE);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

function satisfiesCompat(running: string, range: string | undefined): boolean {
  if (!range) return true;
  const m = range.match(/^>=(\d+\.\d+\.\d+)$/);
  if (!m) {
    // Unrecognised range format — skip the expansion rather than silently passing it.
    process.stderr.write(`[scribe] unrecognised ironswornCompat range "${range}" — skipping expansion\n`);
    return false;
  }
  const cmp = compareSemver(running, m[1]!);
  if (cmp === null) {
    process.stderr.write(`[scribe] could not parse semver "${running}" or "${m[1]}" — skipping expansion\n`);
    return false;
  }
  return cmp >= 0;
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

// Returns the expansion list cached by the most recent loadExpansions() call.
// Always returns [] until loadExpansions() has run — server.ts calls it at
// startup before any tool executes, so data loaders (moves/oracles/assets)
// and buildContext will see the full list when handling actual requests.
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
