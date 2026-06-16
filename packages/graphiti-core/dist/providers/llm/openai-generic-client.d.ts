/**
 * Generic OpenAI-compatible LLM client — port of Python's openai_generic_client.py.
 *
 * Works with any API that follows the OpenAI chat completion spec:
 * LocalAI, vLLM, LiteLLM, text-generation-inference, etc.
 */
import OpenAI from 'openai';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface OpenAIGenericClientOptions {
    config?: Partial<LLMConfig>;
    client?: OpenAI;
    max_tokens?: number;
}
export declare class OpenAIGenericClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private readonly maxTokens;
    private tracer;
    constructor(options?: OpenAIGenericClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
