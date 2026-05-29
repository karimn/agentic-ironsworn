import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { register } from "./campaign.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseText<T = unknown>(result: unknown): T {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(content[0]!.text) as T;
}

const BASE_CHARACTER = {
  name: "Kara",
  stats: { edge: 2, heart: 3, iron: 1, shadow: 2, wits: 3 },
  momentum: 2,
  momentumReset: 2,
  health: 4,
  spirit: 3,
  supply: 3,
  debilities: {},
  assets: [],
  progressTracks: [],
  companions: [],
  bonds: 0,
  experience: 0,
  customState: {},
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let campaignDir: string;
let exportDir: string;
let client: Client;
let server: McpServer;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-campaign-test-"));
  exportDir = await mkdtemp(join(tmpdir(), "scribe-campaign-export-"));

  server = new McpServer({ name: "test", version: "0.0.1" });
  register(server, campaignDir);

  client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
  await rm(exportDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkpoint_now
// ---------------------------------------------------------------------------

describe("checkpoint_now", () => {
  it("returns ok:true when no DB has been opened (no-op checkpoints)", async () => {
    const result = await client.callTool({ name: "checkpoint_now", arguments: {} });
    expect(result.isError).not.toBe(true);
    const parsed = parseText<{ ok: boolean; message: string }>(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toMatch(/checkpoint/i);
  });
});

// ---------------------------------------------------------------------------
// export_campaign
// ---------------------------------------------------------------------------

describe("export_campaign", () => {
  it("creates a valid JSON export file with correct structure", async () => {
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(BASE_CHARACTER));
    const outputPath = join(exportDir, "export.json");

    const result = await client.callTool({
      name: "export_campaign",
      arguments: { output_path: outputPath },
    });
    expect(result.isError).not.toBe(true);

    const summary = parseText<{
      ok: boolean;
      output_path: string;
      counts: Record<string, number>;
    }>(result);
    expect(summary.ok).toBe(true);
    expect(summary.output_path).toBe(outputPath);
    expect(typeof summary.counts.lore_entities).toBe("number");
    expect(typeof summary.counts.scenes).toBe("number");

    const raw = await readFile(outputPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    expect(data["version"]).toBe(2);
    expect(typeof data["exported_at"]).toBe("string");
    expect(data["character"]).toMatchObject({ name: "Kara" });
    expect(Array.isArray(data["threads"])).toBe(true);
    expect(typeof data["npcs"]).toBe("object");
    expect(Array.isArray(data["lore_entities"])).toBe(true);
    expect(Array.isArray(data["lore_relations"])).toBe(true);
    expect(Array.isArray(data["scenes"])).toBe(true);
  });

  it("world-pack mode (include_scenes=false) produces empty scenes array", async () => {
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(BASE_CHARACTER));
    const outputPath = join(exportDir, "worldpack.json");

    const result = await client.callTool({
      name: "export_campaign",
      arguments: { output_path: outputPath, include_scenes: false },
    });
    expect(result.isError).not.toBe(true);

    const raw = await readFile(outputPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    expect(data["scenes"]).toEqual([]);
    expect(parseText<{ counts: Record<string, number> }>(result).counts.scenes).toBe(0);
  });

  it("exports NPCs from the entity store", async () => {
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(BASE_CHARACTER));
    // Use writeNpcRaw (which parses markdown and upserts an entity) to seed the NPC
    const { writeNpcRaw } = await import("@agentic-rpg/core");
    await writeNpcRaw(campaignDir, "aldric.md", "# Aldric\nA blacksmith.");

    const outputPath = join(exportDir, "export-npcs.json");
    await client.callTool({ name: "export_campaign", arguments: { output_path: outputPath } });

    const raw = await readFile(outputPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const npcs = data["npcs"] as Record<string, string>;
    // The exported NPC should have the Aldric heading in its markdown content
    const aldricEntry = Object.values(npcs).find((v) => v.includes("# Aldric"));
    expect(aldricEntry).toBeDefined();
    expect(aldricEntry!).toContain("# Aldric");
  });

  it("succeeds even when character.json is absent (exports null character)", async () => {
    const outputPath = join(exportDir, "no-char.json");

    const result = await client.callTool({
      name: "export_campaign",
      arguments: { output_path: outputPath },
    });
    expect(result.isError).not.toBe(true);

    const raw = await readFile(outputPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    expect(data["character"]).toBeNull();
  });

  it("creates intermediate directories for the output path", async () => {
    const outputPath = join(exportDir, "nested", "deep", "export.json");

    const result = await client.callTool({
      name: "export_campaign",
      arguments: { output_path: outputPath },
    });
    expect(result.isError).not.toBe(true);
    await expect(readFile(outputPath, "utf-8")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// import_campaign
// ---------------------------------------------------------------------------

describe("import_campaign", () => {
  it("returns an error for unsupported export versions", async () => {
    const badExport = { version: 99, character: null, threads: [], npcs: {}, lore_entities: [], lore_relations: [], lore_proximity: [], scenes: [] };
    const inputPath = join(exportDir, "bad-version.json");
    await writeFile(inputPath, JSON.stringify(badExport));

    const result = await client.callTool({
      name: "import_campaign",
      arguments: { input_path: inputPath },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/unsupported export version/i);
  });

  it("imports character from a valid export", async () => {
    const exportPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      character: BASE_CHARACTER,
      threads: [],
      npcs: {},
      lore_entities: [],
      lore_relations: [],
      lore_proximity: [],
      scenes: [],
    };
    const inputPath = join(exportDir, "valid.json");
    await writeFile(inputPath, JSON.stringify(exportPayload));

    const result = await client.callTool({
      name: "import_campaign",
      arguments: { input_path: inputPath },
    });
    expect(result.isError).not.toBe(true);
    const parsed = parseText<{ ok: boolean; imported: Record<string, number> }>(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.imported.character).toBe(1);

    // Verify character was persisted
    const charRaw = await readFile(join(campaignDir, "character.json"), "utf-8");
    const char = JSON.parse(charRaw) as Record<string, unknown>;
    expect(char["name"]).toBe("Kara");
  });

  it("imports NPCs from a valid export", async () => {
    const exportPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      character: null,
      threads: [],
      npcs: { "aldric.md": "# Aldric\nA blacksmith." },
      lore_entities: [],
      lore_relations: [],
      lore_proximity: [],
      scenes: [],
    };
    const inputPath = join(exportDir, "npcs.json");
    await writeFile(inputPath, JSON.stringify(exportPayload));

    const result = await client.callTool({
      name: "import_campaign",
      arguments: { input_path: inputPath },
    });
    expect(result.isError).not.toBe(true);
    const parsed = parseText<{ imported: Record<string, number> }>(result);
    expect(parsed.imported.npcs).toBe(1);

    // NOTE: NPCs are now stored in world.duckdb as person entities (not files).
    // Verify via the entity store instead of file system.
    const { getNpc } = await import("@agentic-rpg/core");
    const npcContent = await getNpc(campaignDir, "Aldric");
    expect(npcContent).not.toBeNull();
    expect(npcContent!).toContain("# Aldric");
  });

  it("imports threads from a valid export", async () => {
    const thread = {
      title: "Defeat the Iron Lich",
      kind: "vow",
      status: "open",
      notes: "Epic quest",
      openedAt: new Date().toISOString(),
    };
    const exportPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      character: null,
      threads: [thread],
      npcs: {},
      lore_entities: [],
      lore_relations: [],
      lore_proximity: [],
      scenes: [],
    };
    const inputPath = join(exportDir, "threads.json");
    await writeFile(inputPath, JSON.stringify(exportPayload));

    const result = await client.callTool({
      name: "import_campaign",
      arguments: { input_path: inputPath },
    });
    expect(result.isError).not.toBe(true);
    const parsed = parseText<{ imported: Record<string, number> }>(result);
    expect(parsed.imported.threads).toBe(1);
  });

  it("round-trips a full export/import cycle preserving character", async () => {
    // Seed the campaign
    await writeFile(join(campaignDir, "character.json"), JSON.stringify(BASE_CHARACTER));
    const outputPath = join(exportDir, "roundtrip.json");

    // Export
    await client.callTool({ name: "export_campaign", arguments: { output_path: outputPath } });

    // Import into a fresh campaign dir
    const importDir = await mkdtemp(join(tmpdir(), "scribe-import-test-"));
    try {
      const importServer = new McpServer({ name: "test-import", version: "0.0.1" });
      register(importServer, importDir);
      const importClient = new Client({ name: "import-client", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await importServer.connect(st);
      await importClient.connect(ct);

      const importResult = await importClient.callTool({
        name: "import_campaign",
        arguments: { input_path: outputPath },
      });
      expect(importResult.isError).not.toBe(true);

      const charRaw = await readFile(join(importDir, "character.json"), "utf-8");
      const char = JSON.parse(charRaw) as Record<string, unknown>;
      expect(char["name"]).toBe("Kara");
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }
  });

  it("returns error when input file does not exist", async () => {
    const result = await client.callTool({
      name: "import_campaign",
      arguments: { input_path: join(exportDir, "nonexistent.json") },
    });
    expect(result.isError).toBe(true);
  });

  it("preserves lore entity created_at on roundtrip export/import", async () => {
    // This test requires Ollama for embedding. If unavailable, skip gracefully.
    const ollamaUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    let ollamaReady = false;
    try {
      const res = await fetch(`${ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "test" }),
      });
      ollamaReady = res.ok;
    } catch {
      // Ollama not available
    }
    if (!ollamaReady) return;

    const { upsertLore, exportLore } = await import("@agentic-rpg/core");

    // Create a lore entity
    const beforeTimestamp = new Date().toISOString();
    const { id: entityId } = await upsertLore(campaignDir, {
      canonical: "Test Entity",
      type: "place",
      summary: "A test location",
    });

    // Export the campaign
    const exportPath = join(exportDir, "export1.json");
    await client.callTool({ name: "export_campaign", arguments: { output_path: exportPath } });

    const exportData = JSON.parse(await readFile(exportPath, "utf-8")) as Record<string, unknown>;
    const entity1 = (exportData["lore_entities"] as unknown[]).find((e) => {
      const e_ = e as Record<string, unknown>;
      return e_["id"] === entityId;
    }) as Record<string, unknown> | undefined;

    expect(entity1).toBeDefined();
    const createdAt1 = String(entity1!["created_at"]);
    expect(createdAt1.length > 0).toBe(true);

    // Import into a fresh campaign
    const importDir = await mkdtemp(join(tmpdir(), "scribe-roundtrip-test-"));
    try {
      const importServer = new McpServer({ name: "test-import2", version: "0.0.1" });
      register(importServer, importDir);
      const importClient = new Client({ name: "import-client2", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await importServer.connect(st);
      await importClient.connect(ct);

      const importResult = await importClient.callTool({
        name: "import_campaign",
        arguments: { input_path: exportPath },
      });
      expect(importResult.isError).not.toBe(true);

      // Export again from the fresh campaign
      const exportPath2 = join(exportDir, "export2.json");
      await importClient.callTool({
        name: "export_campaign",
        arguments: { output_path: exportPath2 },
      });

      const exportData2 = JSON.parse(await readFile(exportPath2, "utf-8")) as Record<string, unknown>;
      const entity2 = (exportData2["lore_entities"] as unknown[]).find((e) => {
        const e_ = e as Record<string, unknown>;
        return e_["id"] === entityId;
      }) as Record<string, unknown> | undefined;

      expect(entity2).toBeDefined();
      const createdAt2 = String(entity2!["created_at"]);

      // Assert created_at is preserved
      expect(createdAt2).toBe(createdAt1);
      expect(new Date(createdAt2).getTime()).toBeLessThanOrEqual(new Date(beforeTimestamp).getTime() + 5000); // Allow some time diff
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }
  });

  it("preserves provenance on roundtrip export/import", async () => {
    const ollamaUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    let ollamaReady = false;
    try {
      const res = await fetch(`${ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "test" }),
      });
      ollamaReady = res.ok;
    } catch {
      // Ollama not available
    }
    if (!ollamaReady) return;

    const { upsertLore, listProvenance } = await import("@agentic-rpg/core");

    // Create a lore entity with provenance
    const { id: entityId } = await upsertLore(campaignDir, {
      canonical: "Provenance Test",
      type: "concept",
      summary: "Test entity with provenance",
      provenance: {
        source_kind: "document",
        source_id: "doc-123",
        excerpt: "From chapter 5",
        confidence: 0.95,
      },
    });

    // Check original provenance
    const originalProv = await listProvenance(campaignDir, "entity", entityId);
    expect(originalProv.length).toBe(1);
    const originalProvenanceId = originalProv[0].id;

    // Export the campaign
    const exportPath = join(exportDir, "export-prov.json");
    await client.callTool({ name: "export_campaign", arguments: { output_path: exportPath } });

    const exportData = JSON.parse(await readFile(exportPath, "utf-8")) as Record<string, unknown>;
    expect((exportData["lore_provenance"] as unknown[]).length).toBeGreaterThan(0);

    // Import into a fresh campaign
    const importDir = await mkdtemp(join(tmpdir(), "scribe-provenance-test-"));
    try {
      const importServer = new McpServer({ name: "test-import3", version: "0.0.1" });
      register(importServer, importDir);
      const importClient = new Client({ name: "import-client3", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await importServer.connect(st);
      await importClient.connect(ct);

      const importResult = await importClient.callTool({
        name: "import_campaign",
        arguments: { input_path: exportPath },
      });
      expect(importResult.isError).not.toBe(true);

      // Check provenance is preserved in the imported campaign
      const { listProvenance: importListProvenance } = await import("@agentic-rpg/core");
      const importedProv = await importListProvenance(importDir, "entity", entityId);
      expect(importedProv.length).toBe(1);
      expect(importedProv[0].source_kind).toBe("document");
      expect(importedProv[0].source_id).toBe("doc-123");
      expect(importedProv[0].excerpt).toBe("From chapter 5");
      expect(importedProv[0].confidence).toBe(0.95);
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }
  });

  it("is idempotent: re-importing the same payload does not duplicate records", async () => {
    const ollamaUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    let ollamaReady = false;
    try {
      const res = await fetch(`${ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "test" }),
      });
      ollamaReady = res.ok;
    } catch {
      // Ollama not available
    }
    if (!ollamaReady) return;

    const { upsertLore, listProvenance } = await import("@agentic-rpg/core");

    // Create entities with provenance
    const { id: entityId1 } = await upsertLore(campaignDir, {
      canonical: "Entity 1",
      type: "faction",
      summary: "First entity",
      provenance: { source_kind: "manual" },
    });

    const { id: entityId2 } = await upsertLore(campaignDir, {
      canonical: "Entity 2",
      type: "faction",
      summary: "Second entity",
      provenance: { source_kind: "manual" },
    });

    // Export
    const exportPath = join(exportDir, "export-idempotent.json");
    const exportResult1 = await client.callTool({
      name: "export_campaign",
      arguments: { output_path: exportPath },
    });
    const counts1 = parseText<{ counts: Record<string, number> }>(exportResult1).counts;

    // Import into a fresh campaign
    const importDir = await mkdtemp(join(tmpdir(), "scribe-idempotent-test-"));
    try {
      const importServer = new McpServer({ name: "test-import4", version: "0.0.1" });
      register(importServer, importDir);
      const importClient = new Client({ name: "import-client4", version: "0.0.1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await importServer.connect(st);
      await importClient.connect(ct);

      const importResult1 = await importClient.callTool({
        name: "import_campaign",
        arguments: { input_path: exportPath },
      });
      expect(importResult1.isError).not.toBe(true);
      const importCounts1 = parseText<{ imported: Record<string, number> }>(importResult1).imported;

      // Import again (should be no-op)
      const importResult2 = await importClient.callTool({
        name: "import_campaign",
        arguments: { input_path: exportPath },
      });
      expect(importResult2.isError).not.toBe(true);
      const importCounts2 = parseText<{ imported: Record<string, number> }>(importResult2).imported;

      // Counts should be the same on the second import (idempotent)
      expect(importCounts2.lore_entities).toBe(importCounts1.lore_entities);
      expect(importCounts2.lore_provenance).toBe(importCounts1.lore_provenance);
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }
  });
});
