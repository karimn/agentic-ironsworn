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
