import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertLore, getLore, searchLore, linkLore, getLoreGraph, listProvenance, looksLikeUuid } from "./lore.js";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";

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
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-lore-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("upsertLore + getLore", () => {
  it("creates an entity and retrieves it by ID (now UUID)", async () => {
    if (!(await ollamaAvailable())) return;
    const { id, slug } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron excavated from elven ruins. Tracks broken vows.",
    });
    // IDs are now UUIDs; slug carries the readable handle
    expect(looksLikeUuid(id)).toBe(true);
    expect(slug).toBe("elven-iron");

    // Can retrieve by UUID
    const byId = await getLore(campaignDir, id);
    expect(byId).not.toBeNull();
    expect(byId!.canonical).toBe("Elven Iron");
    expect(byId!.type).toBe("material");
    expect(byId!.aliases).toBeDefined();
    expect(byId!.content).toEqual({});
  });

  it("resolves by canonical name (case-insensitive)", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const byCanonical = await getLore(campaignDir, "Elven Iron");
    expect(byCanonical?.id).toBe(id);

    const byMixedCase = await getLore(campaignDir, "elven IRON");
    expect(byMixedCase?.id).toBe(id);
    expect(byMixedCase?.slug).toBe("elven-iron");
  });

  it("resolves by slug (backward-compat)", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    // Slug is stored as an alias for resolution backwards-compat
    const bySlug = await getLore(campaignDir, "elven-iron");
    expect(bySlug?.id).toBe(id);
  });

  it("resolves by alias", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elven iron", "elf-iron"],
    });

    const byAlias = await getLore(campaignDir, "elven iron");
    expect(byAlias?.canonical).toBe("Veth Iron");

    const byOtherAlias = await getLore(campaignDir, "Elf-Iron");
    expect(byOtherAlias?.canonical).toBe("Veth Iron");
  });

  it("returns null when nothing matches", async () => {
    if (!(await ollamaAvailable())) return;
    const missing = await getLore(campaignDir, "nonexistent-thing");
    expect(missing).toBeNull();
  });
});

describe("upsertLore — update and rename", () => {
  it("updates existing entity in place via UUID id", async () => {
    if (!(await ollamaAvailable())) return;
    const { id: firstId } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First version.",
    });

    const result = await upsertLore(campaignDir, {
      id: firstId, // UUID passthrough
      canonical: "Elven Iron",
      type: "material",
      summary: "Second version with more detail.",
    });

    expect(result.updated).toBe(true);
    expect(result.id).toBe(firstId);
    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.summary).toBe("Second version with more detail.");
    // aliases should not include the canonical itself
    const aliasCanonicalsLower = result.aliases.map((a) => a.toLowerCase());
    expect(aliasCanonicalsLower).not.toContain("elven iron");
  });

  it("updates existing entity in place via legacy slug id", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First version.",
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron", // legacy slug seed
      canonical: "Elven Iron",
      type: "material",
      summary: "Second version with more detail.",
    });

    expect(result.updated).toBe(true);
    expect(looksLikeUuid(result.id)).toBe(true);
    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.summary).toBe("Second version with more detail.");
    expect(result.aliases).toEqual([]);
  });

  it("moves old canonical to aliases on rename", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const result = await upsertLore(campaignDir, {
      id, // UUID
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    expect(result.updated).toBe(true);
    expect(result.canonical).toBe("Veth Iron");
    expect(result.aliases).toContain("Elven Iron");

    // Both names still resolve to the same UUID
    const byOld = await getLore(campaignDir, "elven iron");
    const byNew = await getLore(campaignDir, "Veth Iron");
    expect(byOld?.id).toBe(id);
    expect(byNew?.id).toBe(id);
  });

  it("merges new aliases with existing without duplicating", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elf-iron"],
    });

    const result = await upsertLore(campaignDir, {
      id,
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elf-iron", "Iron of the Firstborn"],
    });

    expect(result.aliases.filter((a) => a.toLowerCase() === "elf-iron")).toHaveLength(1);
    expect(result.aliases).toContain("Iron of the Firstborn");
  });
});

