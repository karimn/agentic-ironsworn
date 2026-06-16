import type OpenAI from 'openai';
import type { AzureOpenAI } from 'openai';
import type { EmbedderClient } from '../../contracts';
export interface AzureOpenAIEmbedderOptions {
    /** Pre-configured AzureOpenAI or OpenAI client pointing to an Azure endpoint. */
    client: AzureOpenAI | OpenAI;
    /** Azure deployment name for the embedding model. */
    model?: string;
    /** Truncate embeddings to this dimension. */
    embeddingDim?: number;
}
/**
 * Azure OpenAI embedder for enterprise deployments.
 *
 * Uses a pre-configured AzureOpenAI client (user handles auth and endpoint setup).
 * The `model` field maps to your Azure deployment name for the embedding model.
 */
export declare class AzureOpenAIEmbedder implements EmbedderClient {
    private readonly client;
    private readonly model;
    private readonly embeddingDim;
    constructor(options: AzureOpenAIEmbedderOptions);
    create(inputData: string | string[] | Iterable<number> | Iterable<Iterable<number>>): Promise<number[]>;
    createBatch(inputDataList: string[]): Promise<number[][]>;
}
