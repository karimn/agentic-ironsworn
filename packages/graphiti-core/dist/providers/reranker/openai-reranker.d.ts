import OpenAI from 'openai';
import type { CrossEncoderClient } from '../../contracts';
import type { LLMConfig } from '../../llm/config';
export interface OpenAIRerankerOptions {
    config?: Partial<LLMConfig>;
    client?: OpenAI;
}
export declare class OpenAIRerankerClient implements CrossEncoderClient {
    private readonly client;
    private readonly model;
    constructor(options?: OpenAIRerankerOptions);
    rank(query: string, passages: string[]): Promise<Array<[string, number]>>;
    private scorePassage;
}
