import type { GenerativeModel } from '@google/generative-ai';
import type { EmbedderClient } from '../../contracts';
export interface GeminiEmbedderConfig {
    embeddingModel?: string;
    apiKey?: string | null;
}
export interface GeminiEmbedderDeps {
    model?: GenerativeModel;
}
export declare class GeminiEmbedder implements EmbedderClient {
    private readonly generativeModel;
    constructor(config?: GeminiEmbedderConfig, deps?: GeminiEmbedderDeps);
    create(inputData: string | string[] | Iterable<number> | Iterable<Iterable<number>>): Promise<number[]>;
    createBatch(inputDataList: string[]): Promise<number[][]>;
}
