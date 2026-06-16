/**
 * Shared Cypher RETURN clause fragments for EntityEdge queries.
 *
 * Every query that reads entity edges uses these field lists.
 * When adding new fields to EntityEdge, add them here ONCE.
 */
/**
 * Core relationship fields for entity edge queries (all `e.` prefixed).
 * Does NOT include source/target node UUIDs — compose with node variables as needed.
 *
 * Use directly when the source/target node variable names differ from `source`/`target`,
 * e.g.: `n.uuid AS source_node_uuid, m.uuid AS target_node_uuid, ${ENTITY_EDGE_FIELDS}`
 */
export declare const ENTITY_EDGE_FIELDS: string;
/**
 * Standard RETURN fields for entity edge queries.
 * Use with: MATCH (source:Entity)-[e:RELATES_TO]->(target:Entity)
 *
 * Includes source/target node UUIDs from `source` and `target` variables.
 */
export declare const ENTITY_EDGE_RETURN_FIELDS: string;
