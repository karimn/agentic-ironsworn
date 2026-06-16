/**
 * Jina Reranker client for graphiti-ts.
 *
 * Uses the Jina AI Reranker API (https://api.jina.ai/v1/rerank) with
 * jina-reranker-v3 by default. Purpose-built cross-encoder reranker —
 * more accurate than LLM logprob hacking for relevance scoring.
 *
 * Get your Jina AI API key for free: https://jina.ai/?sui=apikey
 */
import type { CrossEncoderClient } from '../../contracts';
export interface JinaRerankerOptions {
    /** Jina API key. Falls back to JINA_API_KEY env var. */
    apiKey?: string;
    /** Reranker model. Default: jina-reranker-v3 */
    model?: string;
    /** Max results to return. Default: return all (sorted by relevance). */
    topN?: number;
}
export declare class JinaRerankerClient implements CrossEncoderClient {
    private readonly apiKey;
    private readonly model;
    private readonly topN?;
    constructor(options?: JinaRerankerOptions);
    rank(query: string, passages: string[]): Promise<Array<[string, number]>>;
}
