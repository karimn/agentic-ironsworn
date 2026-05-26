import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildSceneWarnings, register } from "./narrative.js";
import { upsertNpc, getNpc } from "../state/npcs.js";
import { upsertLore, getLore } from "../rag/lore.js";
import { recordScene, getScene } from "../rag/scenes.js";

let _ollamaReady: boolean | null = null;
async function ollamaAvailable(): Promise<boolean> {
  if (_ollamaReady !== null) return _ollamaReady;
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    _ollamaReady = res.ok;
  } catch {
    _ollamaReady = false;
  }
  return _ollamaReady;
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-narrative-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("buildSceneWarnings", () => {
  it("returns generic reminder when no params provided", async () => {
    const result = await buildSceneWarnings(campaignDir, undefined, undefined);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Reminder:");
    expect(result.warnings[0]).toContain("upsert_npc");
    expect(result.warnings[0]).toContain("upsert_lore");
    expect(result.stubbed.npcs).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("returns no warnings when all NPCs are found", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const result = await buildSceneWarnings(campaignDir, ["Kira"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toHaveLength(0);
  });

  it("auto-stubs missing NPC and returns stubbed list instead of warning", async () => {
    const result = await buildSceneWarnings(campaignDir, ["Saelin"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Saelin"]);
    // Verify the stub was actually created
    const npc = await getNpc(campaignDir, "Saelin");
    expect(npc).not.toBeNull();
  });

  it("stubs only missing NPCs; already-registered NPCs pass through silently", async () => {
    await upsertNpc(campaignDir, "Kira", "A fierce warrior.", "Trustworthy");
    const result = await buildSceneWarnings(campaignDir, ["Kira", "Ghost"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    // Kira's record is untouched (still has description)
    const kira = await getNpc(campaignDir, "Kira");
    expect(kira).toContain("A fierce warrior.");
    // Ghost stub was created
    const ghost = await getNpc(campaignDir, "Ghost");
    expect(ghost).not.toBeNull();
  });

  it("stubs multiple missing NPCs in one call", async () => {
    const result = await buildSceneWarnings(campaignDir, ["Saelin", "Mara", "Thord"], undefined);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Saelin", "Mara", "Thord"]);
    for (const name of ["Saelin", "Mara", "Thord"]) {
      const npc = await getNpc(campaignDir, name);
      expect(npc).not.toBeNull();
    }
  });

  it("auto-stubs missing lore entity when Ollama is available", async () => {
    if (!(await ollamaAvailable())) return;
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.lore).toEqual(["lost-vale"]);
    // Verify stub exists in the lore db
    const entity = await getLore(campaignDir, "lost-vale");
    expect(entity).not.toBeNull();
    expect(entity!.canonical).toBe("lost-vale");
  });

  it("falls back to warning for missing lore when Ollama is unavailable", async () => {
    if (await ollamaAvailable()) return; // skip if Ollama is running
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.stubbed.lore).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("lost-vale");
    expect(result.warnings[0]).toContain("upsert_lore");
  });

  it("returns no warnings for present lore entity", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Lost Vale",
      type: "place",
      summary: "A hidden valley shrouded in mist.",
    });
    const result = await buildSceneWarnings(campaignDir, undefined, ["lost-vale"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("stubs both missing NPC and missing lore when Ollama is available", async () => {
    if (!(await ollamaAvailable())) return;
    const result = await buildSceneWarnings(campaignDir, ["Ghost"], ["unknown-place"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    expect(result.stubbed.lore).toEqual(["unknown-place"]);
  });

  it("falls back to warning for missing lore but stubs NPC when Ollama is unavailable", async () => {
    if (await ollamaAvailable()) return; // skip if Ollama is running
    const result = await buildSceneWarnings(campaignDir, ["Ghost"], ["unknown-place"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown-place");
    expect(result.stubbed.npcs).toEqual(["Ghost"]);
    expect(result.stubbed.lore).toHaveLength(0);
  });

  it("empty arrays produce no warnings and no stubs", async () => {
    const result = await buildSceneWarnings(campaignDir, [], []);
    expect(result.warnings).toHaveLength(0);
    expect(result.stubbed.npcs).toHaveLength(0);
    expect(result.stubbed.lore).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// record_beat tool
// ---------------------------------------------------------------------------

describe("record_beat tool", () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    register(server, campaignDir);
    client = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it("happy path: queues a beat and returns queued:true (fire-and-forget)", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(campaignDir, "An ambush at the forest edge.", "combat");

    const result = await client.callTool({
      name: "record_beat",
      arguments: { scene_id: sceneId, kind: "narration", text: "Arrows fly from the shadows." },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.queued).toBe(true);
  });

  it("wait=true blocks until beat is persisted and returns the real beat_index", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(campaignDir, "An ambush at the forest edge.", "combat");

    const result = await client.callTool({
      name: "record_beat",
      arguments: { scene_id: sceneId, kind: "narration", text: "Arrows fly from the shadows.", wait: true },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
    expect(parsed.beat_index).toBe(0);
  });

  it("sequential wait=true calls return incrementing indices", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(campaignDir, "A social encounter.", "social");

    const r1 = await client.callTool({ name: "record_beat", arguments: { scene_id: sceneId, kind: "narration", text: "The fire crackles.", wait: true } });
    const r2 = await client.callTool({ name: "record_beat", arguments: { scene_id: sceneId, kind: "dialogue", speaker: "Kira", text: "You came back.", wait: true } });

    expect(r1.isError).not.toBe(true);
    expect(r2.isError).not.toBe(true);
    const p1 = JSON.parse((r1.content as Array<{ type: string; text: string }>)[0].text);
    const p2 = JSON.parse((r2.content as Array<{ type: string; text: string }>)[0].text);
    expect(p1.beat_index).toBe(0);
    expect(p2.beat_index).toBe(1);
  });

  it("beat is persisted — wait=true then getScene shows the beat", async () => {
    if (!(await ollamaAvailable())) return;
    const sceneId = await recordScene(campaignDir, "A brief exploration.", "exploration");

    await client.callTool({
      name: "record_beat",
      arguments: { scene_id: sceneId, kind: "oracle", text: "The oracle whispers: fire and shadow.", wait: true },
    });

    const scene = await getScene(campaignDir, sceneId, { include_beats: true });
    expect(scene).not.toBeNull();
    expect(scene!.beats).toHaveLength(1);
    expect(scene!.beats![0]!.text).toContain("fire and shadow");
  });

  it("invalid scene_id returns an error", async () => {
    if (!(await ollamaAvailable())) return;
    // Initialize the DB
    await recordScene(campaignDir, "Placeholder to init DB.");

    const result = await client.callTool({
      name: "record_beat",
      arguments: { scene_id: "non-existent-id", kind: "narration", text: "Should fail." },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("non-existent-id");
  });
});
