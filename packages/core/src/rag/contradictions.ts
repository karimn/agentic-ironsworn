import { DuckDBInstance } from "@duckdb/node-api";

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

/** @todo Task 4: list open contradictions for a campaign */
export async function listContradictions(
  _conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  _campaignId: string,
): Promise<ContradictionFlag[]> {
  throw new Error("Not implemented — Task 4");
}

/** @todo Task 4: mark a contradiction as resolved */
export async function resolveContradiction(
  _conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  _id: string,
  _resolution: string,
): Promise<void> {
  throw new Error("Not implemented — Task 4");
}
