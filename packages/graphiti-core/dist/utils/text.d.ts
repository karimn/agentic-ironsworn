export declare const MAX_SUMMARY_CHARS = 500;
/**
 * Escape Lucene special characters in a query string.
 * Port of Python's lucene_sanitize().
 */
export declare function luceneSanitize(query: string): string;
/**
 * L2-normalize an embedding vector.
 * Port of Python's normalize_l2() (without numpy dependency).
 */
export declare function normalizeL2(embedding: number[]): number[];
/**
 * Truncate text at the last sentence boundary within maxChars.
 * Port of Python's truncate_at_sentence().
 */
/**
 * Build a sanitized fulltext search query string.
 * Port of Python's driver.build_fulltext_query().
 */
export declare function buildFulltextQuery(query: string, groupIds?: string[] | null, maxQueryLength?: number): string;
export declare function truncateAtSentence(text: string, maxChars: number): string;
