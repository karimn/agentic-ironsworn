import OpenAI from 'openai';
import type { EmbedderClient } from '../../contracts';
export interface OllamaEmbedderConfig {
    embeddingModel?: string;
    embeddingDim?: number;
    baseUrl?: string;
}
/**
 * Ollama embedder using the OpenAI-compatible API endpoint.
 *
 * Ollama serves embedding models at /v1/embeddings, compatible with the
 * OpenAI SDK. Default model is nomic-embed-text (768 dimensions).
 */
export declare class OllamaEmbedder implements EmbedderClient {
    private readonly client;
    private readonly embeddingModel;
    private readonly embeddingDim;
    constructor(config?: OllamaEmbedderConfig, client?: OpenAI);
    create(inputData: string | string[] | Iterable<number> | Iterable<Iterable<number>>): Promise<number[]>;
    createBatch(inputDataList: string[]): Promise<number[][]>;
}
