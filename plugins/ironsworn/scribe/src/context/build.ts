import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadCharacter } from "../state/character.js";
import {
  searchScenes,
  getRecentScenesChronological,
  listNpcs,
  listOpenContradictions,
  type OpenContradiction,
} from "@agentic-rpg/core";
import { listThreads } from "../state/threads.js";
import { getActiveExpansions, type LoadedExpansion } from "../expansions/loader.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuiltContext {
  systemAddendum: string; // appended to system prompt (cached)
  userPrefix: string;     // prepended to each user message turn
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

interface RecentScene {
  id: string;
  text: string;
  timestamp: string;
}

async function getRecentScenes(campaignPath: string): Promise<RecentScene[]> {
  // NOTE: Scenes now live in world.duckdb (not scenes.duckdb). Use the core SDK function.
  try {
    return await getRecentScenesChronological(campaignPath, 2);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

async function buildCharacterSection(campaignPath: string): Promise<string> {
  const char = await loadCharacter(campaignPath);
  const digest = {
    name: char.name,
    stats: char.stats,
    momentum: char.momentum,
    health: char.health,
    spirit: char.spirit,
    supply: char.supply,
    debilities: Object.fromEntries(
      Object.entries(char.debilities).filter(([, v]) => v),
    ),
    bonds: char.bonds,
  };
  return `## Character State\n${JSON.stringify(digest, null, 2)}`;
}

function buildRecentScenesSection(
  scenes: RecentScene[],
): { section: string; ids: Set<string> } {
  if (scenes.length === 0) {
    return { section: "", ids: new Set() };
  }
  const ids = new Set(scenes.map((s) => s.id));
  const texts = scenes.map((s) => s.text).join("\n\n---\n\n");
  return { section: `## Recent Scenes\n${texts}`, ids };
}

async function buildRagScenesSection(
  campaignPath: string,
  userInput: string,
  recentIds: Set<string>,
): Promise<{ section: string; sceneTexts: string[] }> {
  const scenes = await searchScenes(campaignPath, userInput, 3);
  const deduped = scenes.filter((s) => !recentIds.has(s.id));
  if (deduped.length === 0) {
    return { section: "", sceneTexts: [] };
  }
  const texts = deduped.map((s) => s.text);
  const joined = texts.join("\n\n---\n\n");
  return { section: `## Relevant Past Scenes\n${joined}`, sceneTexts: texts };
}

async function buildActiveNpcsSection(
  campaignPath: string,
  allSceneTexts: string[],
): Promise<string> {
  // NOTE: NPCs now live in world.duckdb as entities(type='person').
  // Use listNpcs which returns { filename -> markdown } with # Name headings.
  let npcFiles: Record<string, string>;
  try {
    npcFiles = await listNpcs(campaignPath);
  } catch {
    return "";
  }

  const combined = allSceneTexts.join(" ").toLowerCase();

  const matched: string[] = [];
  for (const [filename, content] of Object.entries(npcFiles)) {
    // Extract display name from the # Name heading (same as session_briefing does)
    const nameMatch = content.match(/^# (.+)$/m);
    const displayName = nameMatch ? nameMatch[1]! : filename.replace(/\.md$/, "").replace(/-/g, " ");
    if (combined.includes(displayName.toLowerCase())) {
      matched.push(`**${displayName}**\n${content.slice(0, 200)}`);
    }
  }

  if (matched.length === 0) return "";
  return `## Active NPCs\n${matched.join("\n\n")}`;
}

async function buildThreadsSection(campaignPath: string): Promise<string> {
  const threads = await listThreads(campaignPath, "open");
  const top5 = threads.slice(0, 5);
  if (top5.length === 0) return "";
  const items = top5
    .map((t) => `**${t.title}**\n${t.notes}`)
    .join("\n\n");
  return `## Open Threads\n${items}`;
}

const CONTRADICTION_CAP = 5;
const CONTRADICTION_VALUE_MAX = 120;

function truncateValue(value: string, max = CONTRADICTION_VALUE_MAX): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function formatContradiction(item: OpenContradiction): string {
  const existing = truncateValue(item.existing_value);
  const incoming = truncateValue(item.incoming_value);
  if (item.kind === "relation_label_conflict") {
    const pair = item.names.length >= 2 ? item.names.join(" → ") : item.names[0] ?? "an entity";
    return `- **${pair}** — established \`${existing}\`, but a newer claim says \`${incoming}\``;
  }
  const subject = item.names[0] ?? "An entity";
  return `- **${subject}** — canon says “${existing}”, but a recent claim says “${incoming}”`;
}

/**
 * Render open contradictions as a capped, scene-prioritized GM context section.
 * Contradictions whose named entities appear in recent scene text float to the
 * top (so what's on stage surfaces first); the rest keep newest-first order.
 * Pure so cap/relevance/format are testable without a DB.
 */
export function buildContradictionsSection(
  items: OpenContradiction[],
  sceneTexts: string[],
  cap = CONTRADICTION_CAP,
): string {
  if (items.length === 0) return "";

  const haystack = sceneTexts.join(" ").toLowerCase();
  const isRelevant = (item: OpenContradiction): boolean =>
    item.names.some((name) => name.length > 0 && haystack.includes(name.toLowerCase()));

  // Stable: scene-relevant first, otherwise preserve the incoming (newest-first) order.
  const ordered = items
    .map((item, index) => ({ item, index, relevant: isRelevant(item) }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.index - b.index)
    .map((entry) => entry.item);

  const top = ordered.slice(0, cap);
  const bullets = top.map(formatContradiction).join("\n");
  const omitted = ordered.length - top.length;
  const footer = omitted > 0
    ? `\n\n_(+${omitted} more open — call \`list_contradictions\` for the full queue.)_`
    : "";

  return (
    "## Open Contradictions\n" +
    "These facts conflict in the world record. Reconcile them in the fiction — " +
    "choose a truth, weave the tension into the scene, or call `resolve_contradiction` " +
    "once settled. Don't narrate over them.\n" +
    bullets +
    footer
  );
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

export async function buildExpansionSections(
  campaignPath: string,
  expansions: LoadedExpansion[],
): Promise<string> {
  const sections: string[] = [];

  for (const expansion of expansions) {
    if (!expansion.manifest.contributes.context) continue;
    if (expansion.manifest.agentBriefing) {
      sections.push(`## Active Expansion: ${expansion.name}\n${expansion.manifest.agentBriefing}`);
    }
    const sectionPath = join(expansion.installPath, "context", "section.ts");
    if (!existsSync(sectionPath)) continue;
    try {
      const mod = (await import(sectionPath)) as { buildSection(campaignPath: string): Promise<string> };
      const text = await mod.buildSection(campaignPath);
      if (text) sections.push(text);
    } catch {
      // omit on failure — consistent with all other buildContext sections
    }
  }

  return sections.join("\n\n");
}

export async function buildContext(
  campaignPath: string,
  userInput: string,
): Promise<BuiltContext> {
  // ---- systemAddendum ----
  const [characterVoice, style] = await Promise.all([
    readFileOrEmpty(join(campaignPath, "character-voice.md")),
    readFileOrEmpty(join(campaignPath, "style.md")),
  ]);
  const systemAddendum = [characterVoice, style].filter(Boolean).join("\n\n");

  // ---- userPrefix sections ----
  const sections: string[] = [];

  // Character state
  try {
    sections.push(await buildCharacterSection(campaignPath));
  } catch {
    // omit if character unavailable
  }

  // Recent scenes + RAG scenes (need recent IDs for dedup)
  let recentIds = new Set<string>();
  let allSceneTexts: string[] = [];

  try {
    const recentRows = await getRecentScenes(campaignPath);
    const { section, ids } = buildRecentScenesSection(recentRows);
    recentIds = ids;
    allSceneTexts.push(...recentRows.map((s) => s.text));
    if (section) sections.push(section);
  } catch {
    // omit if no world.duckdb or query fails
  }

  try {
    const { section, sceneTexts } = await buildRagScenesSection(
      campaignPath,
      userInput,
      recentIds,
    );
    allSceneTexts.push(...sceneTexts);
    if (section) sections.push(section);
  } catch {
    // omit if Ollama unavailable or other error
  }

  // Active NPCs
  try {
    const npcSection = await buildActiveNpcsSection(campaignPath, allSceneTexts);
    if (npcSection) sections.push(npcSection);
  } catch {
    // omit if entity store unavailable
  }

  // Open threads
  try {
    const threadSection = await buildThreadsSection(campaignPath);
    if (threadSection) sections.push(threadSection);
  } catch {
    // omit if threads unavailable
  }

  // Open contradictions — surface unresolved world-record conflicts into play
  try {
    const contradictions = await listOpenContradictions(campaignPath);
    const section = buildContradictionsSection(contradictions, allSceneTexts);
    if (section) sections.push(section);
  } catch {
    // omit if contradictions store unavailable (e.g. no world.duckdb yet)
  }

  // Expansion context sections
  try {
    const expansionSection = await buildExpansionSections(campaignPath, getActiveExpansions());
    if (expansionSection) sections.push(expansionSection);
  } catch {
    // omit if expansion context fails
  }

  return {
    systemAddendum,
    userPrefix: sections.join("\n\n"),
  };
}