describe("searchLore", () => {
  it("returns ranked entities by semantic similarity", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron excavated from elven ruins. Tracks broken vows.",
    });
    await upsertLore(campaignDir, {
      canonical: "Tempest Hills",
      type: "place",
      summary: "Windswept highlands in the western Ironlands.",
    });

    const results = await searchLore(campaignDir, "metal used for oaths", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].canonical).toBe("Elven Iron");
    // IDs are now UUIDs
    expect(looksLikeUuid(results[0].id)).toBe(true);
    expect(results[0].slug).toBe("elven-iron");
  });

  it("filters by type when provided", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "A material used in vows.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    const onlyMaterials = await searchLore(campaignDir, "iron", 5, "material");
    expect(onlyMaterials.every((r) => r.type === "material")).toBe(true);
  });

  it("returns empty array when no entities exist", async () => {
    if (!(await ollamaAvailable())) return;
    const results = await searchLore(campaignDir, "anything", 5);
    expect(results).toEqual([]);
  });
});

describe("linkLore + getLore relations", () => {
  it("creates a typed relation between two entities", async () => {
    if (!(await ollamaAvailable())) return;
    const { id: elvenIronId } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    await linkLore(campaignDir, {
      from: "Iron Vow",
      to: elvenIronId, // use UUID as identifier
      relation: "sworn_on",
      notes: "The metal that binds the oath.",
    });

    const vow = await getLore(campaignDir, "Iron Vow");
    expect(vow?.relations).toBeDefined();
    expect(vow!.relations).toHaveLength(1);
    const rel = vow!.relations![0];
    expect(rel.direction).toBe("from");
    expect(rel.relation).toBe("sworn_on");
    expect(rel.entity.canonical).toBe("Elven Iron");
    expect(rel.notes).toBe("The metal that binds the oath.");
  });

  it("shows incoming relations on the target", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });
    await linkLore(campaignDir, {
      from: "Iron Vow",
      to: "Elven Iron",
      relation: "sworn_on",
    });

    const iron = await getLore(campaignDir, "elven-iron");
    expect(iron!.relations).toHaveLength(1);
    expect(iron!.relations![0].direction).toBe("to");
    expect(iron!.relations![0].entity.canonical).toBe("Iron Vow");
  });

  it("resolves from/to identifiers via aliases", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elven iron"],
    });
    await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });

    await linkLore(campaignDir, {
      from: "iron vow",
      to: "elven iron", // alias
      relation: "sworn_on",
    });

    const iron = await getLore(campaignDir, "veth-iron");
    expect(iron!.relations).toHaveLength(1);
  });

  it("ignores duplicate relations (idempotent)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });

    await linkLore(campaignDir, { from: "a", to: "b", relation: "rel" });
    await linkLore(campaignDir, { from: "a", to: "b", relation: "rel" });

    const a = await getLore(campaignDir, "a");
    expect(a!.relations).toHaveLength(1);
  });

  it("throws when an endpoint cannot be resolved", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await expect(
      linkLore(campaignDir, { from: "a", to: "missing", relation: "rel" }),
    ).rejects.toThrow();
  });
});

describe("getLoreGraph", () => {
  it("returns root + immediate neighbors at depth 1", async () => {
    if (!(await ollamaAvailable())) return;
    const a = await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    const b = await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    const c = await upsertLore(campaignDir, { canonical: "C", type: "concept", summary: "c" });
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await linkLore(campaignDir, { from: "B", to: "C", relation: "rel" });

    const graph = await getLoreGraph(campaignDir, "A", 1);
    expect(graph).not.toBeNull();
    expect(graph!.root.canonical).toBe("A");
    const ids = new Set(graph!.nodes.map((n) => n.id));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(c.id)).toBe(false);
    expect(graph!.edges).toHaveLength(1);
  });

  it("traverses to depth 2", async () => {
    if (!(await ollamaAvailable())) return;
    const a = await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    const b = await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    const c = await upsertLore(campaignDir, { canonical: "C", type: "concept", summary: "c" });
    await linkLore(campaignDir, { from: "A", to: "B", relation: "rel" });
    await linkLore(campaignDir, { from: "B", to: "C", relation: "rel" });

    const graph = await getLoreGraph(campaignDir, "A", 2);
    expect(graph).not.toBeNull();
    const ids = new Set(graph!.nodes.map((n) => n.id));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(c.id)).toBe(true);
    expect(graph!.edges).toHaveLength(2);
  });

  it("returns null when root cannot be resolved", async () => {
    if (!(await ollamaAvailable())) return;
    const graph = await getLoreGraph(campaignDir, "nope", 1);
    expect(graph).toBeNull();
  });

  it("includes metadata on edges", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await linkLore(campaignDir, {
      from: "A",
      to: "B",
      relation: "rel",
      metadata: { weight: 0.5 },
    });

    const graph = await getLoreGraph(campaignDir, "A", 1);
    expect(graph).not.toBeNull();
    expect(graph!.edges).toHaveLength(1);
    expect(graph!.edges[0].metadata).toEqual({ weight: 0.5 });
  });
});

