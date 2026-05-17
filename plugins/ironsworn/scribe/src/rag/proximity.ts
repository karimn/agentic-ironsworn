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
