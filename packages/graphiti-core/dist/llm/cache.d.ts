/**
 * LLM response cache — port of Python's graphiti_core/llm_client/cache.py.
 *
 * In-memory cache for LLM responses. Python uses SQLite; TS uses a Map
 * since the cache is ephemeral within a session and avoids native deps.
 */
export declare class LLMCache {
    private cache;
    private readonly maxSize;
    constructor(maxSize?: number);
    /**
     * Retrieve a cached response by key, or null if not found.
     */
    get(key: string): Record<string, unknown> | null;
    /**
     * Store a response in the cache. Only JSON-serializable data is stored.
     */
    set(key: string, value: Record<string, unknown>): void;
    /**
     * Clear all cached entries.
     */
    close(): void;
    /**
     * Number of cached entries.
     */
    get size(): number;
}
