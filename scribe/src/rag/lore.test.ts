import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { upsertLore, getLore } from "./lore.js";
import { searchLore } from "./lore.js";

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
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-lore-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

describe("upsertLore + getLore", () => {
  it("creates an entity and retrieves it by ID", async () => {
    if (!(await ollamaAvailable())) return;
    const { id } = await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron excavated from elven ruins. Tracks broken vows.",
    });
    expect(id).toBe("elven-iron");

    const entity = await getLore(campaignDir, id);
    expect(entity).not.toBeNull();
    expect(entity!.canonical).toBe("Elven Iron");
    expect(entity!.type).toBe("material");
    expect(entity!.aliases).toEqual([]);
    expect(entity!.content).toEqual({});
  });

  it("resolves by canonical name (case-insensitive)", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const byCanonical = await getLore(campaignDir, "Elven Iron");
    expect(byCanonical?.id).toBe("elven-iron");

    const byMixedCase = await getLore(campaignDir, "elven IRON");
    expect(byMixedCase?.id).toBe("elven-iron");
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
  it("updates existing entity in place", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "First version.",
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Elven Iron",
      type: "material",
      summary: "Second version with more detail.",
    });

    expect(result.updated).toBe(true);
    const entity = await getLore(campaignDir, "elven-iron");
    expect(entity?.summary).toBe("Second version with more detail.");
    expect(result.aliases).toEqual([]);
  });

  it("moves old canonical to aliases on rename", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
      canonical: "Veth Iron",
      type: "material",
      summary: "Iron from elven ruins.",
    });

    expect(result.updated).toBe(true);
    expect(result.canonical).toBe("Veth Iron");
    expect(result.aliases).toContain("Elven Iron");

    // Both names still resolve
    const byOld = await getLore(campaignDir, "elven iron");
    const byNew = await getLore(campaignDir, "Veth Iron");
    expect(byOld?.id).toBe("elven-iron");
    expect(byNew?.id).toBe("elven-iron");
  });

  it("merges new aliases with existing without duplicating", async () => {
    if (!(await ollamaAvailable())) return;
    await upsertLore(campaignDir, {
      canonical: "Elven Iron",
      type: "material",
      summary: "Iron from elven ruins.",
      aliases: ["elf-iron"],
    });

    const result = await upsertLore(campaignDir, {
      id: "elven-iron",
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
