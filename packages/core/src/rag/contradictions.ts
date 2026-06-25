import { DuckDBInstance } from "@duckdb/node-api";
import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";

export interface ContradictionFlag {
  id: string;
  kind: "entity_summary_divergence" | "relation_label_conflict";
  entity_id?: string;
  relation_id?: string;
  conflicting_relation_id?: string;
  existing_value: string;
  incoming_value: string;
  similarity?: number;
  campaign_id: string | null;
  created_at: string;
  resolved_at?: string;
  resolution?: string;
}

export const ENTITY_CONTRADICTION_THRESHOLD = 0.72;

/**
 * Check whether an entity update's incoming summary diverges significantly
 * from the stored one. Uses DuckDB's array_cosine_similarity against the
 * existing embedding in the DB.
 *
 * MUST be called BEFORE the UPDATE statement in upsertLore — the UPDATE
 * overwrites the stored embedding, making the check trivially return 1.0 afterward.
 */
export async function checkEntityContradiction(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  input: {
    entityId: string;
    newEmbedding: number[];
    existingSummary: string;
    incomingSummary: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null> {
  const embLiteral = `[${input.newEmbedding.join(",")}]::FLOAT[768]`;
  const simResult = await conn.runAndReadAll(
    `SELECT array_cosine_similarity(embedding, ${embLiteral}) AS similarity
     FROM entities WHERE id = ?`,
    [input.entityId],
  );
  const rows = simResult.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const rawSim = rows[0]["similarity"];
  const similarity =
    typeof rawSim === "number" ? rawSim
    : typeof rawSim === "bigint" ? Number(rawSim)
    : Number.NaN;

  if (Number.isNaN(similarity) || similarity >= ENTITY_CONTRADICTION_THRESHOLD) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await conn.run(
    `INSERT INTO contradictions
       (id, kind, entity_id, existing_value, incoming_value, similarity, campaign_id, created_at)
     VALUES (?, 'entity_summary_divergence', ?, ?, ?, ?, ?, ?)`,
    [id, input.entityId, input.existingSummary, input.incomingSummary, similarity, input.campaignId, now],
  );
  return {
    id,
    kind: "entity_summary_divergence",
    entity_id: input.entityId,
    existing_value: input.existingSummary,
    incoming_value: input.incomingSummary,
    similarity,
    campaign_id: input.campaignId,
    created_at: now,
  };
}

// ---------------------------------------------------------------------------
// Stubs — implemented in Tasks 3–4
// ---------------------------------------------------------------------------

/**
 * Check whether inserting a new A→B relation with `newLabel` conflicts with
 * any currently-active A→B relation with a different label (undeclared
 * supersession). Must be called AFTER the new relation row is inserted
 * so newRelationId is valid for the flag record.
 * Inserts a flag for each conflict found; returns the first flag or null.
 */
export async function checkRelationContradiction(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  input: {
    fromId: string;
    toId: string;
    newLabel: string;
    newRelationId: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null> {
  const result = await conn.runAndReadAll(
    `SELECT id, label FROM relations
     WHERE from_entity = ? AND to_entity = ? AND label != ?
       AND invalid_at IS NULL
       AND (campaign_id IS NULL OR campaign_id = ?)`,
    [input.fromId, input.toId, input.newLabel, input.campaignId],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) return null;

  const now = new Date().toISOString();
  let firstFlag: ContradictionFlag | null = null;

  for (const row of rows) {
    const conflictingId = String(row["id"]);
    const conflictingLabel = String(row["label"]);
    const id = crypto.randomUUID();
    await conn.run(
      `INSERT INTO contradictions
         (id, kind, relation_id, conflicting_relation_id, existing_value, incoming_value, campaign_id, created_at)
       VALUES (?, 'relation_label_conflict', ?, ?, ?, ?, ?, ?)`,
      [id, input.newRelationId, conflictingId, conflictingLabel, input.newLabel, input.campaignId, now],
    );
    if (firstFlag === null) {
      firstFlag = {
        id,
        kind: "relation_label_conflict",
        relation_id: input.newRelationId,
        conflicting_relation_id: conflictingId,
        existing_value: conflictingLabel,
        incoming_value: input.newLabel,
        campaign_id: input.campaignId,
        created_at: now,
      };
    }
  }

  return firstFlag;
}

function rowToFlag(row: Record<string, unknown>): ContradictionFlag {
  return {
    id: String(row["id"]),
    kind: String(row["kind"]) as ContradictionFlag["kind"],
    entity_id: row["entity_id"] != null ? String(row["entity_id"]) : undefined,
    relation_id: row["relation_id"] != null ? String(row["relation_id"]) : undefined,
    conflicting_relation_id: row["conflicting_relation_id"] != null
      ? String(row["conflicting_relation_id"]) : undefined,
    existing_value: String(row["existing_value"]),
    incoming_value: String(row["incoming_value"]),
    similarity: row["similarity"] != null ? Number(row["similarity"]) : undefined,
    campaign_id: row["campaign_id"] != null ? String(row["campaign_id"]) : null,
    created_at: String(row["created_at"]),
    resolved_at: row["resolved_at"] != null ? String(row["resolved_at"]) : undefined,
    resolution: row["resolution"] != null ? String(row["resolution"]) : undefined,
  };
}

export async function listContradictions(
  campaignPath: string,
  opts?: { includeResolved?: boolean; limit?: number },
): Promise<ContradictionFlag[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const limit = opts?.limit ?? 20;
    const resolvedClause = (opts?.includeResolved ?? false) ? "" : "AND resolved_at IS NULL";
    const result = await conn.runAndReadAll(
      `SELECT id, kind, entity_id, relation_id, conflicting_relation_id,
              existing_value, incoming_value, similarity, campaign_id,
              created_at, resolved_at, resolution
       FROM contradictions
       WHERE campaign_id = ? ${resolvedClause}
       ORDER BY created_at DESC
       LIMIT ?`,
      [ctx.campaignId, limit],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map(rowToFlag);
  } finally {
    conn.closeSync();
  }
}

export async function resolveContradiction(
  campaignPath: string,
  id: string,
  resolution?: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const now = new Date().toISOString();
    await conn.run(
      `UPDATE contradictions SET resolved_at = ?, resolution = ? WHERE id = ?`,
      [now, resolution ?? null, id],
    );
  } finally {
    conn.closeSync();
  }
}
