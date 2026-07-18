import { resolveWorldContext } from "../world.js";
import { getWorldDb } from "./world-db.js";
import { listContradictions } from "./contradictions.js";

// ---------------------------------------------------------------------------
// The canonize ritual, operationalized (FW2, resolves OQ5): surface campaign-
// scoped entities/relations ranked by how much they've stabilized into the
// story this pass, gated on open contradictions, so blessing into shared
// world canon (campaign_id = NULL) is a deliberate moment rather than
// something the GM has to remember mid-narration.
// ---------------------------------------------------------------------------

/**
 * Ranking weights. Recurrence (scene-spread — how many distinct scenes an
 * entity has been referenced in this campaign) counts for more than raw
 * connectedness (relation degree — how many relations, campaign + canon,
 * touch it), on the theory that a name recurring on stage is stronger
 * evidence of "this is now true for the world" than a name that merely has
 * a lot of edges. Both signals are reused from data already tracked
 * elsewhere in rag/ (`scene_entity_refs`, the same table `getSceneEntityRefs`
 * reads; relation degree is the same connectivity `graph-health.ts`'s
 * `relationCoverage` checks, generalized from a boolean to a count).
 */
export const SCENE_SPREAD_WEIGHT = 2;
export const RELATION_DEGREE_WEIGHT = 1;

interface CanonizeCandidateCommon {
  id: string;
  score: number;
  /** True when an unresolved contradiction touches this candidate — it cannot be blessed until resolved. */
  blocked: boolean;
  blocked_reason?: string;
}

export interface EntityCanonizeCandidate extends CanonizeCandidateCommon {
  kind: "entity";
  name: string;
  type: string;
  summary: string;
  /** Distinct scenes (this campaign) that reference this entity. */
  scene_spread: number;
  /** Relations (campaign + visible canon) touching this entity. */
  relation_degree: number;
}

export interface RelationCanonizeCandidate extends CanonizeCandidateCommon {
  kind: "relation";
  label: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  /** Proxy for the relation's own recurrence: the lesser of its two endpoints' scene-spread. */
  scene_spread: number;
}

export type CanonizeCandidate = EntityCanonizeCandidate | RelationCanonizeCandidate;

export interface EntityCandidateInput {
  id: string;
  name: string;
  type: string;
  summary: string;
  scene_spread: number;
  relation_degree: number;
  /** Present (and non-undefined) iff an open contradiction touches this entity. */
  blocked_reason?: string;
}

export interface RelationCandidateInput {
  id: string;
  label: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  scene_spread: number;
  blocked_reason?: string;
}

/**
 * Score and rank campaign-scoped candidates for the canonize ritual. Pure —
 * no DB access — so the ranking formula and the contradiction gate are
 * testable without a world.duckdb fixture, mirroring the DB-fetch /
 * pure-render split `buildContradictionsSection` established for FW1.
 */
export function rankCanonizeCandidates(
  entities: EntityCandidateInput[],
  relations: RelationCandidateInput[],
  limit = 20,
): CanonizeCandidate[] {
  const entityCandidates: EntityCanonizeCandidate[] = entities.map((e) => ({
    kind: "entity",
    id: e.id,
    name: e.name,
    type: e.type,
    summary: e.summary,
    scene_spread: e.scene_spread,
    relation_degree: e.relation_degree,
    score: e.scene_spread * SCENE_SPREAD_WEIGHT + e.relation_degree * RELATION_DEGREE_WEIGHT,
    blocked: e.blocked_reason !== undefined,
    blocked_reason: e.blocked_reason,
  }));
  const relationCandidates: RelationCanonizeCandidate[] = relations.map((r) => ({
    kind: "relation",
    id: r.id,
    label: r.label,
    from_id: r.from_id,
    from_name: r.from_name,
    to_id: r.to_id,
    to_name: r.to_name,
    scene_spread: r.scene_spread,
    score: r.scene_spread * SCENE_SPREAD_WEIGHT,
    blocked: r.blocked_reason !== undefined,
    blocked_reason: r.blocked_reason,
  }));
  return [...entityCandidates, ...relationCandidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit, 0));
}

/**
 * Fetch and rank campaign-scoped canonize candidates for the active campaign.
 *
 * Candidates are entities/relations with `campaign_id = current campaign`
 * (already-canon rows, where `campaign_id IS NULL`, and rows scoped to a
 * sibling campaign are both excluded — you can only bless what you own).
 * Each candidate is gated against `listContradictions`: a candidate touched
 * by an unresolved contradiction comes back with `blocked: true` and cannot
 * be blessed until `resolve_contradiction` runs.
 */
