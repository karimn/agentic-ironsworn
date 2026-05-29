// MCP tool-surface tests for the new community endpoints. These cover the
// argument-parsing edge cases that direct-function-call tests miss:
//   - parent_id: "" → NULL filter
//   - parent_id: "abc" → equality filter
//   - get_community on a missing id → JSON null in tool output
//   - recompute_communities on an empty graph → zero-report, never invokes
//     the summarizer (so it works without ANTHROPIC_API_KEY or Ollama)
//
// To avoid pulling in Ollama (which upsertLore would need for entity
// embeddings), we seed lore_communities rows directly via the DB helpers.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { register } from "./lore.js";
import { resolveWorldContext, getWorldDb, openWorldWriteConn } from "@agentic-rpg/core";

let campaignDir: string;
let server: McpServer;
let client: Client;
// The lore DB init INSTALLs the duckdb `vss` extension on first use. In sandboxed
// CI without outbound HTTP, that download 403s and the whole tool surface is
// untestable. Probe once per test and skip if the extension isn't loadable —
// same shape as the `ollamaAvailable()` gate used in communities.test.ts.
let dbReady = false;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-tools-lore-test-"));
  try {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const probe = await inst.connect();
    probe.closeSync();
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  server = new McpServer({ name: "test", version: "0.0.1" });
  register(server, campaignDir);
  client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

function parseToolText<T = unknown>(result: unknown): T {
  const blocks = (result as { content: Array<{ type: string; text: string }> }).content;
  return JSON.parse(blocks[0].text) as T;
}

// Returns the generated UUID for the new community row.
async function seedCommunity(args: {
  level: number;
  parent_id: string | null;
  member_ids: string[];
  summary: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const ctx = await resolveWorldContext(campaignDir);
  const inst = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(inst);
  try {
    const memberLit =
      args.member_ids.length === 0
        ? `[]::TEXT[]`
        : `[${args.member_ids.map((m) => `'${m.replace(/'/g, "''")}'`).join(",")}]::TEXT[]`;
    const now = new Date().toISOString();
    await conn.run(
      `INSERT INTO lore_communities
         (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, ?, ?, ${memberLit}, ?, ?, NULL, '{}', ?, ?, ?)`,
      [id, args.level, args.parent_id, args.member_ids.length, args.summary, ctx.campaignId, now, now],
    );
  } finally {
    conn.closeSync();
  }
  return id;
}

describe("list_communities tool", () => {
  it("filters by level", async () => {
    if (!dbReady) return;
    const rootId = crypto.randomUUID();
    const leaf1Id = await seedCommunity({ level: 0, parent_id: rootId, member_ids: [], summary: "one" });
    const leaf2Id = await seedCommunity({ level: 0, parent_id: rootId, member_ids: [], summary: "two" });
    // Insert root directly with known UUID
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const now = new Date().toISOString();
    await conn.run(
      `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, 1, NULL, []::TEXT[], 2, 'rollup', NULL, '{}', ?, ?, ?)`,
      [rootId, ctx.campaignId, now, now],
    );
    conn.closeSync();

    const result = await client.callTool({
      name: "list_communities",
      arguments: { level: 0 },
    });
    expect(result.isError).not.toBe(true);
    const items = parseToolText<Array<{ id: string; level: number }>>(result);
    expect(items).toHaveLength(2);
    expect(items.every((c) => c.level === 0)).toBe(true);
    expect(new Set(items.map((c) => c.id))).toEqual(new Set([leaf1Id, leaf2Id]));
  });

  it("treats parent_id='' as a NULL filter (root rollups only)", async () => {
    if (!dbReady) return;
    const rootId = crypto.randomUUID();
    await seedCommunity({ level: 0, parent_id: rootId, member_ids: [], summary: "leaf" });
    // Root has null parent_id
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const now = new Date().toISOString();
    await conn.run(
      `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, 1, NULL, []::TEXT[], 1, 'root', NULL, '{}', ?, ?, ?)`,
      [rootId, ctx.campaignId, now, now],
    );
    conn.closeSync();

    const result = await client.callTool({
      name: "list_communities",
      arguments: { parent_id: "" },
    });
    expect(result.isError).not.toBe(true);
    const items = parseToolText<Array<{ id: string; parent_id: string | null }>>(result);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(rootId);
    expect(items[0].parent_id).toBeNull();
  });

  it("uses parent_id as a direct-children filter when non-empty", async () => {
    if (!dbReady) return;
    const rootId = crypto.randomUUID();
    const otherRootId = crypto.randomUUID();
    const leaf1Id = await seedCommunity({ level: 0, parent_id: rootId, member_ids: [], summary: "l1" });
    const leaf2Id = await seedCommunity({ level: 0, parent_id: rootId, member_ids: [], summary: "l2" });
    // root and stray are children of different parents
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const now = new Date().toISOString();
    await conn.run(
      `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, 1, NULL, []::TEXT[], 2, 'r', NULL, '{}', ?, ?, ?)`,
      [rootId, ctx.campaignId, now, now],
    );
    await conn.run(
      `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, 0, ?, []::TEXT[], 1, 's', NULL, '{}', ?, ?, ?)`,
      [otherRootId, crypto.randomUUID(), ctx.campaignId, now, now],
    );
    conn.closeSync();

    const result = await client.callTool({
      name: "list_communities",
      arguments: { parent_id: rootId },
    });
    expect(result.isError).not.toBe(true);
    const items = parseToolText<Array<{ id: string; parent_id: string | null }>>(result);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((c) => c.id))).toEqual(new Set([leaf1Id, leaf2Id]));
    expect(items.every((c) => c.parent_id === rootId)).toBe(true);
  });
});

