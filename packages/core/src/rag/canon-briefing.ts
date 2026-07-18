import { resolveWorldContext } from "../world.js";
import { getWorldDb } from "./world-db.js";

// ---------------------------------------------------------------------------
// Canon briefing (FW3, #198): the "here is what is already true here" moment
// for a PC entering an established world. Pairs with the canonize ritual
// (FW2, #197) — canon blessed in one campaign (campaign_id flipped to NULL)
// is exactly what a freshly created sibling campaign should be briefed on.
//
// Scope is deliberately world-only (`campaign_id IS NULL`): a sibling
// campaign's own overlay is invisible to it by design (the visibility
// filter this whole feature exists to exercise), so the briefing never
// reaches into another campaign's private discoveries.
// ---------------------------------------------------------------------------

export interface CanonBriefingEntity {
  id: string;
  name: string;
  type: string;
  summary: string;
  /** Relations (world-canon only) touching this entity — a cheap "how central is this" signal for ranking. */
  relation_degree: number;
}

export interface CanonBriefingRelation {
  id: string;
  label: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
}

export interface CanonBriefingCommunity {
  id: string;
  level: number;
  member_count: number;
  summary: string;
}

export interface CanonBriefing {
  entities: CanonBriefingEntity[];
  relations: CanonBriefingRelation[];
  communities: CanonBriefingCommunity[];
}

const DEFAULT_ENTITY_LIMIT = 15;
const DEFAULT_RELATION_LIMIT = 15;
const DEFAULT_COMMUNITY_LIMIT = 5;

/**
 * Fetch world-scoped (`campaign_id IS NULL`) canon for a fresh sibling
 * campaign's inaugural GM briefing: the most-connected entities, their
 * active relations, and the broadest community summaries. Ranking mirrors
 * `listCanonizeCandidates` (FW2) in spirit — recurrence/connectivity floats
 * what's most load-bearing to the top — but here it's relation degree only
 * (a new campaign has no scenes yet, so scene-spread isn't a meaningful
 * signal for canon that predates it).
 */
export async function getCanonBriefing(
  campaignPath: string,
  opts?: { entityLimit?: number; relationLimit?: number; communityLimit?: number },
): Promise<CanonBriefing> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const entityLimit = opts?.entityLimit ?? DEFAULT_ENTITY_LIMIT;
    const relationLimit = opts?.relationLimit ?? DEFAULT_RELATION_LIMIT;
    const communityLimit = opts?.communityLimit ?? DEFAULT_COMMUNITY_LIMIT;

    const [entityRows, relationRows, degreeRows, communityRows] = await Promise.all([
      conn.runAndReadAll(
        `SELECT id, canonical, type, summary FROM entities WHERE campaign_id IS NULL`,
      ),
      conn.runAndReadAll(
        `SELECT r.id, r.label, r.from_entity AS from_id, fe.canonical AS from_name,
                r.to_entity AS to_id, te.canonical AS to_name
         FROM relations r
         JOIN entities fe ON fe.id = r.from_entity
         JOIN entities te ON te.id = r.to_entity
         WHERE r.campaign_id IS NULL AND r.invalid_at IS NULL
         ORDER BY r.created_at DESC
         LIMIT ?`,
        [relationLimit],
      ),
      conn.runAndReadAll(
        `SELECT entity_id, COUNT(*) AS cnt FROM (
           SELECT from_entity AS entity_id FROM relations WHERE campaign_id IS NULL AND invalid_at IS NULL
           UNION ALL
           SELECT to_entity AS entity_id FROM relations WHERE campaign_id IS NULL AND invalid_at IS NULL
         ) t GROUP BY entity_id`,
      ),
      conn.runAndReadAll(
        `SELECT id, level, member_count, summary FROM lore_communities
         WHERE campaign_id IS NULL
         ORDER BY level DESC, member_count DESC
         LIMIT ?`,
        [communityLimit],
      ),
    ]);

    const degreeMap = new Map<string, number>();
    for (const row of degreeRows.getRowObjectsJS() as Record<string, unknown>[]) {
      degreeMap.set(String(row["entity_id"]), Number(row["cnt"]));
    }

    const entities: CanonBriefingEntity[] = (entityRows.getRowObjectsJS() as Record<string, unknown>[])
      .map((row) => {
        const id = String(row["id"]);
        return {
          id,
          name: String(row["canonical"]),
          type: String(row["type"]),
          summary: String(row["summary"]),
          relation_degree: degreeMap.get(id) ?? 0,
        };
      })
      .sort((a, b) => b.relation_degree - a.relation_degree)
      .slice(0, entityLimit);

    const relations: CanonBriefingRelation[] = (relationRows.getRowObjectsJS() as Record<string, unknown>[]).map(
      (row) => ({
        id: String(row["id"]),
        label: String(row["label"]),
        from_id: String(row["from_id"]),
        from_name: String(row["from_name"]),
        to_id: String(row["to_id"]),
        to_name: String(row["to_name"]),
      }),
    );

    const communities: CanonBriefingCommunity[] = (communityRows.getRowObjectsJS() as Record<string, unknown>[]).map(
      (row) => ({
        id: String(row["id"]),
        level: Number(row["level"]),
        member_count: Number(row["member_count"]),
        summary: String(row["summary"] ?? ""),
      }),
    );

    return { entities, relations, communities };
  } finally {
    conn.closeSync();
  }
}

/**
 * Count of scenes recorded for the active campaign — the trigger signal for
 * "is this a fresh sibling campaign's first session." A campaign with zero
 * recorded scenes combined with non-empty world canon is exactly a new
 * story starting in an established world; an established campaign's
 * hundredth session also has zero *new* canon to brief (it already knows
 * all this), so the briefing only fires on the intersection of both —
 * see `buildCanonBriefingSection` in scribe/src/context/build.ts, which
 * takes this count plus a `CanonBriefing` and decides whether to render.
 */
export async function campaignSceneCount(campaignPath: string): Promise<number> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM scenes WHERE campaign_id = ?`,
      [ctx.campaignId],
    );
    const rows = result.getRowObjectsJS() as Record<string, unknown>[];
    const raw = rows[0]?.["cnt"];
    return typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0);
  } finally {
    conn.closeSync();
  }
}
