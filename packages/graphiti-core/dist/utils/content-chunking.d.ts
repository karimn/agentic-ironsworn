/**
 * Content chunking utilities — port of Python's graphiti_core/utils/content_chunking.py.
 *
 * Splits large content into smaller overlapping chunks that preserve
 * natural boundaries (sentences, JSON elements, message boundaries).
 */
/**
 * Estimate token count from text length (~4 chars per token).
 */
export declare function estimateTokens(text: string): number;
/**
 * Determine whether content should be chunked.
 * Returns true if content exceeds chunkSizeTokens and is likely entity-dense.
 */
export declare function shouldChunk(content: string, episodeType: 'message' | 'json' | 'text', chunkSizeTokens?: number): boolean;
/**
 * Chunk JSON content at element/key boundaries.
 */
export declare function chunkJsonContent(content: string, chunkSizeTokens?: number, overlapTokens?: number): string[];
/**
 * Chunk text content at paragraph/sentence boundaries.
 */
export declare function chunkTextContent(content: string, chunkSizeTokens?: number, overlapTokens?: number): string[];
/**
 * Chunk message content preserving message boundaries.
 * Supports JSON arrays of messages or "Speaker: message" format.
 */
export declare function chunkMessageContent(content: string, chunkSizeTokens?: number, overlapTokens?: number): string[];
