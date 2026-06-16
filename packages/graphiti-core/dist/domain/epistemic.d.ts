/**
 * Epistemic Status + Evidence Weight system for entity edges.
 *
 * Tracks the epistemological standing of facts stored in the knowledge graph:
 * how certain we are, what evidence supports or disputes a claim, and the
 * audit trail of status transitions.
 */
export type EpistemicStatus = 'fact' | 'claim' | 'disputed' | 'decision' | 'opinion' | 'hypothesis' | 'observation' | 'preference' | 'deprecated';
export type EpistemicTrigger = 'corroboration' | 'contradiction' | 'testing' | 'decision' | 'deprecation' | 'manual_edit';
export interface EpistemicGateScore {
    rubric: string;
    tier: string;
    composite: number;
    max_possible: number;
    dimensions: Record<string, {
        raw: number;
        weighted: number;
    }>;
    existing_weight?: number;
}
export interface EpistemicTransition {
    from: EpistemicStatus;
    to: EpistemicStatus;
    trigger: EpistemicTrigger;
    trigger_edge_uuid?: string;
    timestamp: Date;
    editor?: string;
    gate_score?: EpistemicGateScore;
}
export interface BirthScore {
    composite: number;
    tier: string;
    dimensions: Record<string, {
        raw: number;
        weighted: number;
    }>;
}
export declare const BASE_WEIGHTS: Record<EpistemicStatus, number>;
/**
 * Valid epistemic state transitions.
 * 'deprecated' is a terminal state available from all statuses.
 */
export declare const VALID_TRANSITIONS: Record<EpistemicStatus, EpistemicStatus[]>;
/** Maximum number of transitions retained in epistemic_history (FIFO). */
export declare const EPISTEMIC_HISTORY_CAP = 50;
/**
 * Check whether an epistemic status transition is valid.
 */
export declare function validateTransition(from: EpistemicStatus, to: EpistemicStatus): boolean;
/**
 * Compute the evidence weight of an edge given its epistemic status,
 * supporting edges, and confidence band.
 *
 * Formula:
 *   base_weight(status) x evidence_multiplier x confidence_mid
 *
 * evidence_multiplier = min(2.0, 1.0 + factSupports * 0.2 + opinionSupports * 0.05)
 *
 * - factSupports: edges in supportingEdges with status 'fact' or 'observation'
 * - opinionSupports: all other supporting edges
 * - confidence_mid: middle band value, defaults to 1.0 if absent
 */
export declare function computeEvidenceWeight(edge: {
    epistemic_status?: EpistemicStatus | null;
    confidence?: [number, number, number] | null;
}, supportingEdges?: Array<{
    epistemic_status?: EpistemicStatus | null;
}>): number;
/**
 * Append an epistemic transition to an edge's history, capping at FIFO limit.
 * Mutates the edge in place and returns it.
 */
export declare function addEpistemicTransition<T extends {
    epistemic_history?: EpistemicTransition[] | null;
    epistemic_status?: EpistemicStatus | null;
}>(edge: T, transition: EpistemicTransition): T;
