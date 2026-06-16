/**
 * BGE Reranker client — port of Python's bge_reranker_client.py.
 *
 * The Python version uses sentence-transformers (native Python). This TS port
 * calls a REST API endpoint that serves a BGE reranker model (e.g., via
 * text-embeddings-inference, FastAPI wrapper, or any compatible service).
 *
 * If no endpoint is available, use the OpenAI or Gemini reranker instead.
 */
import type { CrossEncoderClient } from '../../contracts';
export interface BGERerankerOptions {
    endpoint?: string;
    model?: string;
}
export declare class BGERerankerClient implements CrossEncoderClient {
    private readonly endpoint;
    private readonly model;
    constructor(options?: BGERerankerOptions);
    rank(query: string, passages: string[]): Promise<Array<[string, number]>>;
}
