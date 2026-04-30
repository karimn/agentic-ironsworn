import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadCharacter } from "../state/character.js";
import { searchScenes } from "../rag/scenes.js";
import { listThreads } from "../state/threads.js";

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
  const dbPath = join(campaignPath, "scenes.duckdb");
  const db = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
  const conn = await db.connect();
  try {
    const result = await conn.runAndReadAll(
      "SELECT id, text, timestamp FROM scenes ORDER BY timestamp DESC LIMIT 2",
    );
    return result.getRowObjectsJS() as unknown as RecentScene[];
  } finally {
    conn.closeSync();
    db.closeSync();
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
  const npcsDir = join(campaignPath, "npcs");
  const files = await readdir(npcsDir);

  const combined = allSceneTexts.join(" ").toLowerCase();

  const matched: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const stem = file.slice(0, -3); // remove .md
    const displayName = stem.replace(/-/g, " ");
    if (combined.includes(displayName.toLowerCase())) {
      try {
        const content = await readFile(join(npcsDir, file), "utf-8");
        matched.push(`**${displayName}**\n${content.slice(0, 200)}`);
      } catch {
        // skip unreadable files
      }
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

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
    // omit if no scenes.duckdb or query fails
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
    // omit if no npcs/ dir
  }

  // Open threads
  try {
    const threadSection = await buildThreadsSection(campaignPath);
    if (threadSection) sections.push(threadSection);
  } catch {
    // omit if threads unavailable
  }

  return {
    systemAddendum,
    userPrefix: sections.join("\n\n"),
  };
}