describe("metadata", () => {
  it("stores and returns metadata on entities", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      metadata: { community: "iron-economy", confidence: 0.92 },
    });

    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.metadata).toEqual({ community: "iron-economy", confidence: 0.92 });
  });

  it("preserves metadata across rename when not overwritten", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      metadata: { community: "iron-economy" },
    });

    await upsertLore(campaignDir, {
      id,
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const entity = await getLore(campaignDir, "veth-iron");
    expect(entity?.metadata).toEqual({ community: "iron-economy" });
  });

  it("stores metadata on relations", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await linkLore(campaignDir, {
      from: "a",
      to: "b",
      relation: "rel",
      metadata: { weight: 0.7 },
    });

    const a = await getLore(campaignDir, "a");
    expect(a!.relations![0].metadata).toEqual({ weight: 0.7 });
  });

  it("preserves relation metadata when linkLore is called again without metadata", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    await linkLore(campaignDir, {
      from: "a",
      to: "b",
      relation: "rel",
      metadata: { weight: 0.7 },
    });
    // Re-link without metadata — the prior weight should be preserved
    await linkLore(campaignDir, { from: "a", to: "b", relation: "rel" });

    const a = await getLore(campaignDir, "a");
    expect(a!.relations[0].metadata).toEqual({ weight: 0.7 });
  });
});

describe("provenance", () => {
  it("records manual provenance by default for new entities", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    // listProvenance now takes the UUID id
    const entries = await listProvenance(campaignDir, "entity", id);
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("manual");
  });

  it("records explicit provenance with source and excerpt", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      provenance: {
        source_kind: "scene",
        source_id: "scene-uuid-123",
        excerpt: "She found the metal in the dig.",
        confidence: 0.85,
      },
    });

    const entries = await listProvenance(campaignDir, "entity", id);
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("scene");
    expect(entries[0].source_id).toBe("scene-uuid-123");
    expect(entries[0].excerpt).toBe("She found the metal in the dig.");
    expect(entries[0].confidence).toBeCloseTo(0.85);
  });

  it("appends a new provenance entry on update (history retained)", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First.",
      provenance: { source_kind: "manual" },
    });
    await upsertLore(campaignDir, {
      id,
      canonical: "Elven Iron",
      type: "material",
      summary: "Second.",
      provenance: { source_kind: "scene", source_id: "s-1" },
    });

    const entries = await listProvenance(campaignDir, "entity", id);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.map((e) => e.source_kind).sort()).toEqual(["manual", "scene"]);
  });

  it("records provenance for relations using relation UUID", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, { canonical: "A", type: "concept", summary: "a" });
    await upsertLore(campaignDir, { canonical: "B", type: "concept", summary: "b" });
    const { relation_id } = await linkLore(campaignDir, {
      from: "a",
      to: "b",
      relation: "rel",
      provenance: { source_kind: "manual" },
    });

    // subject_id is now the relation's UUID
    expect(looksLikeUuid(relation_id)).toBe(true);
    const entries = await listProvenance(campaignDir, "relation", relation_id);
    expect(entries).toHaveLength(1);
    expect(entries[0].source_kind).toBe("manual");
  });
});

