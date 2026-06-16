import type { EmbedderClient } from '../../contracts';
export interface VoyageEmbedderConfig {
    embeddingModel?: string;
    embeddingDim?: number;
    apiKey?: string | null;
    apiUrl?: string;
}
/**
 * Voyage AI embedder for high-quality retrieval embeddings.
 *
 * Uses Voyage AI's REST API directly (no SDK dependency required).
 * Default model: voyage-3 (1024 dimensions).
 */
export declare class VoyageEmbedder implements EmbedderClient {
    private readonly apiKey;
    private readonly apiUrl;
    private readonly embeddingModel;
    private readonly embeddingDim;
    constructor(config?: VoyageEmbedderConfig);
    create(inputData: string | string[] | Iterable<number> | Iterable<Iterable<number>>): Promise<number[]>;
    createBatch(inputDataList: string[]): Promise<number[][]>;
    private fetchEmbeddings;
}
