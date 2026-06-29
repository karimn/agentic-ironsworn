import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import {
  checkEntityContradiction,
  checkRelationContradiction,
  listContradictions,
  listOpenContradictions,
  resolveContradiction,
  type ContradictionFlag,
} from "./contradictions.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-contradiction-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

// Insert an entity row with a crafted embedding (no Ollama needed).
// embeddingFirstVal is placed at position 0; all other dims are 0.
// Cosine similarity between [a,0,...] and [b,0,...] = sign(a*b).
async function insertEntity(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  campaignId: string,
  opts: { id: string; summary: string; embeddingFirstVal: number; slug?: string },
): Promise<void> {
  const emb = [opts.embeddingFirstVal, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const slug = opts.slug ?? "test-entity";
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO entities
       (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
        campaign_id, created_in_campaign, created_at, updated_at)
     VALUES (?, ?, 'Test Entity', [], 'person', ?, '{}', '{}', ${embLiteral}, ?, ?, ?, ?)`,
    [opts.id, slug, opts.summary, campaignId, campaignId, now, now],
  );
}

// Insert stub entity rows so FK-adjacent queries can join them.
async function insertStubEntities(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  campaignId: string,
  ids: [string, string][],  // [id, slug] pairs
): Promise<void> {
  const emb = [1.0, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  for (const [eid, slug] of ids) {
    await conn.run(
      `INSERT INTO entities
         (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
          campaign_id, created_in_campaign, created_at, updated_at)
       VALUES (?, ?, ?, [], 'person', 'stub', '{}', '{}', ${embLiteral}, ?, ?, ?, ?)`,
      [eid, slug, slug, campaignId, campaignId, now, now],
    );
  }
}

// Insert a relation row directly.
async function insertRelation(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: {
    id: string;
    fromId: string;
    toId: string;
    label: string;
    campaignId: string;
    invalidAt?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO relations
       (id, from_entity, to_entity, label, notes, metadata, campaign_id, valid_at, invalid_at, created_at)
     VALUES (?, ?, ?, ?, NULL, '{}', ?, NULL, ?, ?)`,
    [opts.id, opts.fromId, opts.toId, opts.label, opts.campaignId, opts.invalidAt ?? null, now],
  );
}

describe("checkEntityContradiction", () => {
  it("returns a flag when new summary embedding is orthogonal to existing (sim ≈ 0)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const entityId = crypto.randomUUID();
      // stored embedding: [1, 0, 0, ...]
      await insertEntity(conn, ctx.campaignId, {
        id: entityId,
        summary: "A healer in Caldren",
        embeddingFirstVal: 1.0,
      });

      // new embedding: [0, 1, 0, ...] → cosine sim = 0 (orthogonal)
      const newEmb = [0.0, 1.0, ...Array(766).fill(0.0)];
      const flag = await checkEntityContradiction(conn, {
        entityId,
        newEmbedding: newEmb,
        existingSummary: "A healer in Caldren",
        incomingSummary: "A blacksmith in the capital",
        campaignId: ctx.campaignId,
      });

      expect(flag).not.toBeNull();
      expect(flag!.kind).toBe("entity_summary_divergence");
      expect(flag!.entity_id).toBe(entityId);
      expect(flag!.existing_value).toBe("A healer in Caldren");
      expect(flag!.incoming_value).toBe("A blacksmith in the capital");
      expect(flag!.similarity).toBeCloseTo(0, 5);
      expect(flag!.resolved_at).toBeUndefined();
      expect(flag!.id).toBeDefined();
      expect(flag!.created_at).toBeDefined();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when new embedding is identical to existing (sim = 1.0)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const entityId = crypto.randomUUID();
      // stored embedding: [1, 0, ...]
      await insertEntity(conn, ctx.campaignId, {
        id: entityId,
        summary: "A healer in Caldren",
        embeddingFirstVal: 1.0,
        slug: "test-entity-2",
      });

      // new embedding: same direction → cosine sim = 1.0 → no flag
      const newEmb = [1.0, ...Array(767).fill(0.0)];
      const flag = await checkEntityContradiction(conn, {
        entityId,
        newEmbedding: newEmb,
        existingSummary: "A healer in Caldren",
        incomingSummary: "A healer in Caldren (expanded)",
        campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });
});

describe("checkRelationContradiction", () => {
  it("returns a flag when an active A→B relation with a different label exists", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      const existingRelId = crypto.randomUUID();
      const newRelId = crypto.randomUUID();

      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-a"], [toId, "to-a"]]);
      await insertRelation(conn, {
        id: existingRelId, fromId, toId, label: "ENEMY_OF", campaignId: ctx.campaignId,
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "ALLY_OF", newRelationId: newRelId, campaignId: ctx.campaignId,
      });

      expect(flag).not.toBeNull();
      expect(flag!.kind).toBe("relation_label_conflict");
      expect(flag!.relation_id).toBe(newRelId);
      expect(flag!.conflicting_relation_id).toBe(existingRelId);
      expect(flag!.existing_value).toBe("ENEMY_OF");
      expect(flag!.incoming_value).toBe("ALLY_OF");
      expect(flag!.id).toBeDefined();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when the only existing A→B relation is already invalidated", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-b"], [toId, "to-b"]]);
      await insertRelation(conn, {
        id: crypto.randomUUID(), fromId, toId, label: "HOLDS_TITLE",
        campaignId: ctx.campaignId, invalidAt: new Date().toISOString(),
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "BANISHED_FROM",
        newRelationId: crypto.randomUUID(), campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });

  it("returns null when the only existing A→B relation has the same label (defensive case)", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      await insertStubEntities(conn, ctx.campaignId, [[fromId, "from-c"], [toId, "to-c"]]);
      await insertRelation(conn, {
        id: crypto.randomUUID(), fromId, toId, label: "ALLY_OF", campaignId: ctx.campaignId,
      });

      const flag = await checkRelationContradiction(conn, {
        fromId, toId, newLabel: "ALLY_OF",
        newRelationId: crypto.randomUUID(), campaignId: ctx.campaignId,
      });

      expect(flag).toBeNull();
    } finally {
      conn.closeSync();
    }
  });
});

