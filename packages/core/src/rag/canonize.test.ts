import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import {
  rankCanonizeCandidates,
  listCanonizeCandidates,
  type EntityCandidateInput,
  type RelationCandidateInput,
} from "./canonize.js";

// ---------------------------------------------------------------------------
// Pure ranking tests — no DB, mirrors buildContradictionsSection's pure-render split.
// ---------------------------------------------------------------------------

function entityInput(overrides: Partial<EntityCandidateInput> = {}): EntityCandidateInput {
  return {
    id: crypto.randomUUID(),
    name: "Bridgekeeper",
    type: "person",
    summary: "keeps the bridge",
    scene_spread: 0,
    relation_degree: 0,
    ...overrides,
  };
}

function relationInput(overrides: Partial<RelationCandidateInput> = {}): RelationCandidateInput {
  return {
    id: crypto.randomUUID(),
    label: "ALLY_OF",
    from_id: crypto.randomUUID(),
    from_name: "Kira",
    to_id: crypto.randomUUID(),
    to_name: "Warden",
    scene_spread: 0,
    ...overrides,
  };
}

describe("rankCanonizeCandidates", () => {
  it("scores entities by scene_spread*2 + relation_degree", () => {
    const [ranked] = rankCanonizeCandidates(
      [entityInput({ scene_spread: 3, relation_degree: 2 })],
      [],
    );
    expect(ranked!.score).toBe(3 * 2 + 2);
  });

  it("scores relations by scene_spread*2 only", () => {
    const [ranked] = rankCanonizeCandidates([], [relationInput({ scene_spread: 4 })]);
    expect(ranked!.score).toBe(4 * 2);
  });

  it("sorts entities and relations together, highest score first", () => {
    const low = entityInput({ id: "low", scene_spread: 1, relation_degree: 0 });
    const high = relationInput({ id: "high", scene_spread: 5 });
    const mid = entityInput({ id: "mid", scene_spread: 1, relation_degree: 3 });
    const ranked = rankCanonizeCandidates([low, mid], [high]);
    expect(ranked.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("caps output at the given limit", () => {
    const entities = Array.from({ length: 9 }, (_, i) =>
      entityInput({ id: `e${i}`, scene_spread: 9 - i }),
    );
    const ranked = rankCanonizeCandidates(entities, [], 5);
    expect(ranked.length).toBe(5);
    expect(ranked.map((c) => c.id)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
  });

  it("marks a candidate blocked when blocked_reason is present, and passes the reason through", () => {
    const [ranked] = rankCanonizeCandidates(
      [entityInput({ blocked_reason: "unresolved entity_summary_divergence (contradiction abc)" })],
      [],
    );
    expect(ranked!.blocked).toBe(true);
    expect(ranked!.blocked_reason).toBe("unresolved entity_summary_divergence (contradiction abc)");
  });

  it("leaves a candidate unblocked when no blocked_reason is given", () => {
    const [ranked] = rankCanonizeCandidates([entityInput()], []);
    expect(ranked!.blocked).toBe(false);
    expect(ranked!.blocked_reason).toBeUndefined();
  });

  it("returns an empty array when there are no candidates", () => {
    expect(rankCanonizeCandidates([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-integration tests for listCanonizeCandidates
// ---------------------------------------------------------------------------

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-canonize-test-"));
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

async function insertEntity(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: { id: string; canonical: string; type?: string; summary?: string; campaignId: string | null },
): Promise<void> {
  const emb = [1.0, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO entities
       (id, slug, canonical, aliases, type, summary, content, metadata, embedding,
        campaign_id, created_in_campaign, created_at, updated_at)
     VALUES (?, ?, ?, [], ?, ?, '{}', '{}', ${embLiteral}, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.canonical.toLowerCase().replace(/\s+/g, "-"),
      opts.canonical,
      opts.type ?? "person",
      opts.summary ?? "a stub entity",
      opts.campaignId,
      opts.campaignId ?? "canon-origin",
      now,
      now,
    ],
  );
}

async function insertRelation(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: { id: string; fromId: string; toId: string; label: string; campaignId: string | null; invalidAt?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO relations
       (id, from_entity, to_entity, label, notes, metadata, campaign_id, valid_at, invalid_at, created_at)
     VALUES (?, ?, ?, ?, NULL, '{}', ?, NULL, ?, ?)`,
    [opts.id, opts.fromId, opts.toId, opts.label, opts.campaignId, opts.invalidAt ?? null, now],
  );
}

async function insertScene(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: { id: string; campaignId: string; text?: string },
): Promise<void> {
  const emb = [1.0, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO scenes (id, campaign_id, place_entity, text, embedding, kind, timestamp)
     VALUES (?, ?, NULL, ?, ${embLiteral}, 'scene', ?)`,
    [opts.id, opts.campaignId, opts.text ?? "a scene", now],
  );
}

async function insertSceneEntityRef(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  sceneId: string,
  entityId: string,
): Promise<void> {
  await conn.run(
    `INSERT INTO scene_entity_refs (scene_id, entity_id, role) VALUES (?, ?, 'present')`,
    [sceneId, entityId],
  );
}

async function insertContradiction(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: {
    id: string;
    kind: "entity_summary_divergence" | "relation_label_conflict";
    entityId?: string;
    relationId?: string;
    conflictingRelationId?: string;
    campaignId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO contradictions
       (id, kind, entity_id, relation_id, conflicting_relation_id, existing_value, incoming_value, campaign_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'old', 'new', ?, ?)`,
    [opts.id, opts.kind, opts.entityId ?? null, opts.relationId ?? null, opts.conflictingRelationId ?? null, opts.campaignId, now],
  );
}

describe("listCanonizeCandidates", () => {
  it("only surfaces entities scoped to the current campaign — excludes canon and sibling-campaign rows", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const campaignScoped = crypto.randomUUID();
    const alreadyCanon = crypto.randomUUID();
    const siblingScoped = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: campaignScoped, canonical: "Campaign Local", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: alreadyCanon, canonical: "Already Canon", campaignId: null });
      await insertEntity(conn, { id: siblingScoped, canonical: "Sibling Only", campaignId: "some-other-campaign" });
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(campaignScoped);
    expect(ids).not.toContain(alreadyCanon);
    expect(ids).not.toContain(siblingScoped);
  });

  it("ranks an entity higher when it appears in more distinct scenes, and computes relationDegree", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const popular = crypto.randomUUID();
    const quiet = crypto.randomUUID();
    const linkedTo = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: popular, canonical: "Popular", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: quiet, canonical: "Quiet", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: linkedTo, canonical: "Linked Target", campaignId: null });

      const scene1 = crypto.randomUUID();
      const scene2 = crypto.randomUUID();
      await insertScene(conn, { id: scene1, campaignId: ctx.campaignId });
      await insertScene(conn, { id: scene2, campaignId: ctx.campaignId });
      await insertSceneEntityRef(conn, scene1, popular);
      await insertSceneEntityRef(conn, scene2, popular);
      await insertSceneEntityRef(conn, scene1, quiet);

      await insertRelation(conn, {
        id: crypto.randomUUID(), fromId: popular, toId: linkedTo, label: "KNOWS", campaignId: ctx.campaignId,
      });
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir);
    const popularC = candidates.find((c) => c.id === popular);
    const quietC = candidates.find((c) => c.id === quiet);
    expect(popularC).toBeDefined();
    expect(quietC).toBeDefined();
    if (popularC?.kind === "entity" && quietC?.kind === "entity") {
      expect(popularC.scene_spread).toBe(2);
      expect(popularC.relation_degree).toBe(1);
      expect(quietC.scene_spread).toBe(1);
      expect(quietC.relation_degree).toBe(0);
    }
    expect(candidates.findIndex((c) => c.id === popular)).toBeLessThan(
      candidates.findIndex((c) => c.id === quiet),
    );
  });

  it("surfaces campaign-scoped relations with resolved endpoint names, excluding invalidated ones", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const activeRel = crypto.randomUUID();
    const invalidRel = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: fromId, canonical: "Kira", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: toId, canonical: "Warden", campaignId: ctx.campaignId });
      await insertRelation(conn, { id: activeRel, fromId, toId, label: "ALLY_OF", campaignId: ctx.campaignId });
      await insertRelation(conn, {
        id: invalidRel, fromId, toId, label: "ENEMY_OF", campaignId: ctx.campaignId,
        invalidAt: new Date().toISOString(),
      });
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir);
    const relCandidate = candidates.find((c) => c.id === activeRel);
    expect(relCandidate).toBeDefined();
    expect(candidates.find((c) => c.id === invalidRel)).toBeUndefined();
    if (relCandidate?.kind === "relation") {
      expect(relCandidate.from_name).toBe("Kira");
      expect(relCandidate.to_name).toBe("Warden");
      expect(relCandidate.label).toBe("ALLY_OF");
    }
  });

  it("blocks an entity candidate touched by an open contradiction, with a reason", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const entityId = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: entityId, canonical: "Disputed", campaignId: ctx.campaignId });
      await insertContradiction(conn, {
        id: crypto.randomUUID(), kind: "entity_summary_divergence", entityId, campaignId: ctx.campaignId,
      });
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir);
    const candidate = candidates.find((c) => c.id === entityId);
    expect(candidate).toBeDefined();
    expect(candidate!.blocked).toBe(true);
    expect(candidate!.blocked_reason).toContain("entity_summary_divergence");
  });

  it("blocks a relation candidate referenced as either relation_id or conflicting_relation_id, and leaves resolved ones unblocked", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const newRel = crypto.randomUUID();
    const conflictingRel = crypto.randomUUID();
    const unrelatedRel = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: fromId, canonical: "Kira", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: toId, canonical: "Warden", campaignId: ctx.campaignId });
      const toId2 = crypto.randomUUID();
      await insertEntity(conn, { id: toId2, canonical: "Bystander", campaignId: ctx.campaignId });
      await insertRelation(conn, { id: newRel, fromId, toId, label: "ALLY_OF", campaignId: ctx.campaignId });
      await insertRelation(conn, { id: conflictingRel, fromId, toId, label: "ENEMY_OF", campaignId: ctx.campaignId, invalidAt: new Date().toISOString() });
      await insertRelation(conn, { id: unrelatedRel, fromId, toId: toId2, label: "MET", campaignId: ctx.campaignId });
      await insertContradiction(conn, {
        id: crypto.randomUUID(), kind: "relation_label_conflict",
        relationId: newRel, conflictingRelationId: conflictingRel, campaignId: ctx.campaignId,
      });
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir);
    const newRelCandidate = candidates.find((c) => c.id === newRel);
    const unrelatedCandidate = candidates.find((c) => c.id === unrelatedRel);
    expect(newRelCandidate).toBeDefined();
    expect(newRelCandidate!.blocked).toBe(true);
    expect(unrelatedCandidate).toBeDefined();
    expect(unrelatedCandidate!.blocked).toBe(false);
  });

  it("respects the limit option", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const instance = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(instance);
    try {
      for (let i = 0; i < 5; i++) {
        await insertEntity(conn, { id: crypto.randomUUID(), canonical: `Entity ${i}`, campaignId: ctx.campaignId });
      }
    } finally {
      conn.closeSync();
    }

    const candidates = await listCanonizeCandidates(campaignDir, { limit: 2 });
    expect(candidates.length).toBe(2);
  });

  it("returns an empty array when the campaign has no campaign-scoped entities or relations", async () => {
    const candidates = await listCanonizeCandidates(campaignDir);
    expect(candidates).toEqual([]);
  });
});