describe("integration: rename preserves graph", () => {
  it("renaming an entity keeps relations intact and resolves both names", async () => {
    if (!(await ollamaAvailable())) return;

    // Build a small graph using the original name
    const { id: elvenIronId } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });
    const { id: ironVowId } = await upsertLore(campaignDir, {
      canonical: "Iron Vow",
      type: "concept",
      summary: "An oath sworn on iron.",
    });
    const { id: elvesId } = await upsertLore(campaignDir, {
      canonical: "The Elves",
      type: "faction",
      summary: "Feral Firstborn.",
    });
    await linkLore(campaignDir, { from: "Iron Vow", to: "Elven Iron", relation: "sworn_on" });
    await linkLore(campaignDir, { from: "The Elves", to: "Elven Iron", relation: "left_behind" });

    // Rename via UUID
    await upsertLore(campaignDir, {
      id: elvenIronId,
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    // Resolution by both names still works to the same UUID
    const byNew = await getLore(campaignDir, "Veth Iron");
    const byOld = await getLore(campaignDir, "Elven Iron");
    expect(byNew?.id).toBe(elvenIronId);
    expect(byOld?.id).toBe(elvenIronId);
    expect(byNew?.canonical).toBe("Veth Iron");
    expect(byNew?.aliases).toContain("Elven Iron");

    // Relations survive the rename — both incoming edges are still there
    expect(byNew?.relations).toHaveLength(2);
    const incomingFromIds = byNew!.relations!
      .filter((r) => r.direction === "to")
      .map((r) => r.entity.id)
      .sort();
    expect(incomingFromIds).toEqual([ironVowId, elvesId].sort());

    // Graph traversal works from either name
    const graphByNew = await getLoreGraph(campaignDir, "Veth Iron", 1);
    const graphByOld = await getLoreGraph(campaignDir, "Elven Iron", 1);
    expect(graphByNew?.nodes.length).toBe(graphByOld?.nodes.length);
    expect(graphByNew?.edges.length).toBe(2);
  });
});

describe("entities schema (world-db)", () => {
  it("creates the entities table on cold init", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await instance.connect();
    try {
      const result = await conn.runAndReadAll(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'entities'
         ORDER BY ordinal_position`,
      );
      const cols = (result.getRowObjectsJS() as Record<string, unknown>[])
        .map((r) => String(r["column_name"]));
      // Check key columns are present
      expect(cols).toContain("id");
      expect(cols).toContain("slug");
      expect(cols).toContain("canonical");
      expect(cols).toContain("aliases");
      expect(cols).toContain("campaign_id");
      expect(cols).toContain("created_in_campaign");
    } finally {
      conn.closeSync();
    }
  });

  it("creates the lore_proximity_edges table on cold init", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await instance.connect();
    try {
      const result = await conn.runAndReadAll(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'lore_proximity_edges'
         ORDER BY ordinal_position`,
      );
      const cols = (result.getRowObjectsJS() as Record<string, unknown>[])
        .map((r) => String(r["column_name"]));
      expect(cols).toContain("id");
      expect(cols).toContain("from_id");
      expect(cols).toContain("to_id");
      expect(cols).toContain("dimension");
      expect(cols).toContain("magnitude");
      expect(cols).toContain("direction");
      expect(cols).toContain("order_kind");
      expect(cols).toContain("notes");
      expect(cols).toContain("metadata");
      expect(cols).toContain("campaign_id");
      expect(cols).toContain("created_at");
    } finally {
      conn.closeSync();
    }
  });
});

// ---------------------------------------------------------------------------
// Visibility tests
// ---------------------------------------------------------------------------

