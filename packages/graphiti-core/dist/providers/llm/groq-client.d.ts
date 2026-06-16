import OpenAI from 'openai';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface GroqClientOptions {
    config?: Partial<LLMConfig>;
    client?: OpenAI;
}
/**
 * Groq LLM client for ultra-fast inference on open models.
 *
 * Groq's API is OpenAI-compatible, so this wraps the OpenAI SDK with
 * Groq's base URL (https://api.groq.com/openai/v1) and sensible defaults
 * for Groq-hosted models (Llama, Mixtral, etc.).
 */
export declare class GroqClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private tracer;
    constructor(options?: GroqClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
