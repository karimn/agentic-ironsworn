/**
 * GLiNER2 client — port of Python's gliner2_client.py.
 *
 * GLiNER2 is a lightweight entity extraction model. This TS port calls a REST
 * API endpoint serving the model (e.g., via FastAPI wrapper or GLiNER2 API).
 *
 * For entity extraction operations, this client calls the GLiNER2 service.
 * For all other operations (dedup, summarization, etc.), it delegates to a
 * general-purpose LLM client.
 */
import type { GenerateResponseOptions, LLMClient } from '../../contracts';
import type { Tracer } from '../../tracing';
import type { LLMConfig } from '../../llm/config';
import type { Message } from '../../prompts/types';
import { type GenerateResponseContext } from '../../llm/generate-response';
export interface GLiNER2ClientOptions {
    config?: Partial<LLMConfig>;
    endpoint?: string;
    threshold?: number;
    /** Required: fallback LLM for non-extraction operations */
    llm_client: LLMClient;
}
export declare class GLiNER2Client implements LLMClient {
    readonly model: string;
    readonly small_model: string;
    private readonly endpoint;
    private readonly threshold;
    private readonly llmClient;
    private tracer;
    constructor(options: GLiNER2ClientOptions);
    setTracer(tracer: Tracer): void;
    generateText(messages: Message[]): Promise<string>;
    generateResponse(messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
}
