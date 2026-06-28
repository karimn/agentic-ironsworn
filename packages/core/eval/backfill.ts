// Backfill-quality guard for the extraction eval. Under v1, point-of-entry
// recording (recordBeatCanon) is the primary path and extraction is demoted to
// optional backfill. This guard models that: seed the graph with recorded canon,
// run extraction on top, then measure whether backfill fragmented a recorded
// entity or added spurious nodes. `fragmentedSeeds` is the regression signal —
// empty means backfill correctly dedups against recorded canon.

import { fragmentationClusters } from "../src/rag/graph-health.js";

export interface FragCluster {
  type: string;
  names: string[];
}

export interface BackfillGuardReport {
  seeded: number;
  finalEntities: number;
  netNewEntities: number;
  clusters: FragCluster[]; // all fragmentation clusters in the final graph
  fragmentedSeeds: FragCluster[]; // clusters that split a seeded (recorded) entity
}

const norm = (s: string): string => s.toLowerCase().trim();

// Given the recorded-canon seed names, the final graph entities (post-backfill),
// and the fragmentation clusters found among them, classify which clusters
// corrupt recorded canon (touch a seeded name) vs. backfill-internal noise.
export function backfillGuard(
  seedNames: string[],
  finalEntities: { canonical: string; type: string; aliases: string[] }[],
  clusters: FragCluster[],
): BackfillGuardReport {
  const seedSet = new Set(seedNames.map(norm));
  // A fragmented seed is a cluster that mixes a recorded (seeded) name with a
  // NEW one backfill added — i.e. extraction coined a variant of recorded canon.
  // Clusters among only seeds are golden-baseline structure (not backfill's
  // fault); clusters among only new nodes are backfill-internal noise.
  const fragmentedSeeds = clusters.filter(
    (c) =>
      c.names.some((n) => seedSet.has(norm(n))) &&
      c.names.some((n) => !seedSet.has(norm(n))),
  );
  return {
    seeded: seedNames.length,
    finalEntities: finalEntities.length,
    netNewEntities: finalEntities.length - seedNames.length,
    clusters,
    fragmentedSeeds,
  };
}

// Convenience: compute clusters from the final graph and run the guard in one
// call. Used by run-eval's backfill mode.
export function backfillGuardFromGraph(
  seedNames: string[],
  finalEntities: { canonical: string; type: string; aliases: string[] }[],
): BackfillGuardReport {
  return backfillGuard(seedNames, finalEntities, fragmentationClusters(finalEntities));
}
