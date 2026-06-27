import { resolveWorldContext } from "../world.js";
import { getWorldDb } from "./world-db.js";
import { searchLore } from "./lore.js";
import { searchCommunities } from "./communities.js";
import type { LoreType } from "./lore.js";
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
  if (opts?.near !== undefined) {
    throw new Error("near.entity is not yet implemented in recall()");
  }

  const limit = opts?.limit ?? 5;
  const scenesPerEntity = opts?.scenes_per_entity ?? 2;
  const communityLimit = opts?.communities ?? 3;
  const includeSiblings = opts?.include_sibling_campaigns ?? false;

  const ctx = await resolveWorldContext(campaignPath);

  // Parallel: entity search + community search + open DB connection
  const [entityHits, communityHits, instance] = await Promise.all([
    searchLore(campaignPath, query, limit, opts?.kind, { includeSiblings }),
    searchCommunities(campaignPath, query, communityLimit, undefined, { includeSiblings }),
    getWorldDb(ctx),
  ]);

  // Batch-fetch recent scenes for all matched entities via scene_entity_refs
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
