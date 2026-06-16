/**
 * FalkorDB multi-group routing — port of Python's handle_multiple_group_ids decorator.
 *
 * In FalkorDB, each group_id maps to a separate database/graph. When a method
 * receives multiple group_ids, we need to:
 * 1. Execute the operation concurrently for each group_id with a cloned driver
 * 2. Merge the results
 *
 * For Neo4j, group_id is just a property filter within a single database,
 * so this routing is not needed.
 */
import type { GraphDriver } from '../contracts';
/**
 * Check if the driver is FalkorDB and we have multiple group_ids that need routing.
 */
export declare function needsMultiGroupRouting(driver: GraphDriver, groupIds: string[] | null | undefined): boolean;
/**
 * Execute an async function for each group_id with a cloned FalkorDB driver,
 * then merge the results.
 *
 * This is the TypeScript equivalent of Python's @handle_multiple_group_ids decorator.
 *
 * @param driver - The FalkorDB driver to clone per group
 * @param groupIds - The group IDs to route across
 * @param fn - The async function to execute per group. Receives (clonedDriver, singleGroupIds).
 * @param maxCoroutines - Concurrency limit for parallel execution
 */
export declare function executeWithMultiGroupRouting<T>(driver: GraphDriver, groupIds: string[], fn: (driver: GraphDriver, groupIds: string[]) => Promise<T>, maxCoroutines?: number | null): Promise<T>;
