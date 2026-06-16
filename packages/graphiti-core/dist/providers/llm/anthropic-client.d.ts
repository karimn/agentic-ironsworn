import Anthropic from '@anthropic-ai/sdk';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface AnthropicClientOptions {
    config?: Partial<LLMConfig>;
    client?: Anthropic;
}
export declare class AnthropicClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private tracer;
    constructor(options?: AnthropicClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