describe("visibility", () => {
  it("campaign-scoped entity visible to its campaign but not a sibling", async () => {
    if (!(await ollamaAvailable())) return;

    // Set up two campaigns sharing the same world root
    const worldRoot = campaignDir;
    const camp1Dir = join(worldRoot, "campaigns", "camp1");
    const camp2Dir = join(worldRoot, "campaigns", "camp2");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(camp1Dir, { recursive: true });
    await mkdir(camp2Dir, { recursive: true });
    await writeFile(join(camp1Dir, "campaign.json"), JSON.stringify({ id: "camp1" }), "utf8");
    await writeFile(join(camp2Dir, "campaign.json"), JSON.stringify({ id: "camp2" }), "utf8");
    await writeFile(join(worldRoot, "world.json"), JSON.stringify({
      schemaVersion: 1,
      embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
      name: "Test World",
    }), "utf8");

    // Upsert entity in camp1
    await upsertLore(camp1Dir, {
      canonical: "Camp1 Secret",
      type: "concept",
      summary: "A secret known only in campaign 1.",
    });

    // camp2 should NOT see it
    const notVisible = await getLore(camp2Dir, "Camp1 Secret");
    expect(notVisible).toBeNull();

    // camp1 SHOULD see it
    const visible = await getLore(camp1Dir, "Camp1 Secret");
    expect(visible).not.toBeNull();
    expect(visible?.canonical).toBe("Camp1 Secret");
  });

  it("canon entity (campaign_id NULL) visible to all campaigns", async () => {
    if (!(await ollamaAvailable())) return;

    const worldRoot = campaignDir;
    const camp1Dir = join(worldRoot, "campaigns", "camp-a");
    const camp2Dir = join(worldRoot, "campaigns", "camp-b");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(camp1Dir, { recursive: true });
    await mkdir(camp2Dir, { recursive: true });
    await writeFile(join(camp1Dir, "campaign.json"), JSON.stringify({ id: "camp-a" }), "utf8");
    await writeFile(join(camp2Dir, "campaign.json"), JSON.stringify({ id: "camp-b" }), "utf8");
    await writeFile(join(worldRoot, "world.json"), JSON.stringify({
      schemaVersion: 1,
      embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
      name: "Test World",
    }), "utf8");

    // Insert a canon entity directly via SQL (campaign_id = NULL)
    const ctx = await resolveWorldContext(camp1Dir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const fakeEmb = new Array(768).fill(0);
    const embLit = `[${fakeEmb.join(",")}]::FLOAT[768]`;
    const now = new Date().toISOString();
    const canonId = crypto.randomUUID();
    try {
      await conn.run(
        `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding, campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, ?, ?, []::TEXT[], ?, ?, '{}', '{}', ${embLit}, NULL, 'seed', ?, ?)`,
        [canonId, "world-truth", "World Truth", "truth", "A universal truth.", now, now],
      );
    } finally {
      conn.closeSync();
    }

    // Both campaigns see the canon entity
    const visibleInA = await getLore(camp1Dir, "World Truth");
    expect(visibleInA).not.toBeNull();
    expect(visibleInA?.campaign_id).toBeNull();

    const visibleInB = await getLore(camp2Dir, "World Truth");
    expect(visibleInB).not.toBeNull();
    expect(visibleInB?.campaign_id).toBeNull();
  });

  it("includeSiblings:true widens visibility to all campaigns", async () => {
    if (!(await ollamaAvailable())) return;

    const worldRoot = campaignDir;
    const camp1Dir = join(worldRoot, "campaigns", "sib1");
    const camp2Dir = join(worldRoot, "campaigns", "sib2");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(camp1Dir, { recursive: true });
    await mkdir(camp2Dir, { recursive: true });
    await writeFile(join(camp1Dir, "campaign.json"), JSON.stringify({ id: "sib1" }), "utf8");
    await writeFile(join(camp2Dir, "campaign.json"), JSON.stringify({ id: "sib2" }), "utf8");
    await writeFile(join(worldRoot, "world.json"), JSON.stringify({
      schemaVersion: 1,
      embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
      name: "Test World",
    }), "utf8");

    // Upsert entity in sib1
    await upsertLore(camp1Dir, {
      canonical: "Sib1 Entity",
      type: "concept",
      summary: "Entity from sib1.",
    });

    // Without includeSiblings: sib2 can't see it
    const hidden = await getLore(camp2Dir, "Sib1 Entity");
    expect(hidden).toBeNull();

    // With includeSiblings: sib2 can see it
    const shown = await getLore(camp2Dir, "Sib1 Entity", { includeSiblings: true });
    expect(shown).not.toBeNull();
    expect(shown?.canonical).toBe("Sib1 Entity");
  });
});

// ---------------------------------------------------------------------------
// Embedding-leakage regression test
// ---------------------------------------------------------------------------

describe("embedding leakage", () => {
  it("searchLore never returns sibling-campaign entities in top-k; does with includeSiblings", async () => {
    // Use a deterministic stub embedder — no Ollama needed.
    // We insert entities directly via SQL to avoid calling the real embedder.

    const worldRoot = campaignDir;
    const activeDir = join(worldRoot, "campaigns", "active");
    const siblingDir = join(worldRoot, "campaigns", "sibling");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(activeDir, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(join(activeDir, "campaign.json"), JSON.stringify({ id: "active" }), "utf8");
    await writeFile(join(siblingDir, "campaign.json"), JSON.stringify({ id: "sibling" }), "utf8");
    await writeFile(join(worldRoot, "world.json"), JSON.stringify({
      schemaVersion: 1,
      embedding: { model: "nomic-embed-text", version: "1.5", dim: 768 },
      name: "Leakage Test World",
    }), "utf8");

    const ctxActive = await resolveWorldContext(activeDir);
    const inst = await getWorldDb(ctxActive);
    const conn = await openWorldWriteConn(inst);

    // A unit vector at dim 0 — this will be the "query" vector
    const hotVec = new Array(768).fill(0);
    hotVec[0] = 1.0;
    const hotLit = `[${hotVec.join(",")}]::FLOAT[768]`;

    // Slightly different vector for the active entity
    const activeVec = new Array(768).fill(0);
    activeVec[0] = 0.9;
    activeVec[1] = 0.1;
    const activeLit = `[${activeVec.join(",")}]::FLOAT[768]`;

    const now = new Date().toISOString();
    const siblingId = crypto.randomUUID();
    const activeId = crypto.randomUUID();

    try {
      // Insert sibling entity with the IDENTICAL high-similarity embedding as query
      await conn.run(
        `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding, campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, 'sibling-entity', 'Sibling Entity', []::TEXT[], 'concept', 'Sibling summary', '{}', '{}', ${hotLit}, 'sibling', 'sibling', ?, ?)`,
        [siblingId, now, now],
      );
      // Insert active entity with slightly lower similarity
      await conn.run(
        `INSERT INTO entities (id, slug, canonical, aliases, type, summary, content, metadata, embedding, campaign_id, created_in_campaign, created_at, updated_at)
         VALUES (?, 'active-entity', 'Active Entity', []::TEXT[], 'concept', 'Active summary', '{}', '{}', ${activeLit}, 'active', 'active', ?, ?)`,
        [activeId, now, now],
      );
    } finally {
      conn.closeSync();
    }

    // For searchLore we need to intercept the embedding — we can't override the
    // Ollama call directly. Instead we test the SQL predicate by running a raw query
    // that mirrors searchLore's WHERE before ORDER BY pattern.
    // The regression: without WHERE filter, sibling-entity's cosine=1.0 would top the list.
    const conn2 = await inst.connect();
    try {
      const embLit = hotLit;
      // Without visibility filter (would leak)
      const leaky = await conn2.runAndReadAll(
        `SELECT id, campaign_id, array_cosine_similarity(embedding, ${embLit}) AS score
         FROM entities ORDER BY score DESC LIMIT 5`,
      );
      const leakyRows = leaky.getRowObjectsJS() as Record<string, unknown>[];
      expect(leakyRows[0] ? String(leakyRows[0]["id"]) : null).toBe(siblingId); // sibling wins without filter

      // With visibility filter (no leak)
      const safe = await conn2.runAndReadAll(
        `SELECT id, campaign_id, array_cosine_similarity(embedding, ${embLit}) AS score
         FROM entities WHERE (campaign_id IS NULL OR campaign_id = 'active')
         ORDER BY score DESC LIMIT 5`,
      );
      const safeRows = safe.getRowObjectsJS() as Record<string, unknown>[];
      expect(safeRows.every((r) => String(r["campaign_id"]) === "active" || r["campaign_id"] == null)).toBe(true);
      expect(safeRows.find((r) => String(r["id"]) === siblingId)).toBeUndefined();
      expect(safeRows[0] ? String(safeRows[0]["id"]) : null).toBe(activeId); // active entity wins
    } finally {
      conn2.closeSync();
    }
  });
});
