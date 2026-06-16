/**
 * Staleness Scoring for knowledge graph edges.
 *
 * Computes an on-the-fly freshness signal (0.0 = fresh, 1.0 = stale) for any
 * edge at query time. The score is never persisted — it is derived from:
 *   - how old the edge is (sigmoid over age_days)
 *   - how many times it has been reinforced (reduces base staleness)
 *   - how recently it was last reinforced (recency window dampening)
 *   - the expected change rate of the edge's entity type (domain velocity)
 */
/** Sigmoid steepness — controls how sharply the score rises with age. */
export declare const STALENESS_SLOPE = 0.05;
/** Age in days at which the sigmoid produces a staleness score of 0.5. */
export declare const STALENESS_MIDPOINT_DAYS = 90;
/** Per-reinforcement reduction factor applied to the base age factor. */
export declare const REINFORCEMENT_DECAY = 0.1;
/**
 * Days within which a reinforcement is considered "recent."
 * Reinforcements older than this window apply a full recency penalty.
 */
export declare const RECENCY_WINDOW_DAYS = 60;
/** Input factors required to compute a staleness score. */
export interface StalenessFactors {
    /** Age of the edge in days since it was created or last updated. */
    age_days: number;
    /**
     * Days since the edge was last reinforced.
     * `null` when the edge has never been reinforced.
     */
    last_reinforced_days: number | null;
    /** Expected change rate for the entity type (0.0–1.0). */
    domain_velocity: number;
    /** Total number of times the edge has been reinforced. */
    reinforcement_count: number;
}
/**
 * Default domain velocity per entity type.
 *
 * Higher values mean the entity type changes frequently (e.g., Tool configs
 * change more often than a Person's identity). Used as a multiplier in
 * `computeStaleness` so fast-moving domains age more aggressively.
 */
export declare const DOMAIN_VELOCITY: Record<string, number>;
/**
 * Compute a staleness score for an edge given its lifecycle factors.
 *
 * @returns A value in [0.0, 1.0] where 0.0 is fully fresh and 1.0 is maximally stale.
 *
 * Calculation:
 *   ageFactor           = sigmoid(age_days, STALENESS_SLOPE, STALENESS_MIDPOINT_DAYS)
 *   reinforcementFactor = max(0, 1 - reinforcement_count × REINFORCEMENT_DECAY)
 *   velocityMultiplier  = 0.5 + domain_velocity
 *   recencyFactor       = last_reinforced_days !== null
 *                           ? min(1, last_reinforced_days / RECENCY_WINDOW_DAYS)
 *                           : 1
 *   result              = clamp(ageFactor × reinforcementFactor × velocityMultiplier × recencyFactor, 0, 1)
 */
export declare function computeStaleness(factors: StalenessFactors): number;