export async function listCanonizeCandidates(
  campaignPath: string,
  opts?: { limit?: number },
): Promise<CanonizeCandidate[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const [entityRows, relationRows, sceneSpreadRows, degreeRows, openFlags] = await Promise.all([
      conn.runAndReadAll(
        `SELECT id, canonical, type, summary FROM entities WHERE campaign_id = ?`,
        [ctx.campaignId],
      ),
      conn.runAndReadAll(
        `SELECT r.id, r.label, r.from_entity AS from_id, fe.canonical AS from_name,
                r.to_entity AS to_id, te.canonical AS to_name
         FROM relations r
         JOIN entities fe ON fe.id = r.from_entity
         JOIN entities te ON te.id = r.to_entity
         WHERE r.campaign_id = ? AND r.invalid_at IS NULL`,
        [ctx.campaignId],
      ),
      conn.runAndReadAll(
        `SELECT ser.entity_id, COUNT(DISTINCT ser.scene_id) AS cnt
         FROM scene_entity_refs ser
         JOIN scenes s ON s.id = ser.scene_id
         WHERE s.campaign_id = ?
         GROUP BY ser.entity_id`,
        [ctx.campaignId],
      ),
      conn.runAndReadAll(
        `SELECT entity_id, COUNT(*) AS cnt FROM (
           SELECT from_entity AS entity_id FROM relations WHERE invalid_at IS NULL AND (campaign_id IS NULL OR campaign_id = ?)
           UNION ALL
           SELECT to_entity AS entity_id FROM relations WHERE invalid_at IS NULL AND (campaign_id IS NULL OR campaign_id = ?)
         ) t GROUP BY entity_id`,
        [ctx.campaignId, ctx.campaignId],
      ),
      listContradictions(campaignPath),
    ]);

    const sceneSpreadMap = new Map<string, number>();
    for (const row of sceneSpreadRows.getRowObjectsJS() as Record<string, unknown>[]) {
      sceneSpreadMap.set(String(row["entity_id"]), Number(row["cnt"]));
    }
    const degreeMap = new Map<string, number>();
    for (const row of degreeRows.getRowObjectsJS() as Record<string, unknown>[]) {
      degreeMap.set(String(row["entity_id"]), Number(row["cnt"]));
    }

    // Block candidates touched by an unresolved contradiction. A relation
    // flag references both the incoming relation (relation_id) and the
    // existing one it conflicts with (conflicting_relation_id) — either
    // being a live candidate should block it.
    const blockedEntity = new Map<string, string>();
    const blockedRelation = new Map<string, string>();
    for (const flag of openFlags) {
      const reason = `unresolved ${flag.kind} (contradiction ${flag.id}) — run resolve_contradiction first`;
      if (flag.entity_id !== undefined) blockedEntity.set(flag.entity_id, reason);
      if (flag.relation_id !== undefined) blockedRelation.set(flag.relation_id, reason);
      if (flag.conflicting_relation_id !== undefined) blockedRelation.set(flag.conflicting_relation_id, reason);
    }

    const entityInputs: EntityCandidateInput[] = (entityRows.getRowObjectsJS() as Record<string, unknown>[]).map(
      (row) => {
        const id = String(row["id"]);
        return {
          id,
          name: String(row["canonical"]),
          type: String(row["type"]),
          summary: String(row["summary"]),
          scene_spread: sceneSpreadMap.get(id) ?? 0,
          relation_degree: degreeMap.get(id) ?? 0,
          blocked_reason: blockedEntity.get(id),
        };
      },
    );

    const relationInputs: RelationCandidateInput[] = (relationRows.getRowObjectsJS() as Record<string, unknown>[]).map(
      (row) => {
        const id = String(row["id"]);
        const fromId = String(row["from_id"]);
        const toId = String(row["to_id"]);
        return {
          id,
          label: String(row["label"]),
          from_id: fromId,
          from_name: String(row["from_name"]),
          to_id: toId,
          to_name: String(row["to_name"]),
          scene_spread: Math.min(sceneSpreadMap.get(fromId) ?? 0, sceneSpreadMap.get(toId) ?? 0),
          blocked_reason: blockedRelation.get(id),
        };
      },
    );

    return rankCanonizeCandidates(entityInputs, relationInputs, opts?.limit ?? 20);
  } finally {
    conn.closeSync();
  }
}
