import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clusterGraph,
  stableCommunityId,
  recomputeCommunities,
  listCommunities,
  getCommunity,
  _makeDefaultSummarizer,
  type AnthropicLike,
  type SummarizerInput,
} from "./communities.js";
import { upsertLore, linkLore, getLore } from "./lore.js";

async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/api/tags`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-communities-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// stableCommunityId
// ---------------------------------------------------------------------------

describe("stableCommunityId", () => {
  it("is deterministic for the same level + members", () => {
    const a = stableCommunityId(0, ["x", "y", "z"]);
    const b = stableCommunityId(0, ["x", "y", "z"]);
    expect(a).toBe(b);
  });

  it("is order-insensitive for members", () => {
    const a = stableCommunityId(0, ["a", "b", "c"]);
    const b = stableCommunityId(0, ["c", "a", "b"]);
    expect(a).toBe(b);
  });

  it("changes when membership changes", () => {
    const a = stableCommunityId(0, ["a", "b"]);
    const b = stableCommunityId(0, ["a", "c"]);
    expect(a).not.toBe(b);
  });

  it("changes when level changes", () => {
    const a = stableCommunityId(0, ["a", "b"]);
    const b = stableCommunityId(1, ["a", "b"]);
    expect(a).not.toBe(b);
  });

  it("returns 16 hex chars", () => {
    expect(stableCommunityId(0, ["a"])).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// clusterGraph (pure, no DB / network needed)
// ---------------------------------------------------------------------------

describe("clusterGraph", () => {
  it("returns empty for empty input", () => {
    expect(clusterGraph([], [])).toEqual([]);
  });

  it("places a single entity in one leaf community", () => {
    const out = clusterGraph([{ id: "a" }], []);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe(0);
    expect(out[0].member_ids).toEqual(["a"]);
    expect(out[0].parent_id).toBeNull();
    expect(out[0].member_count).toBe(1);
  });

  it("clusters two densely-linked triangles into separate leaves", () => {
    // Two K3 cliques (a,b,c) and (x,y,z) joined by a single weak edge c—x.
    // Louvain should split them into two leaf communities.
    const entities = ["a", "b", "c", "x", "y", "z"].map((id) => ({ id }));
    const relations = [
      { from_id: "a", to_id: "b" }, { from_id: "b", to_id: "c" }, { from_id: "a", to_id: "c" },
      { from_id: "x", to_id: "y" }, { from_id: "y", to_id: "z" }, { from_id: "x", to_id: "z" },
      { from_id: "c", to_id: "x" },
    ];
    const out = clusterGraph(entities, relations, { seed: 42 });

    const leaves = out.filter((c) => c.level === 0);
    expect(leaves.length).toBeGreaterThanOrEqual(2);

    // Each leaf's members should be a subset of one of the two triangles.
    const triangleA = new Set(["a", "b", "c"]);
    const triangleB = new Set(["x", "y", "z"]);
    for (const leaf of leaves) {
      const allInA = leaf.member_ids.every((m) => triangleA.has(m));
      const allInB = leaf.member_ids.every((m) => triangleB.has(m));
      expect(allInA || allInB).toBe(true);
    }
  });

  it("is reproducible across reruns with the same seed", () => {
    const entities = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
    const relations = [
      { from_id: "a", to_id: "b" }, { from_id: "b", to_id: "c" }, { from_id: "a", to_id: "c" },
      { from_id: "d", to_id: "e" }, { from_id: "e", to_id: "f" }, { from_id: "d", to_id: "f" },
      { from_id: "c", to_id: "d" },
    ];
    const a = clusterGraph(entities, relations, { seed: 7 });
    const b = clusterGraph(entities, relations, { seed: 7 });
    expect(a.map((c) => c.id).sort()).toEqual(b.map((c) => c.id).sort());
  });

  it("adds a synthetic root when multiple top-level communities remain", () => {
    // Two completely disconnected clusters → no edges to merge them.
    const entities = ["a", "b", "x", "y"].map((id) => ({ id }));
    const relations = [
      { from_id: "a", to_id: "b" },
      { from_id: "x", to_id: "y" },
    ];
    const out = clusterGraph(entities, relations, { seed: 1 });

    const roots = out.filter((c) => c.parent_id === null);
    expect(roots).toHaveLength(1);
    const root = roots[0];
    // Root should be at the highest level and contain >= 2 children
    expect(root.level).toBeGreaterThan(0);
    expect(root.member_ids.length).toBeGreaterThanOrEqual(2);
    // Every non-root should chain up to the root
    const built = new Map(out.map((c) => [c.id, c] as const));
    for (const c of out) {
      if (c.id === root.id) continue;
      let cursor: string | null = c.parent_id;
      while (cursor !== null && cursor !== root.id) {
        const next = built.get(cursor);
        cursor = next?.parent_id ?? null;
      }
      expect(cursor).toBe(root.id);
    }
  });

  it("ignores self-loops and dangling edges", () => {
    const entities = [{ id: "a" }, { id: "b" }];
    const relations = [
      { from_id: "a", to_id: "a" },        // self-loop
      { from_id: "a", to_id: "ghost" },    // unknown endpoint
      { from_id: "a", to_id: "b" },        // valid
    ];
    const out = clusterGraph(entities, relations, { seed: 1 });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      for (const m of c.member_ids) {
        if (c.level === 0) expect(["a", "b"]).toContain(m);
      }
    }
  });

  it("transitive member_count rolls entities up through parents", () => {
    const entities = ["a", "b", "c", "x", "y", "z"].map((id) => ({ id }));
    const relations = [
      { from_id: "a", to_id: "b" }, { from_id: "b", to_id: "c" }, { from_id: "a", to_id: "c" },
      { from_id: "x", to_id: "y" }, { from_id: "y", to_id: "z" }, { from_id: "x", to_id: "z" },
    ];
    const out = clusterGraph(entities, relations, { seed: 1 });
    const root = out.find((c) => c.parent_id === null);
    expect(root).toBeDefined();
    expect(root!.member_count).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// recomputeCommunities (requires Ollama for entity embeddings via upsertLore)
// ---------------------------------------------------------------------------

const fakeSummarizer = async (input: SummarizerInput): Promise<string> => {
  return `cluster:${input.community_id}:level=${input.level}:n=${input.members.length + input.child_summaries.length}`;
};

describe("recomputeCommunities", () => {
  it("returns a zero-report on an empty graph", async () => {
    if (!(await ollamaAvailable())) return;
    const report = await recomputeCommunities(campaignDir, {
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(report.communities_total).toBe(0);
    expect(report.created).toBe(0);
    expect(report.llm_calls).toBe(0);
  });

  it("clusters a synthetic graph and writes leaf community ids onto entities", async () => {
    if (!(await ollamaAvailable())) return;

    // Build two triangles linked by a single edge.
    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      await upsertLore(campaignDir, {
        canonical: name,
        type: "concept",
        summary: `Entity ${name}`,
      });
    }
    const triangleA: [string, string][] = [["A", "B"], ["B", "C"], ["A", "C"]];
    const triangleB: [string, string][] = [["X", "Y"], ["Y", "Z"], ["X", "Z"]];
    for (const [from, to] of [...triangleA, ...triangleB, ["C", "X"] as [string, string]]) {
      await linkLore(campaignDir, { from, to, relation: "rel" });
    }

    const report = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });

    expect(report.communities_total).toBeGreaterThan(0);
    expect(report.created).toBe(report.communities_total);
    expect(report.llm_calls).toBe(report.created);

    // Every entity should now have a community_id stamped via metadata.
    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      const ent = await getLore(campaignDir, name.toLowerCase());
      expect(ent?.community_id).toBeTruthy();
      expect(typeof ent?.community_id).toBe("string");
    }

    // The two triangles should not all share one leaf community.
    const leaves = await listCommunities(campaignDir, { level: 0, limit: 100 });
    expect(leaves.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent: re-running on an unchanged graph produces 0 LLM calls", async () => {
    if (!(await ollamaAvailable())) return;

    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    for (const [from, to] of [["A", "B"], ["B", "C"], ["A", "C"], ["X", "Y"], ["Y", "Z"], ["X", "Z"]] as [string, string][]) {
      await linkLore(campaignDir, { from, to, relation: "rel" });
    }

    const first = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(first.created).toBeGreaterThan(0);

    const second = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(second.created).toBe(0);
    expect(second.llm_calls).toBe(0);
    expect(second.unchanged).toBe(first.created);
  });

  it("only re-summarizes communities whose member set changed", async () => {
    if (!(await ollamaAvailable())) return;

    // Two cleanly separated triangles.
    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    for (const [from, to] of [["A", "B"], ["B", "C"], ["A", "C"], ["X", "Y"], ["Y", "Z"], ["X", "Z"]] as [string, string][]) {
      await linkLore(campaignDir, { from, to, relation: "rel" });
    }
    const first = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(first.created).toBeGreaterThan(0);

    // Add a brand new entity connected only to A. This should create a new
    // leaf (or grow the A-triangle leaf) but should NOT churn the X-triangle
    // leaf, which has identical members and identical internal structure.
    await upsertLore(campaignDir, { canonical: "Q", type: "concept", summary: "new" });
    await linkLore(campaignDir, { from: "Q", to: "A", relation: "rel" });

    const second = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });

    // Some clusters were unchanged (the X-triangle should be one of them).
    expect(second.unchanged).toBeGreaterThan(0);
    // At least one community changed, so created > 0.
    expect(second.created).toBeGreaterThan(0);
  });

  it("deletes communities that disappear from the new clustering", async () => {
    if (!(await ollamaAvailable())) return;

    // Setup a graph, recompute, then delete entities → fewer communities.
    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    for (const [from, to] of [["A", "B"], ["B", "C"], ["X", "Y"], ["Y", "Z"]] as [string, string][]) {
      await linkLore(campaignDir, { from, to, relation: "rel" });
    }
    const first = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(first.created).toBeGreaterThan(0);
    const initialCount = first.communities_total;

    // Now strip almost everything down to a single entity by re-upserting
    // a tiny graph in a fresh campaign isn't possible — instead we count on
    // recompute vs. the existing communities. Simulate "graph shrinks" by
    // wiping all entities directly. That'll force community deletion.
    // We use a helper: open the lore DB and TRUNCATE entities + relations.
    const { getLoreDb, openLoreWriteConn } = await import("./lore-db.js");
    const inst = await getLoreDb(campaignDir);
    const conn = await openLoreWriteConn(inst);
    try {
      await conn.run(`DELETE FROM lore_entities`);
      await conn.run(`DELETE FROM lore_relations`);
    } finally {
      conn.closeSync();
    }

    const second = await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });
    expect(second.deleted).toBe(initialCount);
    expect(second.communities_total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// list_communities + get_community
// ---------------------------------------------------------------------------

describe("listCommunities + getCommunity", () => {
  it("filters by level and by parent_id", async () => {
    if (!(await ollamaAvailable())) return;

    // Two cleanly-separated triangles → at least 2 leaves + 1 root
    for (const name of ["A", "B", "C", "X", "Y", "Z"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    for (const [from, to] of [["A", "B"], ["B", "C"], ["A", "C"], ["X", "Y"], ["Y", "Z"], ["X", "Z"]] as [string, string][]) {
      await linkLore(campaignDir, { from, to, relation: "rel" });
    }
    await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });

    const leaves = await listCommunities(campaignDir, { level: 0 });
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((c) => c.level === 0)).toBe(true);

    const roots = await listCommunities(campaignDir, { parent_id: null });
    expect(roots.length).toBe(1);

    const rootId = roots[0].id;
    const directChildren = await listCommunities(campaignDir, { parent_id: rootId });
    expect(directChildren.length).toBeGreaterThanOrEqual(2);
    expect(directChildren.every((c) => c.parent_id === rootId)).toBe(true);
  });

  it("get_community returns full record for an existing id and null for unknown", async () => {
    if (!(await ollamaAvailable())) return;

    for (const name of ["A", "B"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });

    const all = await listCommunities(campaignDir, {});
    expect(all.length).toBeGreaterThan(0);

    const detail = await getCommunity(campaignDir, all[0].id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(all[0].id);
    expect(Array.isArray(detail!.member_ids)).toBe(true);
    expect(detail!.member_ids.length).toBeGreaterThan(0);
    expect(typeof detail!.summary).toBe("string");

    const missing = await getCommunity(campaignDir, "definitely-not-an-id");
    expect(missing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// _makeDefaultSummarizer (Anthropic SDK path) — exercised with a stub client
// so we cover prompt shape, message structure, and response parsing without
// hitting the real API.
// ---------------------------------------------------------------------------

interface CapturedCall {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: "user"; content: string }[];
}

function makeStubClient(
  reply: { content: { type: string; text?: string }[] },
): { client: AnthropicLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const client: AnthropicLike = {
    messages: {
      create: async (args) => {
        calls.push(args);
        return reply;
      },
    },
  };
  return { client, calls };
}

describe("_makeDefaultSummarizer", () => {
  it("formats a leaf prompt with members and internal relations and concatenates text blocks", async () => {
    const { client, calls } = makeStubClient({
      content: [
        { type: "text", text: "first half." },
        { type: "text", text: "second half." },
      ],
    });
    const summarize = _makeDefaultSummarizer(client);
    const out = await summarize({
      community_id: "abc123",
      level: 0,
      members: [
        { id: "eldritch", canonical: "Eldritch", type: "npc", summary: "an NPC" },
        { id: "tower", canonical: "Tower", type: "place", summary: "a ruin" },
      ],
      internal_relations: [
        { from_id: "eldritch", to_id: "tower", relation: "haunts", notes: "since the war" },
      ],
      child_summaries: [],
    });
    expect(out).toBe("first half.\nsecond half.");
    expect(calls).toHaveLength(1);
    expect(calls[0].max_tokens).toBe(400);
    expect(calls[0].system).toMatch(/Ironsworn/);
    expect(calls[0].messages).toHaveLength(1);
    expect(calls[0].messages[0].role).toBe("user");
    const prompt = calls[0].messages[0].content;
    expect(prompt).toContain("level 0");
    expect(prompt).toContain("Members:");
    expect(prompt).toContain("Eldritch");
    expect(prompt).toContain("Tower");
    expect(prompt).toContain("Internal relations:");
    expect(prompt).toContain("haunts");
    expect(prompt).toContain("since the war");
  });

  it("formats a parent prompt with child summaries and omits the Members section", async () => {
    const { client, calls } = makeStubClient({
      content: [{ type: "text", text: "rolled-up summary" }],
    });
    const summarize = _makeDefaultSummarizer(client);
    const out = await summarize({
      community_id: "parent",
      level: 2,
      members: [],
      internal_relations: [],
      child_summaries: [
        { id: "c1", summary: "child A summary", member_count: 3 },
        { id: "c2", summary: "child B summary", member_count: 5 },
      ],
    });
    expect(out).toBe("rolled-up summary");
    const prompt = calls[0].messages[0].content;
    expect(prompt).toContain("level 2");
    expect(prompt).toContain("Sub-clusters:");
    expect(prompt).toContain("child A summary");
    expect(prompt).toContain("child B summary");
    expect(prompt).toContain("8 entities"); // 3 + 5
    expect(prompt).not.toContain("Members:");
    expect(prompt).not.toContain("Internal relations:");
  });

  it("ignores non-text content blocks (e.g. tool_use)", async () => {
    const { client } = makeStubClient({
      content: [
        { type: "tool_use" }, // shape doesn't matter — should be skipped
        { type: "text", text: "just the text" },
      ],
    });
    const out = await _makeDefaultSummarizer(client)({
      community_id: "x",
      level: 0,
      members: [],
      internal_relations: [],
      child_summaries: [],
    });
    expect(out).toBe("just the text");
  });

  it("throws on an empty / whitespace-only response", async () => {
    const { client } = makeStubClient({
      content: [{ type: "text", text: "   \n  " }],
    });
    await expect(
      _makeDefaultSummarizer(client)({
        community_id: "x",
        level: 0,
        members: [],
        internal_relations: [],
        child_summaries: [],
      }),
    ).rejects.toThrow(/Empty summary/);
  });
});

// ---------------------------------------------------------------------------
// get_lore_graph integration: community_id surfaces on nodes
// ---------------------------------------------------------------------------

describe("get_lore_graph: community_id on nodes", () => {
  it("surfaces leaf community id on each node after recompute", async () => {
    if (!(await ollamaAvailable())) return;

    for (const name of ["A", "B", "C"]) {
      await upsertLore(campaignDir, { canonical: name, type: "concept", summary: `e ${name}` });
    }
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await linkLore(campaignDir, { from: "B", to: "C", relation: "rel" });

    // Before recompute: community_id should be null
    const before = await getLore(campaignDir, "a");
    expect(before?.community_id).toBeNull();

    await recomputeCommunities(campaignDir, {
      seed: 1,
      summarizer: fakeSummarizer,
      skipEmbeddings: true,
    });

    const after = await getLore(campaignDir, "a");
    expect(after?.community_id).not.toBeNull();
    expect(typeof after?.community_id).toBe("string");
  });
});
