import OpenAI, { AzureOpenAI } from 'openai';
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface AzureOpenAIClientOptions {
    config?: Partial<LLMConfig>;
    /** Pre-configured AzureOpenAI or OpenAI client pointing to an Azure endpoint. */
    client?: AzureOpenAI | OpenAI;
    /** Azure API version (e.g. '2024-10-21'). Required if no client is provided. */
    apiVersion?: string;
    /** Azure endpoint (e.g. 'https://my-resource.openai.azure.com'). Required if no client is provided. */
    azureEndpoint?: string;
}
/**
 * Azure OpenAI LLM client.
 *
 * Wraps the OpenAI SDK's AzureOpenAI constructor for enterprise deployments
 * with private endpoints, data residency, and Azure AD authentication.
 * The `model` field maps to your Azure deployment name.
 */
export declare class AzureOpenAIClient implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly client;
    private readonly config;
    private tracer;
    constructor(options?: AzureOpenAIClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
