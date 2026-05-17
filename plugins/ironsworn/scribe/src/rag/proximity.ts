import { DuckDBInstance } from "@duckdb/node-api";
import { getLoreDb, openLoreWriteConn } from "./lore-db.js";
import { recordProvenance } from "./lore.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROXIMITY_DIMENSIONS = ["space", "time"] as const;
export type ProximityDimension = (typeof PROXIMITY_DIMENSIONS)[number];

export const COMPASS_POINTS = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

export type OrderKind = "before" | "after";

const DIRECTION_INVERSION: Record<CompassPoint, CompassPoint> = {
  N: "S",
  S: "N",
  E: "W",
  W: "E",
  NE: "SW",
  SW: "NE",
  NW: "SE",
  SE: "NW",
};

export function invertDirection(d: CompassPoint): CompassPoint {
  return DIRECTION_INVERSION[d];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LinkProximityInput {
  from: string;
  to: string;
  dimension: ProximityDimension;
  magnitude: number;
  direction?: CompassPoint;
  order_kind?: OrderKind;
  notes?: string;
  metadata?: Record<string, unknown>;
  provenance?: {
    source_kind: "manual" | "scene" | "document" | "extraction";
    source_id?: string;
    excerpt?: string;
    confidence?: number;
  };
}

export interface LinkProximityResult {
  id: string;
  from_id: string;
  to_id: string;
  dimension: ProximityDimension;
  updated: boolean;
  warnings: string[];
}

export interface ProximityDistance {
  distance: number;
  unit: "days walk" | "days";
}

export interface ProximityNeighbor {
  id: string;
  canonical: string;
  type: string;
  distance: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateLinkInput(input: LinkProximityInput): void {
  if (!(input.magnitude > 0)) {
    throw new Error(`magnitude must be > 0 (got ${input.magnitude})`);
  }
  if (input.dimension === "space") {
    if (input.direction === undefined) {
      throw new Error("direction is required when dimension = 'space'");
    }
    if (input.order_kind !== undefined) {
      throw new Error("order_kind must not be set when dimension = 'space'");
    }
  } else if (input.dimension === "time") {
    if (input.order_kind === undefined) {
      throw new Error("order_kind is required when dimension = 'time'");
    }
    if (input.direction !== undefined) {
      throw new Error("direction must not be set when dimension = 'time'");
    }
  } else {
    // exhaustiveness guard; the type system already prevents this
    const _exhaustive: never = input.dimension;
    throw new Error(`unknown dimension: ${String(_exhaustive)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers — id resolution and canonical pair ordering
// ---------------------------------------------------------------------------

interface LoreRow {
  id: string;
  type: string;
}

async function resolveLore(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  identifier: string,
): Promise<LoreRow> {
  const needle = identifier.toLowerCase();
  const result = await conn.runAndReadAll(
    `SELECT id, type FROM lore_entities
     WHERE lower(id) = ?
        OR lower(canonical) = ?
        OR EXISTS (
             SELECT 1 FROM unnest(aliases) AS t(alias)
             WHERE lower(alias) = ?
           )
     ORDER BY id
     LIMIT 1`,
    [needle, needle, needle],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(`Lore entity not found: "${identifier}"`);
  }
  return { id: String(rows[0]["id"]), type: String(rows[0]["type"]) };
}

interface CanonicalPair {
  fromId: string;
  toId: string;
  direction?: CompassPoint;
  orderKind?: OrderKind;
}

/**
 * For space: store with the alphabetically lower id as `from_id`. If the
 * caller's input had them in the opposite order, invert the direction.
 *
 * For time: store with the earlier event as `from_id` and `order_kind = 'before'`.
 * If the caller said `order_kind = 'after'`, the caller's `to` is actually the
 * earlier event — swap.
 */
function canonicalizePair(
  fromId: string,
  toId: string,
  dimension: ProximityDimension,
  direction: CompassPoint | undefined,
  orderKind: OrderKind | undefined,
): CanonicalPair {
  if (dimension === "space") {
    const swap = fromId > toId;
    return {
      fromId: swap ? toId : fromId,
      toId: swap ? fromId : toId,
      direction: swap && direction ? invertDirection(direction) : direction,
    };
  }
  // time
  const swap = orderKind === "after";
  return {
    fromId: swap ? toId : fromId,
    toId: swap ? fromId : toId,
    orderKind: "before",
  };
}

function makeProximityId(fromId: string, toId: string, dim: ProximityDimension): string {
  return `prox-${fromId}-${toId}-${dim}`;
}

const SPATIAL_OK_TYPES = new Set(["place", "faction"]);
const TEMPORAL_OK_TYPES = new Set(["event"]);

function typeWarnings(
  dimension: ProximityDimension,
  fromType: string,
  toType: string,
): string[] {
  const warnings: string[] = [];
  if (dimension === "space") {
    if (!SPATIAL_OK_TYPES.has(fromType)) {
      warnings.push(
        `spatial edge from non-place/non-faction entity (type=${fromType})`,
      );
    }
    if (!SPATIAL_OK_TYPES.has(toType)) {
      warnings.push(
        `spatial edge to non-place/non-faction entity (type=${toType})`,
      );
    }
  } else {
    if (!TEMPORAL_OK_TYPES.has(fromType)) {
      warnings.push(`temporal edge from non-event entity (type=${fromType})`);
    }
    if (!TEMPORAL_OK_TYPES.has(toType)) {
      warnings.push(`temporal edge to non-event entity (type=${toType})`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// linkProximity
// ---------------------------------------------------------------------------

export async function linkProximity(
  campaignPath: string,
  input: LinkProximityInput,
): Promise<LinkProximityResult> {
  validateLinkInput(input);

  const instance = await getLoreDb(campaignPath);
  const conn = await openLoreWriteConn(instance);
  try {
    const fromRow = await resolveLore(conn, input.from);
    const toRow = await resolveLore(conn, input.to);

    if (fromRow.id === toRow.id) {
      throw new Error("Cannot link an entity to itself");
    }

    const canonical = canonicalizePair(
      fromRow.id,
      toRow.id,
      input.dimension,
      input.direction,
      input.order_kind,
    );

    const id = makeProximityId(canonical.fromId, canonical.toId, input.dimension);
    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(input.metadata ?? {});

    // Detect existing row to set `updated`.
    const existingResult = await conn.runAndReadAll(
      `SELECT id FROM lore_proximity_edges
       WHERE from_id = ? AND to_id = ? AND dimension = ?`,
      [canonical.fromId, canonical.toId, input.dimension],
    );
    const existing = existingResult.getRowObjectsJS().length > 0;

    if (existing) {
      await conn.run(
        `UPDATE lore_proximity_edges
         SET magnitude = ?, direction = ?, order_kind = ?, notes = ?, metadata = ?
         WHERE id = ?`,
        [
          input.magnitude,
          canonical.direction ?? null,
          canonical.orderKind ?? null,
          input.notes ?? null,
          metadataJson,
          id,
        ],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_proximity_edges
           (id, from_id, to_id, dimension, magnitude, direction, order_kind, notes, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          canonical.fromId,
          canonical.toId,
          input.dimension,
          input.magnitude,
          canonical.direction ?? null,
          canonical.orderKind ?? null,
          input.notes ?? null,
          metadataJson,
          now,
        ],
      );
    }

    await recordProvenance(conn, "proximity", id, input.provenance);

    const warnings = typeWarnings(input.dimension, fromRow.type, toRow.type);

    return {
      id,
      from_id: canonical.fromId,
      to_id: canonical.toId,
      dimension: input.dimension,
      updated: existing,
      warnings,
    };
  } finally {
    conn.closeSync();
  }
}
