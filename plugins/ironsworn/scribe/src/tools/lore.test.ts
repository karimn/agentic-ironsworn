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
