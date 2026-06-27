// Relation-loss diagnostics for the extraction eval. Pure functions over the
// extractor's RAW emitted relations + the persisted entity name set — no DB,
// no Ollama — so they unit-test alongside score.ts / aggregate.ts.
//
// Purpose: relation recall is the pipeline's weakest metric, and a missed
// relation has two opposite causes that demand opposite fixes:
//   - never emitted by the LLM but expected      → PROMPT problem (see scorer recall)
//   - emitted, then dropped before it persists   → PLUMBING problem (this module)
// For the plumbing side we mirror extraction.ts's drop logic and ORDER: the
// confidence gate runs first and short-circuits, so a low-confidence relation
// is never endpoint-checked.

export interface EmittedRelation {
  from: string;
  to: string;
  relation: string;
  confidence: number;
}

export interface UnresolvedEndpoint {
  name: string;
  count: number;
}

export interface RelationDropBreakdown {
  emitted: number;
  // Survived both gates (confidence ok AND both endpoints resolvable) → would link.
  survived: number;
  droppedLowConfidence: number;
  droppedEndpointUnresolved: number;
  // Endpoint names that failed to resolve, most frequent first — the actionable
  // list for diagnosing name-agreement loss between entity and relation extraction.
  unresolvedEndpoints: UnresolvedEndpoint[];
}

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function sortTally(tally: Map<string, number>): UnresolvedEndpoint[] {
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function classifyRelationDrops(
  emitted: EmittedRelation[],
  persistedEntityNames: string[],
  threshold: number,
): RelationDropBreakdown {
  const names = new Set(persistedEntityNames.map(norm));
  const resolves = (name: string): boolean => names.has(norm(name));

  let survived = 0;
  let droppedLowConfidence = 0;
  let droppedEndpointUnresolved = 0;
  const unresolved = new Map<string, number>();

  for (const r of emitted) {
    // Confidence gate first — mirrors extraction.ts, which `continue`s before
    // touching the endpoints. Do NOT tally endpoints for these.
    if (r.confidence < threshold) {
      droppedLowConfidence++;
      continue;
    }
    const fromOk = resolves(r.from);
    const toOk = resolves(r.to);
    if (fromOk && toOk) {
      survived++;
      continue;
    }
    droppedEndpointUnresolved++;
    if (!fromOk) unresolved.set(r.from, (unresolved.get(r.from) ?? 0) + 1);
    if (!toOk) unresolved.set(r.to, (unresolved.get(r.to) ?? 0) + 1);
  }

  return {
    emitted: emitted.length,
    survived,
    droppedLowConfidence,
    droppedEndpointUnresolved,
    unresolvedEndpoints: sortTally(unresolved),
  };
}

export function aggregateRelationDrops(
  runs: RelationDropBreakdown[],
): RelationDropBreakdown {
  const merged = new Map<string, number>();
  const acc: RelationDropBreakdown = {
    emitted: 0,
    survived: 0,
    droppedLowConfidence: 0,
    droppedEndpointUnresolved: 0,
    unresolvedEndpoints: [],
  };
  for (const r of runs) {
    acc.emitted += r.emitted;
    acc.survived += r.survived;
    acc.droppedLowConfidence += r.droppedLowConfidence;
    acc.droppedEndpointUnresolved += r.droppedEndpointUnresolved;
    for (const e of r.unresolvedEndpoints) {
      merged.set(e.name, (merged.get(e.name) ?? 0) + e.count);
    }
  }
  acc.unresolvedEndpoints = sortTally(merged);
  return acc;
}
