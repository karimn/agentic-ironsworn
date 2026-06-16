import OpenAI from 'openai';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface OpenAIClientOptions {
    config?: Partial<LLMConfig>;
    client?: OpenAI;
}
export declare class OpenAIClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private tracer;
    constructor(options?: OpenAIClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
