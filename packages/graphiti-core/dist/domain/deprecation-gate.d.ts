/**
 * Deprecation Confidence Gate (Death Gate) — evidence-weighted contradiction resolution.
 *
 * Scores contradiction strength against existing evidence weight to create
 * epistemic inertia: well-established facts resist casual contradiction,
 * while weakly-evidenced claims yield to authoritative correction.
 *
 * Mirrors the birth gate pattern from `edge-quality.ts`.
 */
import type { EntityEdge } from './edges';
export interface ContradictionScores {
    /** How directly does the new evidence contradict the existing edge? (1-5) */
    contradiction_strength: number;
    /** Authority/reliability of the contradicting source (1-5) */
    source_authority: number;
    /** How many independent sources corroborate the contradiction? (1-5) */
    corroboration_count: number;
}
export interface DeprecationGateConfig {
    weights: {
        contradiction_strength: number;
        source_authority: number;
        corroboration_count: number;
    };
    thresholds: {
        ignore: number;
        dispute: number;
        deprecate: number;
        replace: number;
    };
    /** Evidence weight above which the deprecate tier resists and falls back to dispute */
    evidence_resistance_threshold: number;
}
export interface ScoringResult {
    composite: number;
    max_possible: number;
    tier: 'ignore' | 'dispute' | 'deprecate' | 'replace';
    dimensions: Record<string, {
        raw: number;
        weighted: number;
    }>;
}
export type ContradictionAction = 'keep_existing' | 'dispute_both' | 'deprecate_existing' | 'replace';
export interface EdgeMutation {
    edge_uuid: string;
    set: Record<string, unknown>;
}
export interface ContradictionResolution {
    action: ContradictionAction;
    reason: string;
    mutations?: EdgeMutation[];
    scoring?: ScoringResult;
}
export declare const DEFAULT_DEPRECATION_GATE_CONFIG: DeprecationGateConfig;
/**
 * Compute a weighted composite score for a set of contradiction dimensions.
 * Returns the composite, max possible, tier classification, and per-dimension breakdown.
 */
export declare function scoreContradiction(scores: ContradictionScores, config?: DeprecationGateConfig): ScoringResult;
/**
 * Given an existing edge, a contradicting edge, and scored contradiction dimensions,
 * determine the appropriate action: keep, dispute, deprecate, or replace.
 *
 * The `existingEvidenceWeight` parameter (from `computeEvidenceWeight()`) creates
 * epistemic inertia — well-evidenced facts resist deprecation and fall back to dispute.
 */
export declare function resolveContradiction(existingEdge: EntityEdge, contradictingEdge: EntityEdge, scores: ContradictionScores, existingEvidenceWeight?: number, config?: DeprecationGateConfig): ContradictionResolution;
