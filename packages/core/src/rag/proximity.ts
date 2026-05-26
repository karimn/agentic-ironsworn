import { DuckDBInstance } from "@duckdb/node-api";
import { getLoreDb, openLoreWriteConn } from "./lore-db.js";
import { recordProvenance } from "./lore.js";

export const PROXIMITY_DIMENSIONS = ["space", "time"] as const;
export type ProximityDimension = (typeof PROXIMITY_DIMENSIONS)[number];

export const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];
export type OrderKind = "before" | "after";

const DIRECTION_INVERSION: Record<CompassPoint, CompassPoint> = {
  N: "S", S: "N", E: "W", W: "E", NE: "SW", SW: "NE", NW: "SE", SE: "NW",
};

export function invertDirection(d: CompassPoint): CompassPoint {
  return DIRECTION_INVERSION[d];
}

export interface LinkProximityInput {
  from: string;
  to: string;
  dimension: ProximityDimension;
  magnitude: number;
  direction?: CompassPoint;
  order_kind?: OrderKind;
  notes?: string;
  metadata?: Record<string, unknown>;
  provenance?: { source_kind: "manual" | "scene" | "document" | "extraction"; source_id?: string; excerpt?: string; confidence?: number };
  _created_at?: string;
  _skipRecordingProvenance?: boolean;
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

export function validateLinkInput(input: LinkProximityInput): void {
  if (!(input.magnitude > 0)) throw new Error(`magnitude must be > 0 (got ${input.magnitude})`);
  if (input.dimension === "space") {
    if (input.direction === undefined) throw new Error("direction is required when dimension = 'space'");
    if (input.order_kind !== undefined) throw new Error("order_kind must not be set when dimension = 'space'");
  } else if (input.dimension === "time") {
    if (input.order_kind === undefined) throw new Error("order_kind is required when dimension = 'time'");
    if (input.direction !== undefined) throw new Error("direction must not be set when dimension = 'time'");
  }
}

interface LoreRow { id: string; type: string }

async function resolveLore(conn: Awaited<ReturnType<DuckDBInstance["connect"]>>, identifier: string): Promise<LoreRow> {
  const needle = identifier.toLowerCase();
  const result = await conn.runAndReadAll(
    `SELECT id, type FROM lore_entities
     WHERE lower(id) = ? OR lower(canonical) = ?
        OR EXISTS (SELECT 1 FROM unnest(aliases) AS t(alias) WHERE lower(alias) = ?)
     ORDER BY id LIMIT 1`,
    [needle, needle, needle],
  );
  const rows = result.getRowObjectsJS() as Record<string, unknown>[];
  if (rows.length === 0) throw new Error(`Lore entity not found: "${identifier}"`);
  return { id: String(rows[0]["id"]), type: String(rows[0]["type"]) };
}

interface CanonicalPair { fromId: string; toId: string; direction?: CompassPoint; orderKind?: OrderKind }

function canonicalizePair(
  fromId: string, toId: string, dimension: ProximityDimension,
  direction: CompassPoint | undefined, orderKind: OrderKind | undefined,
): CanonicalPair {
  if (dimension === "space") {
    const swap = fromId > toId;
    return { fromId: swap ? toId : fromId, toId: swap ? fromId : toId, direction: swap && direction ? invertDirection(direction) : direction };
  }
  const swap = orderKind === "after";
  return { fromId: swap ? toId : fromId, toId: swap ? fromId : toId, orderKind: "before" };
}

function makeProximityId(fromId: string, toId: string, dim: ProximityDimension): string {
  return `prox-${fromId}-${toId}-${dim}`;
}

const SPATIAL_OK_TYPES = new Set(["place", "faction"]);
const TEMPORAL_OK_TYPES = new Set(["event"]);

function typeWarnings(dimension: ProximityDimension, fromType: string, toType: string): string[] {
  const warnings: string[] = [];
  if (dimension === "space") {
    if (!SPATIAL_OK_TYPES.has(fromType)) warnings.push(`spatial edge from non-place/non-faction entity (type=${fromType})`);
    if (!SPATIAL_OK_TYPES.has(toType)) warnings.push(`spatial edge to non-place/non-faction entity (type=${toType})`);
  } else {
    if (!TEMPORAL_OK_TYPES.has(fromType)) warnings.push(`temporal edge from non-event entity (type=${fromType})`);
    if (!TEMPORAL_OK_TYPES.has(toType)) warnings.push(`temporal edge to non-event entity (type=${toType})`);
  }
  return warnings;
}

export async function linkProximity(campaignPath: string, input: LinkProximityInput): Promise<LinkProximityResult> {
  validateLinkInput(input);
  const instance = await getLoreDb(campaignPath);
  const conn = await openLoreWriteConn(instance);
  try {
    const fromRow = await resolveLore(conn, input.from);
    const toRow = await resolveLore(conn, input.to);
    if (fromRow.id === toRow.id) throw new Error("Cannot link an entity to itself");
    const canonical = canonicalizePair(fromRow.id, toRow.id, input.dimension, input.direction, input.order_kind);
    const id = makeProximityId(canonical.fromId, canonical.toId, input.dimension);
    const now = input._created_at ?? new Date().toISOString();
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const existingResult = await conn.runAndReadAll(
      `SELECT id FROM lore_proximity_edges WHERE from_id = ? AND to_id = ? AND dimension = ?`,
      [canonical.fromId, canonical.toId, input.dimension],
    );
    const existing = existingResult.getRowObjectsJS().length > 0;
    if (existing) {
      await conn.run(
        `UPDATE lore_proximity_edges SET magnitude = ?, direction = ?, order_kind = ?, notes = ?, metadata = ? WHERE id = ?`,
        [input.magnitude, canonical.direction ?? null, canonical.orderKind ?? null, input.notes ?? null, metadataJson, id],
      );
    } else {
      await conn.run(
        `INSERT INTO lore_proximity_edges (id, from_id, to_id, dimension, magnitude, direction, order_kind, notes, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, canonical.fromId, canonical.toId, input.dimension, input.magnitude, canonical.direction ?? null, canonical.orderKind ?? null, input.notes ?? null, metadataJson, now],
      );
    }
    if (!input._skipRecordingProvenance) {
      await recordProvenance(conn, "proximity", id, input.provenance, now);
    }
    const warnings = typeWarnings(input.dimension, fromRow.type, toRow.type);
    return { id, from_id: canonical.fromId, to_id: canonical.toId, dimension: input.dimension, updated: existing, warnings };
  } finally { conn.closeSync(); }
}

interface AdjList { [nodeId: string]: Array<{ to: string; cost: number }> }

async function loadAdjacency(conn: Awaited<ReturnType<DuckDBInstance["connect"]>>, dimension: ProximityDimension): Promise<AdjList> {
  const result = await conn.runAndReadAll(
    `SELECT from_id, to_id, magnitude FROM lore_proximity_edges WHERE dimension = ?`,
    [dimension],
  );
  const adj: AdjList = {};
  for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
    const from = String(row["from_id"]), to = String(row["to_id"]);
    const magRaw = row["magnitude"];
    const cost = typeof magRaw === "number" ? magRaw : Number(magRaw);
    if (!(cost > 0) || !isFinite(cost)) continue;
    (adj[from] ??= []).push({ to, cost });
    (adj[to] ??= []).push({ to: from, cost });
  }
  return adj;
}

function dijkstra(adj: AdjList, start: string, radius?: number): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(start, 0);
  const visited = new Set<string>();
  while (true) {
    let u: string | null = null;
    let uDist = Infinity;
    for (const [node, d] of dist) {
      if (visited.has(node)) continue;
      if (d < uDist) { u = node; uDist = d; }
    }
    if (u === null) break;
    if (radius !== undefined && uDist > radius) break;
    visited.add(u);
    for (const { to, cost } of adj[u] ?? []) {
      const next = uDist + cost;
      const prev = dist.get(to);
      if (prev === undefined || next < prev) dist.set(to, next);
    }
  }
  return dist;
}

const UNIT_BY_DIMENSION: Record<ProximityDimension, "days walk" | "days"> = { space: "days walk", time: "days" };

export async function proximityDistance(campaignPath: string, from: string, to: string, dimension: ProximityDimension): Promise<ProximityDistance | null> {
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const fromRow = await resolveLore(conn, from);
    const toRow = await resolveLore(conn, to);
    if (fromRow.id === toRow.id) return { distance: 0, unit: UNIT_BY_DIMENSION[dimension] };
    const adj = await loadAdjacency(conn, dimension);
    const dist = dijkstra(adj, fromRow.id);
    const target = dist.get(toRow.id);
    if (target === undefined) return null;
    return { distance: target, unit: UNIT_BY_DIMENSION[dimension] };
  } finally { conn.closeSync(); }
}

export async function proximityWithin(campaignPath: string, anchor: string, radius: number, dimension: ProximityDimension): Promise<ProximityNeighbor[]> {
  if (!(radius >= 0) || !isFinite(radius)) throw new Error(`radius must be >= 0 (got ${radius})`);
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const anchorRow = await resolveLore(conn, anchor);
    const adj = await loadAdjacency(conn, dimension);
    const dist = dijkstra(adj, anchorRow.id, radius);
    const ids = Array.from(dist.entries()).filter(([, d]) => d <= radius).map(([id]) => id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const result = await conn.runAndReadAll(
      `SELECT id, canonical, type FROM lore_entities WHERE id IN (${placeholders})`, ids,
    );
    const meta = new Map<string, { canonical: string; type: string }>();
    for (const row of result.getRowObjectsJS() as Record<string, unknown>[]) {
      meta.set(String(row["id"]), { canonical: String(row["canonical"]), type: String(row["type"]) });
    }
    const neighbors: ProximityNeighbor[] = ids
      .map((id) => { const m = meta.get(id); if (!m) return null; return { id, canonical: m.canonical, type: m.type, distance: dist.get(id) as number }; })
      .filter((n): n is ProximityNeighbor => n !== null);
    neighbors.sort((a, b) => a.distance - b.distance);
    return neighbors;
  } finally { conn.closeSync(); }
}

export interface ProximityEdgeExport {
  id: string; from_id: string; to_id: string; dimension: ProximityDimension;
  magnitude: number; direction: CompassPoint | null; order_kind: OrderKind | null;
  notes: string | null; metadata: Record<string, unknown>; created_at: string;
}

export async function exportProximity(campaignPath: string): Promise<ProximityEdgeExport[]> {
  const instance = await getLoreDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, from_id, to_id, dimension, magnitude, direction, order_kind, notes, metadata, created_at FROM lore_proximity_edges ORDER BY created_at`,
    );
    return (result.getRowObjectsJS() as Record<string, unknown>[]).map((r) => {
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(typeof r["metadata"] === "string" ? r["metadata"] : "{}"); } catch { metadata = {}; }
      const magRaw = r["magnitude"];
      return {
        id: String(r["id"]), from_id: String(r["from_id"]), to_id: String(r["to_id"]),
        dimension: String(r["dimension"]) as ProximityDimension,
        magnitude: typeof magRaw === "number" ? magRaw : Number(magRaw),
        direction: r["direction"] != null ? String(r["direction"]) as CompassPoint : null,
        order_kind: r["order_kind"] != null ? String(r["order_kind"]) as OrderKind : null,
        notes: r["notes"] != null ? String(r["notes"]) : null,
        metadata, created_at: String(r["created_at"]),
      };
    });
  } finally { conn.closeSync(); }
}
