import type { GenerativeModel } from '@google/generative-ai';
import type { CrossEncoderClient } from '../../contracts';
import type { LLMConfig } from '../../llm/config';
export interface GeminiRerankerOptions {
    config?: Partial<LLMConfig>;
    model?: GenerativeModel;
}
/**
 * Gemini reranker that scores passages on a 0-100 scale via direct LLM scoring.
 *
 * Unlike the OpenAI reranker (which uses logprobs), Gemini's API does not support
 * logprobs, so each passage is scored individually with a numeric relevance prompt.
 */
export declare class GeminiRerankerClient implements CrossEncoderClient {
    private readonly generativeModel;
    private readonly modelName;
    constructor(options?: GeminiRerankerOptions);
    rank(query: string, passages: string[]): Promise<Array<[string, number]>>;
    private scorePassage;
}
