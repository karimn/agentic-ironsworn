import OpenAI from 'openai';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface OllamaClientOptions {
    config?: Partial<LLMConfig>;
    client?: OpenAI;
}
/**
 * Ollama LLM client using the OpenAI-compatible API endpoint.
 *
 * Ollama exposes an OpenAI-compatible REST API at /v1, so this client
 * wraps the OpenAI SDK with Ollama-specific defaults (base URL, API key
 * placeholder, higher max_tokens for local models).
 */
export declare class OllamaClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private tracer;
    constructor(options?: OllamaClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