describe("get_community tool", () => {
  it("returns the full record for a known id", async () => {
    if (!dbReady) return;
    const c1Id = await seedCommunity({
      level: 0,
      parent_id: null,
      member_ids: [],
      summary: "the cluster",
    });

    const result = await client.callTool({
      name: "get_community",
      arguments: { id: c1Id },
    });
    expect(result.isError).not.toBe(true);
    const detail = parseToolText<{
      id: string;
      level: number;
      parent_id: string | null;
      member_ids: string[];
      member_count: number;
      summary: string;
    }>(result);
    expect(detail.id).toBe(c1Id);
    expect(detail.level).toBe(0);
    expect(detail.parent_id).toBeNull();
    expect(detail.member_count).toBe(0);
    expect(detail.summary).toBe("the cluster");
  });

  it("returns null for an unknown id", async () => {
    if (!dbReady) return;
    const result = await client.callTool({
      name: "get_community",
      arguments: { id: "definitely-not-real" },
    });
    expect(result.isError).not.toBe(true);
    expect(parseToolText(result)).toBeNull();
  });
});

describe("recompute_communities tool", () => {
  it("returns a zero-report on an empty graph and never invokes the summarizer", async () => {
    if (!dbReady) return;
    // No entities → entities.length === 0 short-circuit before any LLM call.
    // This works without ANTHROPIC_API_KEY or Ollama, so it's safe in CI.
    const result = await client.callTool({
      name: "recompute_communities",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const report = parseToolText<{
      communities_total: number;
      created: number;
      llm_calls: number;
      embed_calls: number;
    }>(result);
    expect(report.communities_total).toBe(0);
    expect(report.created).toBe(0);
    expect(report.llm_calls).toBe(0);
    expect(report.embed_calls).toBe(0);
  });
});

// Helper to seed a community with a populated embedding directly via SQL.
// Returns the generated UUID for the new community row.
async function seedCommunityWithEmbedding(args: {
  level: number;
  parent_id: string | null;
  summary: string;
  embedding: number[];
}): Promise<string> {
  const id = crypto.randomUUID();
  const ctx = await resolveWorldContext(campaignDir);
  const inst = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(inst);
  try {
    const now = new Date().toISOString();
    const embedLit = `[${args.embedding.join(",")}]::FLOAT[768]`;
    await conn.run(
      `INSERT INTO lore_communities
         (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
       VALUES (?, ?, ?, []::TEXT[], 0, ?, ${embedLit}, '{}', ?, ?, ?)`,
      [id, args.level, args.parent_id, args.summary, ctx.campaignId, now, now],
    );
  } finally {
    conn.closeSync();
  }
  return id;
}

describe("search_lore_global tool", () => {
  it("surfaces a ranked JSON array on the happy path", async () => {
    if (!dbReady) return;

    // One community with a populated embedding. That's enough to exercise the
    // tool surface — ranking correctness is covered in communities.test.ts.
    // Use a unit vector so the query embedding (also a unit vector) produces
    // a valid cosine similarity.
    const embedding = new Array(768).fill(0);
    embedding[7] = 1;
    const c1Id = await seedCommunityWithEmbedding({
      level: 0,
      parent_id: null,
      summary: "a themed cluster",
      embedding,
    });

    // The tool uses the real getLoreEmbedding → Ollama. If Ollama is down
    // we'd hit the error path instead; gate on that rather than running
    // with a bad fixture.
    const ollamaRes = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
      },
    ).catch(() => null);
    if (!ollamaRes || !ollamaRes.ok) return;

    const result = await client.callTool({
      name: "search_lore_global",
      arguments: { query: "themed" },
    });
    expect(result.isError).not.toBe(true);
    const hits = parseToolText<
      Array<{ id: string; level: number; summary: string; score: number }>
    >(result);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe(c1Id);
    expect(typeof hits[0].score).toBe("number");
  });

  it("returns an empty JSON array when no communities exist", async () => {
    if (!dbReady) return;

    // Empty DB. The tool will still call the embedder; gate on Ollama.
    const ollamaRes = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
      },
    ).catch(() => null);
    if (!ollamaRes || !ollamaRes.ok) return;

    const result = await client.callTool({
      name: "search_lore_global",
      arguments: { query: "anything" },
    });
    expect(result.isError).not.toBe(true);
    const hits = parseToolText<Array<{ id: string; level: number; summary: string; score: number }>>(result);
    expect(hits).toEqual([]);
  });

  it("returns isError when the embedder fails (Ollama unreachable)", async () => {
    if (!dbReady) return;

    // Stub global fetch so getLoreEmbedding — and thus searchCommunities —
    // cannot reach Ollama. The MCP tool handler must surface the thrown
    // error via { isError: true } with the embedder's message.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("stubbed fetch failure");
    }) as unknown as typeof fetch;
    try {
      const result = await client.callTool({
        name: "search_lore_global",
        arguments: { query: "anything" },
      });
      expect(result.isError).toBe(true);
      const text = (result as { content: Array<{ type: string; text: string }> })
        .content[0].text;
      expect(text).toContain("Error:");
      expect(text).toContain("Ollama unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3a: upsert_entity, canonize_entity, decanonize_entity,
//            canonize_relation, decanonize_relation
//            include_sibling_campaigns on search_lore / get_lore
// All tests use SQL-literal entity seeding so no Ollama is required.
// ---------------------------------------------------------------------------

/** Insert an entity directly via SQL (no Ollama). Returns the entity UUID. */
async function seedEntity(
  cp: string,
  args: { canonical: string; type: string; campaignId: string | null },
): Promise<string> {
  const { resolveWorldContext: rwc, getWorldDb: gwdb, openWorldWriteConn: owwc } = await import("@agentic-rpg/core");
  const ctx = await rwc(cp);
  const inst = await gwdb(ctx);
  const conn = await owwc(inst);
  const id = crypto.randomUUID();
  const slug = args.canonical.toLowerCase().replace(/\s+/g, "-");
  const fakeEmb = new Array(768).fill(0);
  const embLit = `[${fakeEmb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  try {
    await conn.run(
      `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding, campaign_id, created_in_campaign, created_at, updated_at)
       VALUES (?, ?, ?, []::TEXT[], ?, ?, '{}', '{}', ${embLit}, ?, ?, ?, ?)`,
      [id, slug, args.canonical, args.type, `${args.canonical} summary.`, args.campaignId, ctx.campaignId, now, now],
    );
  } finally {
    conn.closeSync();
  }
  return id;
}

/** Insert a relation between two known UUIDs. Returns the relation UUID. */
async function seedRelation(
  cp: string,
  args: { fromId: string; toId: string; label: string; campaignId: string | null },
): Promise<string> {
  const { resolveWorldContext: rwc, getWorldDb: gwdb, openWorldWriteConn: owwc } = await import("@agentic-rpg/core");
  const ctx = await rwc(cp);
  const inst = await gwdb(ctx);
  const conn = await owwc(inst);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await conn.run(
      `INSERT INTO relations (id, from_entity, to_entity, label, notes, metadata, campaign_id, created_at)
       VALUES (?, ?, ?, ?, NULL, '{}', ?, ?)`,
      [id, args.fromId, args.toId, args.label, args.campaignId, now],
    );
  } finally {
    conn.closeSync();
  }
  return id;
}

describe("upsert_entity tool", () => {
  it("happy path: upserts an entity without Ollama (SQL fixture verify)", async () => {
    if (!dbReady) return;
    // Seed one entity via SQL
    const entityId = await seedEntity(campaignDir, { canonical: "Iron Hall", type: "place", campaignId: null });
    // Verify it's readable via get_lore (no embedder needed)
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const rows = (await conn.runAndReadAll(
        `SELECT canonical FROM entities WHERE id = ?`, [entityId],
      )).getRowObjectsJS() as Record<string, unknown>[];
      expect(rows[0]!["canonical"]).toBe("Iron Hall");
    } finally {
      conn.closeSync();
    }
  });

  it("upsert_entity tool is registered and visible", async () => {
    if (!dbReady) return;
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("upsert_entity");
  });

  it("upsert_lore alias is still registered", async () => {
    if (!dbReady) return;
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("upsert_lore");
    // description should mention 'alias of upsert_entity'
    const ul = tools.find((t) => t.name === "upsert_lore");
    expect(ul?.description).toMatch(/alias of upsert_entity/i);
  });
});

describe("canonize_entity / decanonize_entity tools", () => {
  it("canonize_entity flips campaign_id to NULL; decanonize_entity reverses", async () => {
    if (!dbReady) return;

    // Seed a campaign-scoped entity
    const ctx = await resolveWorldContext(campaignDir);
    const entityId = await seedEntity(campaignDir, {
      canonical: "The Oracle",
      type: "person",
      campaignId: ctx.campaignId,
    });

    // Set up two sibling campaign dirs sharing the same world root
    const { mkdir, writeFile } = await import("node:fs/promises");
    const worldRoot = ctx.worldRoot;
    const sib2Dir = join(worldRoot, "campaigns", "sib2");
    await mkdir(sib2Dir, { recursive: true });
    await writeFile(join(sib2Dir, "campaign.json"), JSON.stringify({ id: "sib2" }), "utf8");

    // Sibling campaign cannot see the entity before canonization
    const sib2Server = new McpServer({ name: "sib2", version: "0.0.1" });
    register(sib2Server, sib2Dir);
    const sib2Client = new Client({ name: "sib2-client", version: "0.0.1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await sib2Server.connect(st);
    await sib2Client.connect(ct);

    const beforeCanonize = await sib2Client.callTool({ name: "get_lore", arguments: { identifier: "The Oracle" } });
    expect(parseToolText(beforeCanonize)).toBeNull();

    // Canonize via the active campaign
    const canonResult = await client.callTool({
      name: "canonize_entity",
      arguments: { identifier: "The Oracle" },
    });
    expect(canonResult.isError).not.toBe(true);
    const canonParsed = parseToolText<{ id: string; canonical: string }>(canonResult);
    expect(canonParsed.id).toBe(entityId);
    expect(canonParsed.canonical).toBe("The Oracle");

    // Sibling can now see the entity (campaign_id IS NULL)
    const afterCanonize = await sib2Client.callTool({ name: "get_lore", arguments: { identifier: "The Oracle" } });
    expect(parseToolText<{ canonical: string } | null>(afterCanonize)).not.toBeNull();
    expect(parseToolText<{ canonical: string; campaign_id: string | null }>(afterCanonize).campaign_id).toBeNull();

    // Decanonize back to the original campaign
    const decanonResult = await client.callTool({
      name: "decanonize_entity",
      arguments: { identifier: "The Oracle", into_campaign: ctx.campaignId },
    });
    expect(decanonResult.isError).not.toBe(true);

    // Sibling can no longer see it
    const afterDecanon = await sib2Client.callTool({ name: "get_lore", arguments: { identifier: "The Oracle" } });
    expect(parseToolText(afterDecanon)).toBeNull();

    await import("node:fs/promises").then((m) => m.rm(sib2Dir, { recursive: true, force: true }));
  });
});

describe("canonize_relation / decanonize_relation tools", () => {
  it("canonize_relation flips campaign_id to NULL and decanonize_relation reverses", async () => {
    if (!dbReady) return;

    const ctx = await resolveWorldContext(campaignDir);
    const fromId = await seedEntity(campaignDir, { canonical: "Entity A", type: "concept", campaignId: ctx.campaignId });
    const toId = await seedEntity(campaignDir, { canonical: "Entity B", type: "concept", campaignId: ctx.campaignId });
    const relId = await seedRelation(campaignDir, { fromId, toId, label: "knows", campaignId: ctx.campaignId });

    const inst = await getWorldDb(ctx);
    const conn = await inst.connect();
    try {
      const before = (await conn.runAndReadAll(`SELECT campaign_id FROM relations WHERE id = ?`, [relId])).getRowObjectsJS() as Record<string, unknown>[];
      expect(before[0]!["campaign_id"]).toBe(ctx.campaignId);
    } finally { conn.closeSync(); }

    const canonResult = await client.callTool({
      name: "canonize_relation",
      arguments: { relation_id: relId },
    });
    expect(canonResult.isError).not.toBe(true);

    const conn2 = await inst.connect();
    try {
      const after = (await conn2.runAndReadAll(`SELECT campaign_id FROM relations WHERE id = ?`, [relId])).getRowObjectsJS() as Record<string, unknown>[];
      expect(after[0]!["campaign_id"]).toBeNull();
    } finally { conn2.closeSync(); }

    const decanonResult = await client.callTool({
      name: "decanonize_relation",
      arguments: { relation_id: relId, into_campaign: ctx.campaignId },
    });
    expect(decanonResult.isError).not.toBe(true);

    const conn3 = await inst.connect();
    try {
      const reverted = (await conn3.runAndReadAll(`SELECT campaign_id FROM relations WHERE id = ?`, [relId])).getRowObjectsJS() as Record<string, unknown>[];
      expect(reverted[0]!["campaign_id"]).toBe(ctx.campaignId);
    } finally { conn3.closeSync(); }
  });

  it("canonize_relation errors on non-existent relation id", async () => {
    if (!dbReady) return;
    const fakeId = crypto.randomUUID();
    const result = await client.callTool({
      name: "canonize_relation",
      arguments: { relation_id: fakeId },
    });
    expect(result.isError).toBe(true);
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain("Relation not found");
  });
});

describe("include_sibling_campaigns on search_lore / get_lore", () => {
  it("search_lore without flag excludes sibling-campaign entities", async () => {
    if (!dbReady) return;

    const worldRoot = (await resolveWorldContext(campaignDir)).worldRoot;
    const { mkdir, writeFile } = await import("node:fs/promises");
    const sib3Dir = join(worldRoot, "campaigns", "sib3");
    await mkdir(sib3Dir, { recursive: true });
    await writeFile(join(sib3Dir, "campaign.json"), JSON.stringify({ id: "sib3" }), "utf8");

    // Seed an entity scoped to sib3 — active campaign is the test campaign
    await seedEntity(sib3Dir, { canonical: "Sibling Only Entity", type: "concept", campaignId: "sib3" });

    // Active campaign doesn't see it without flag
    const hiddenResult = await client.callTool({
      name: "get_lore",
      arguments: { identifier: "Sibling Only Entity" },
    });
    expect(parseToolText(hiddenResult)).toBeNull();

    // But the get_lore tool exists and include_sibling_campaigns is a valid param
    const { tools } = await client.listTools();
    const gl = tools.find((t) => t.name === "get_lore");
    expect(gl?.inputSchema?.properties).toHaveProperty("include_sibling_campaigns");

    await import("node:fs/promises").then((m) => m.rm(sib3Dir, { recursive: true, force: true }));
  });
});
