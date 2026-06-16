/**
 * Semantic negation pre-filter for edge contradiction detection.
 *
 * Scans new fact text for linguistic markers that strongly or moderately
 * suggest a prior fact is being negated. When a high-confidence signal is
 * found alongside shared entities, the LLM contradiction call can be skipped
 * entirely and the old edge invalidated directly.
 *
 * Two confidence tiers:
 *   - HIGH  — verb phrases that almost always negate a prior state
 *             ("no longer uses", "deprecated", "replaced by", …)
 *   - MEDIUM — hedged or ambiguous markers that suggest past context
 *             ("previously", "used to", "instead of", …)
 */
/**
 * Patterns that indicate a near-certain negation of a prior fact.
 * When matched alongside shared entities, the LLM call may be skipped.
 */
export declare const HIGH_CONFIDENCE_NEGATION: RegExp[];
/**
 * Patterns that suggest a prior fact may have been superseded but are not
 * definitive enough to skip the LLM contradiction check.
 */
export declare const MEDIUM_CONFIDENCE_NEGATION: RegExp[];
/** Result of scanning a new fact for negation markers. */
export interface NegationSignal {
    /** Detected confidence level. 'none' means no negation marker was found. */
    confidence: 'high' | 'medium' | 'none';
    /**
     * The `source` property of the matched RegExp, or an empty string when
     * confidence is 'none'. Useful for logging and downstream decisions.
     */
    pattern: string;
}
/**
 * Scan `newFact` for negation markers and return a confidence signal.
 *
 * Decision logic:
 * 1. If a HIGH_CONFIDENCE pattern matches AND `sharedEntities` is non-empty
 *    → `{ confidence: 'high', pattern }`
 * 2. If a HIGH_CONFIDENCE pattern matches but no shared entities
 *    → downgrade to `{ confidence: 'medium', pattern }`
 * 3. If a MEDIUM_CONFIDENCE pattern matches (entity overlap irrelevant)
 *    → `{ confidence: 'medium', pattern }`
 * 4. No match → `{ confidence: 'none', pattern: '' }`
 *
 * @param newFact       The incoming fact text being evaluated.
 * @param existingFact  The prior fact text (reserved for future semantic use).
 * @param sharedEntities Named entities that appear in both facts.
 */
export declare function detectNegation(newFact: string, existingFact: string, sharedEntities: string[]): NegationSignal;
