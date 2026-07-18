import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";
import { getCanonBriefing, campaignSceneCount } from "./canon-briefing.js";

let campaignDir: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-canon-briefing-test-"));
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

async function insertCommunity(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: { id: string; level: number; memberCount: number; summary: string; campaignId: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO lore_communities (id, level, parent_id, member_ids, member_count, summary, embedding, metadata, campaign_id, created_at, updated_at)
     VALUES (?, ?, NULL, []::TEXT[], ?, ?, NULL, '{}', ?, ?, ?)`,
    [opts.id, opts.level, opts.memberCount, opts.summary, opts.campaignId, now, now],
  );
}

async function insertScene(
  conn: Awaited<ReturnType<typeof openWorldWriteConn>>,
  opts: { id: string; campaignId: string },
): Promise<void> {
  const emb = [1.0, ...Array(767).fill(0.0)];
  const embLiteral = `[${emb.join(",")}]::FLOAT[768]`;
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO scenes (id, campaign_id, place_entity, text, embedding, kind, timestamp)
     VALUES (?, ?, NULL, 'a scene', ${embLiteral}, 'scene', ?)`,
    [opts.id, opts.campaignId, now],
  );
}

describe("getCanonBriefing", () => {
  it("only surfaces world-scoped (campaign_id IS NULL) entities — excludes this and sibling campaigns' overlay", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const canonId = crypto.randomUUID();
    const thisCampaignId = crypto.randomUUID();
    const siblingId = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: canonId, canonical: "World Canon Place", campaignId: null });
      await insertEntity(conn, { id: thisCampaignId, canonical: "This Campaign Only", campaignId: ctx.campaignId });
      await insertEntity(conn, { id: siblingId, canonical: "Sibling Only", campaignId: "some-other-campaign" });
    } finally {
      conn.closeSync();
    }

    const briefing = await getCanonBriefing(campaignDir);
    const ids = briefing.entities.map((e) => e.id);
    expect(ids).toContain(canonId);
    expect(ids).not.toContain(thisCampaignId);
    expect(ids).not.toContain(siblingId);
  });

  it("ranks entities by relation degree (world-canon relations only), highest first", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const hub = crypto.randomUUID();
    const quiet = crypto.randomUUID();
    const other1 = crypto.randomUUID();
    const other2 = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: hub, canonical: "Hub", campaignId: null });
      await insertEntity(conn, { id: quiet, canonical: "Quiet", campaignId: null });
      await insertEntity(conn, { id: other1, canonical: "Other1", campaignId: null });
      await insertEntity(conn, { id: other2, canonical: "Other2", campaignId: null });
      await insertRelation(conn, { id: crypto.randomUUID(), fromId: hub, toId: other1, label: "ALLY_OF", campaignId: null });
      await insertRelation(conn, { id: crypto.randomUUID(), fromId: hub, toId: other2, label: "ALLY_OF", campaignId: null });
    } finally {
      conn.closeSync();
    }

    const briefing = await getCanonBriefing(campaignDir);
    const hubEntity = briefing.entities.find((e) => e.id === hub);
    const quietEntity = briefing.entities.find((e) => e.id === quiet);
    expect(hubEntity).toBeDefined();
    expect(quietEntity).toBeDefined();
    expect(hubEntity!.relation_degree).toBe(2);
    expect(quietEntity!.relation_degree).toBe(0);
    expect(briefing.entities.findIndex((e) => e.id === hub)).toBeLessThan(
      briefing.entities.findIndex((e) => e.id === quiet),
    );
  });

  it("surfaces world-canon relations with resolved endpoint names, excluding invalidated and campaign-scoped ones", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const activeRel = crypto.randomUUID();
    const invalidRel = crypto.randomUUID();
    const campaignRel = crypto.randomUUID();
    try {
      await insertEntity(conn, { id: fromId, canonical: "Kira", campaignId: null });
      await insertEntity(conn, { id: toId, canonical: "Warden", campaignId: null });
      await insertRelation(conn, { id: activeRel, fromId, toId, label: "ALLY_OF", campaignId: null });
      await insertRelation(conn, {
        id: invalidRel, fromId, toId, label: "ENEMY_OF", campaignId: null,
        invalidAt: new Date().toISOString(),
      });
      await insertRelation(conn, { id: campaignRel, fromId, toId, label: "MET", campaignId: ctx.campaignId });
    } finally {
      conn.closeSync();
    }

    const briefing = await getCanonBriefing(campaignDir);
    const relCandidate = briefing.relations.find((r) => r.id === activeRel);
    expect(relCandidate).toBeDefined();
    expect(relCandidate!.from_name).toBe("Kira");
    expect(relCandidate!.to_name).toBe("Warden");
    expect(briefing.relations.find((r) => r.id === invalidRel)).toBeUndefined();
    expect(briefing.relations.find((r) => r.id === campaignRel)).toBeUndefined();
  });

  it("surfaces world-canon communities only, ordered by level then member_count", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    const broad = crypto.randomUUID();
    const narrow = crypto.randomUUID();
    const campaignScoped = crypto.randomUUID();
    try {
      await insertCommunity(conn, { id: broad, level: 1, memberCount: 10, summary: "The whole fungal-iron network.", campaignId: null });
      await insertCommunity(conn, { id: narrow, level: 0, memberCount: 3, summary: "A single faction.", campaignId: null });
      await insertCommunity(conn, { id: campaignScoped, level: 0, memberCount: 2, summary: "This campaign's own cluster.", campaignId: ctx.campaignId });
    } finally {
      conn.closeSync();
    }

    const briefing = await getCanonBriefing(campaignDir);
    const ids = briefing.communities.map((c) => c.id);
    expect(ids).toContain(broad);
    expect(ids).toContain(narrow);
    expect(ids).not.toContain(campaignScoped);
    expect(ids.indexOf(broad)).toBeLessThan(ids.indexOf(narrow));
  });

  it("respects entityLimit/relationLimit/communityLimit options", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    try {
      for (let i = 0; i < 5; i++) {
        await insertEntity(conn, { id: crypto.randomUUID(), canonical: `Entity ${i}`, campaignId: null });
      }
      for (let i = 0; i < 5; i++) {
        await insertCommunity(conn, { id: crypto.randomUUID(), level: 0, memberCount: i, summary: `c${i}`, campaignId: null });
      }
    } finally {
      conn.closeSync();
    }
    void ctx;

    const briefing = await getCanonBriefing(campaignDir, { entityLimit: 2, communityLimit: 3 });
    expect(briefing.entities.length).toBe(2);
    expect(briefing.communities.length).toBe(3);
  });

  it("returns empty arrays when the world has no canon yet (fresh world, not just a fresh campaign)", async () => {
    const briefing = await getCanonBriefing(campaignDir);
    expect(briefing).toEqual({ entities: [], relations: [], communities: [] });
  });
});

describe("campaignSceneCount", () => {
  it("returns 0 for a campaign with no recorded scenes", async () => {
    expect(await campaignSceneCount(campaignDir)).toBe(0);
  });

  it("counts only this campaign's scenes, not a sibling's", async () => {
    const ctx = await resolveWorldContext(campaignDir);
    const inst = await getWorldDb(ctx);
    const conn = await openWorldWriteConn(inst);
    try {
      await insertScene(conn, { id: crypto.randomUUID(), campaignId: ctx.campaignId });
      await insertScene(conn, { id: crypto.randomUUID(), campaignId: ctx.campaignId });
      await insertScene(conn, { id: crypto.randomUUID(), campaignId: "some-other-campaign" });
    } finally {
      conn.closeSync();
    }

    expect(await campaignSceneCount(campaignDir)).toBe(2);
  });
});