describe("listContradictions + resolveContradiction", () => {
  it("listContradictions returns open flags and excludes resolved by default", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const openId = crypto.randomUUID();
    const resolvedId = crypto.randomUUID();
    try {
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'relation_label_conflict', 'A', 'B', ?, ?)`,
        [openId, ctx.campaignId, now],
      );
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at, resolved_at, resolution)
         VALUES (?, 'entity_summary_divergence', 'C', 'D', ?, ?, ?, 'confirmed coexistence')`,
        [resolvedId, ctx.campaignId, now, now],
      );
    } finally {
      conn.closeSync();
    }

    const openFlags = await listContradictions(campaignDir);
    expect(openFlags.length).toBe(1);
    expect(openFlags[0].id).toBe(openId);
    expect(openFlags[0].resolved_at).toBeUndefined();

    const allFlags = await listContradictions(campaignDir, { includeResolved: true });
    expect(allFlags.length).toBe(2);
  });

  it("listOpenContradictions enriches entity_summary_divergence with the entity's display name", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const entityId = crypto.randomUUID();
    const flagId = crypto.randomUUID();
    try {
      await insertEntity(conn, ctx.campaignId, {
        id: entityId,
        summary: "The keeper of the river bridge",
        embeddingFirstVal: 1.0,
        slug: "bridgekeeper",
      });
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, entity_id, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'entity_summary_divergence', ?, 'guards the bridge', 'burned the bridge', ?, ?)`,
        [flagId, entityId, ctx.campaignId, now],
      );
    } finally {
      conn.closeSync();
    }

    const open = await listOpenContradictions(campaignDir);
    expect(open.length).toBe(1);
    expect(open[0].id).toBe(flagId);
    expect(open[0].kind).toBe("entity_summary_divergence");
    expect(open[0].names).toContain("Test Entity");
    expect(open[0].existing_value).toBe("guards the bridge");
    expect(open[0].incoming_value).toBe("burned the bridge");
  });

  it("listOpenContradictions enriches relation_label_conflict with both endpoint names and excludes resolved", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const relId = crypto.randomUUID();
    const openFlagId = crypto.randomUUID();
    const resolvedFlagId = crypto.randomUUID();
    try {
      await insertStubEntities(conn, ctx.campaignId, [[fromId, "kira"], [toId, "warden"]]);
      await insertRelation(conn, {
        id: relId, fromId, toId, label: "ALLY_OF", campaignId: ctx.campaignId,
      });
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, relation_id, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'relation_label_conflict', ?, 'ENEMY_OF', 'ALLY_OF', ?, ?)`,
        [openFlagId, relId, ctx.campaignId, now],
      );
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, relation_id, existing_value, incoming_value, campaign_id, created_at, resolved_at)
         VALUES (?, 'relation_label_conflict', ?, 'X', 'Y', ?, ?, ?)`,
        [resolvedFlagId, relId, ctx.campaignId, now, now],
      );
    } finally {
      conn.closeSync();
    }

    const open = await listOpenContradictions(campaignDir);
    expect(open.length).toBe(1);
    expect(open[0].id).toBe(openFlagId);
    expect(open[0].names).toEqual(expect.arrayContaining(["kira", "warden"]));
  });

  it("resolveContradiction sets resolved_at and resolution on the row", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const flagId = crypto.randomUUID();
    try {
      const now = new Date().toISOString();
      await conn.run(
        `INSERT INTO contradictions
           (id, kind, existing_value, incoming_value, campaign_id, created_at)
         VALUES (?, 'relation_label_conflict', 'X', 'Y', ?, ?)`,
        [flagId, ctx.campaignId, now],
      );
    } finally {
      conn.closeSync();
    }

    await resolveContradiction(campaignDir, flagId, "facts coexist — ally and student simultaneously");

    const all = await listContradictions(campaignDir, { includeResolved: true });
    const flag = all.find((f) => f.id === flagId);
    expect(flag).toBeDefined();
    expect(flag!.resolved_at).toBeDefined();
    expect(flag!.resolution).toBe("facts coexist — ally and student simultaneously");
  });
});
