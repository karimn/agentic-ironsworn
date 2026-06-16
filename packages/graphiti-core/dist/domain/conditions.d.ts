/**
 * Conditional edge awareness — edges that are only valid under certain conditions.
 *
 * Example: "Use Ollama for embeddings" requires Grandier to be online.
 * The edge stores conditions as an array of EdgeCondition objects.
 * At query time, evaluateConditions() checks whether all conditions are met
 * given a map of current entity states.
 */
export type ConditionState = 'active' | 'inactive' | 'any';
export type ConditionRelationship = 'requires' | 'blocked_by';
export interface EdgeCondition {
    entity_uuid: string;
    entity_name: string;
    required_state: ConditionState;
    relationship: ConditionRelationship;
}
/**
 * Validate the structure of an EdgeCondition array.
 * Returns true for null/undefined/empty (unconditional edges).
 * Throws for structurally invalid conditions.
 */
export declare function validateConditions(conditions: EdgeCondition[] | null | undefined): boolean;
/**
 * Evaluate whether all conditions are met given current entity states.
 *
 * - null/undefined/empty conditions = unconditional, always true.
 * - All conditions must be satisfied (AND semantics).
 * - Unknown entities (not in entityStates) = condition not met.
 * - required_state 'any' = matches any known state (but still requires the entity to be known).
 */
export declare function evaluateConditions(conditions: EdgeCondition[] | null | undefined, entityStates: Record<string, ConditionState>): boolean;
