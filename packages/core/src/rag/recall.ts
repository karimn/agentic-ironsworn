import { resolveWorldContext } from "../world.js";
import { getWorldDb, getWorldEmbedding } from "./world-db.js";
import { searchLore } from "./lore.js";
import { searchCommunities } from "./communities.js";
import type { LoreType, LoreSearchHit } from "./lore.js";
import type { CommunitySearchHit } from "./communities.js";

export type NearFilter =
  | { entity: string };
  // Future: | { coordinates: { x: number; y: number }; radius: number; metric: string }

export interface RecallOptions {
  kind?: LoreType;
  near?: NearFilter;
  limit?: number;
  include_sibling_campaigns?: boolean;
  scenes_per_entity?: number;   // default 2
  communities?: number;         // default 3
}

export interface RecallScene {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
}

export interface RecallEntity {
  id: string;
  slug: string;
  canonical: string;
  type: LoreType;
  summary: string;
  score: number;
  scenes: RecallScene[];
}

export interface RecallCommunity {
  id: string;
  level: number;
  summary: string;
  score: number;
}

export interface RecallResult {
  query: string;
  entities: RecallEntity[];
  communities: RecallCommunity[];
}

export async function recall(
  campaignPath: string,
  query: string,
  opts?: RecallOptions,
): Promise<RecallResult> {
  const limit = opts?.limit ?? 5;
  const scenesPerEntity = opts?.scenes_per_entity ?? 2;
  const communityLimit = opts?.communities ?? 3;
  const includeSiblings = opts?.include_sibling_campaigns ?? false;

  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);

  // Resolve near.entity to a set of allowed entity IDs (1-hop neighbors + anchor itself)
  let nearIds: Set<string> | null = null;
  if (opts?.near !== undefined) {
    const { entity: anchorRef } = opts.near as { entity: string };
    // Resolve anchor: try UUID first, then canonical/alias lookup
    const conn = await instance.connect();
    try {
      // Resolve anchor id
      const anchorRows = (
        await conn.runAndReadAll(
          `SELECT id FROM entities
           WHERE id = ? OR lower(canonical) = lower(?) OR lower(slug) = lower(?)
             AND (campaign_id IS NULL OR campaign_id = ?)
           LIMIT 1`,
          [anchorRef, anchorRef, anchorRef, ctx.campaignId],
        )
      ).getRowObjectsJS() as Record<string, unknown>[];
      if (anchorRows.length === 0) {
        // Unknown anchor — fall through to unrestricted search
      } else {
        const anchorId = String(anchorRows[0]!["id"]);
        // Fetch 1-hop neighbors (both directions) with visibility filter
        const neighborRows = (
          await conn.runAndReadAll(
            `SELECT DISTINCT
               CASE WHEN from_entity = ? THEN to_entity ELSE from_entity END AS neighbor_id
             FROM relations
             WHERE (from_entity = ? OR to_entity = ?)
               AND (campaign_id IS NULL OR campaign_id = ?)
               AND invalid_at IS NULL`,
            [anchorId, anchorId, anchorId, ctx.campaignId],
          )
        ).getRowObjectsJS() as Record<string, unknown>[];
        nearIds = new Set([anchorId, ...neighborRows.map((r) => String(r["neighbor_id"]))]);
      }
    } finally {
      conn.closeSync();
    }
  }

  // Build entity search SQL — restrict to nearIds if present
  const embeddingLiteral = await getWorldEmbedding(query).then(
    (emb) => `[${emb.join(",")}]::FLOAT[768]`,
  );

  let entityHits: LoreSearchHit[];
  if (nearIds !== null && nearIds.size > 0) {
    const idList = [...nearIds];
    const placeholders = idList.map(() => "?").join(",");
    const conn = await instance.connect();
    try {
      const rows = (
        await conn.runAndReadAll(
          `SELECT id, slug, canonical, type, summary,
                  array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
           FROM entities
           WHERE id IN (${placeholders})
             AND (campaign_id IS NULL OR campaign_id = ?)
           ORDER BY score DESC LIMIT ?`,
          [...idList, ctx.campaignId, limit],
        )
      ).getRowObjectsJS() as Record<string, unknown>[];
      entityHits = rows.map((row) => ({
        id: String(row["id"] ?? ""),
        slug: String(row["slug"] ?? ""),
        canonical: String(row["canonical"] ?? ""),
        type: String(row["type"] ?? "concept") as LoreType,
        summary: String(row["summary"] ?? ""),
        score: typeof row["score"] === "number" ? row["score"]
          : typeof row["score"] === "bigint" ? Number(row["score"]) : Number.NaN,
      }));
    } finally {
      conn.closeSync();
    }
  } else {
    // No near filter (or unknown anchor) — unrestricted search
    entityHits = await searchLore(campaignPath, query, limit, opts?.kind, { includeSiblings });
  }

  // Community search (always unrestricted — thematic framing shouldn't be proximity-filtered)
  const communityHits = await searchCommunities(campaignPath, query, communityLimit, undefined, { includeSiblings });

  // Batch-fetch recent scenes for matched entities
  const entityIds = entityHits.map((e) => e.id);
  const scenesByEntity = new Map<string, RecallScene[]>();
  for (const id of entityIds) scenesByEntity.set(id, []);

  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    const conn = await instance.connect();
    try {
      const rows = (
        await conn.runAndReadAll(
          `SELECT s.id, s.text, s.timestamp, s.kind, ser.entity_id
           FROM scene_entity_refs ser
           JOIN scenes s ON s.id = ser.scene_id
           WHERE ser.entity_id IN (${placeholders})
             AND s.campaign_id = ?
           ORDER BY s.timestamp DESC`,
          [...entityIds, ctx.campaignId],
        )
      ).getRowObjectsJS() as Record<string, unknown>[];

      for (const row of rows) {
        const eid = String(row["entity_id"] ?? "");
        const bucket = scenesByEntity.get(eid);
        if (bucket && bucket.length < scenesPerEntity) {
          bucket.push({
            id: String(row["id"] ?? ""),
            text: String(row["text"] ?? ""),
            timestamp: String(row["timestamp"] ?? ""),
            kind: String(row["kind"] ?? "scene"),
          });
        }
      }
    } finally {
      conn.closeSync();
    }
  }

  const entities: RecallEntity[] = entityHits.map((hit) => ({
    id: hit.id,
    slug: hit.slug,
    canonical: hit.canonical,
    type: hit.type,
    summary: hit.summary,
    score: hit.score,
    scenes: scenesByEntity.get(hit.id) ?? [],
  }));

  const communities: RecallCommunity[] = communityHits.map((c: CommunitySearchHit) => ({
    id: c.id,
    level: c.level,
    summary: c.summary,
    score: c.score,
  }));

  return { query, entities, communities };
}
