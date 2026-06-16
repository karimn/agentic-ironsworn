/**
 * Concurrency helpers — port of Python's semaphore_gather().
 */
/**
 * Execute async functions with bounded concurrency.
 * Port of Python's semaphore_gather().
 *
 * @param tasks - Array of async functions to execute
 * @param maxConcurrency - Maximum number of concurrent executions (default: 10)
 * @returns Array of results in the same order as input tasks
 */
export declare function semaphoreGather<T>(tasks: Array<() => Promise<T>>, maxConcurrency?: number): Promise<T[]>;
