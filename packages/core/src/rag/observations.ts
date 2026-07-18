import { resolveWorldContext } from "../world.js";
import { getWorldDb, openWorldWriteConn } from "./world-db.js";

// The shared sink for the runtime-observability track (#211/#212/#213):
// the referee and the LLM watcher write rows here; /session-report reads them.
// Observations are strictly campaign-scoped — there is no canon/overlay
// concept, so reads never include sibling campaigns or NULL-campaign rows.

export type ObservationSource = "referee" | "watcher";
export type ObservationSeverity = "hard" | "soft";

export interface Observation {
  id: string;
  campaign_id: string;
  created_at: string;
  source: ObservationSource;
  severity: ObservationSeverity;
  kind: string;
  detail: string;
  turn_ref?: string;
  blocked: boolean;
  resolved_at?: string;
  resolution?: string;
}

export interface ObservationInput {
  source: ObservationSource;
  severity: ObservationSeverity;
  kind: string;
  detail: string;
  turnRef?: string;
  blocked?: boolean;
}

function rowToObservation(row: Record<string, unknown>): Observation {
  return {
    id: String(row["id"]),
    campaign_id: String(row["campaign_id"]),
    created_at: String(row["created_at"]),
    source: String(row["source"]) as ObservationSource,
    severity: String(row["severity"]) as ObservationSeverity,
    kind: String(row["kind"]),
    detail: String(row["detail"]),
    turn_ref: row["turn_ref"] != null ? String(row["turn_ref"]) : undefined,
    blocked: Boolean(row["blocked"]),
    resolved_at: row["resolved_at"] != null ? String(row["resolved_at"]) : undefined,
    resolution: row["resolution"] != null ? String(row["resolution"]) : undefined,
  };
}

export async function recordObservation(
  campaignPath: string,
  input: ObservationInput,
): Promise<Observation> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await conn.run(
      `INSERT INTO observations
         (id, campaign_id, created_at, source, severity, kind, detail, turn_ref, blocked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ctx.campaignId,
        now,
        input.source,
        input.severity,
        input.kind,
        input.detail,
        input.turnRef ?? null,
        input.blocked ?? false,
      ],
    );
    return {
      id,
      campaign_id: ctx.campaignId,
      created_at: now,
      source: input.source,
      severity: input.severity,
      kind: input.kind,
      detail: input.detail,
      turn_ref: input.turnRef,
      blocked: input.blocked ?? false,
    };
  } finally {
    conn.closeSync();
  }
}

export async function listObservations(
  campaignPath: string,
  opts?: {
    unresolvedOnly?: boolean;
    kind?: string;
    since?: string;
    limit?: number;
  },
): Promise<Observation[]> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await instance.connect();
  try {
    const clauses = ["campaign_id = ?"];
    const params: unknown[] = [ctx.campaignId];
    if (opts?.unresolvedOnly ?? true) clauses.push("resolved_at IS NULL");
    if (opts?.kind !== undefined) {
      clauses.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts?.since !== undefined) {
      clauses.push("created_at >= ?");
      params.push(opts.since);
    }
    params.push(opts?.limit ?? 50);
    const result = await conn.runAndReadAll(
      `SELECT id, campaign_id, created_at, source, severity, kind, detail,
              turn_ref, blocked, resolved_at, resolution
       FROM observations
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
      params as (string | number)[],
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map(rowToObservation);
  } finally {
    conn.closeSync();
  }
}

export async function resolveObservation(
  campaignPath: string,
  id: string,
  note?: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    const now = new Date().toISOString();
    await conn.run(
      `UPDATE observations SET resolved_at = ?, resolution = ?
       WHERE id = ? AND campaign_id = ?`,
      [now, note ?? null, id, ctx.campaignId],
    );
  } finally {
    conn.closeSync();
  }
}
