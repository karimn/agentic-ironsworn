import OpenAI from 'openai';
import type { EmbedderClient } from '../../contracts';
export interface OpenAIEmbedderConfig {
    embeddingModel?: string;
    embeddingDim?: number;
    apiKey?: string | null;
    baseUrl?: string | null;
}
export declare class OpenAIEmbedder implements EmbedderClient {
    private readonly client;
    private readonly embeddingModel;
    private readonly embeddingDim;
    constructor(config?: OpenAIEmbedderConfig, client?: OpenAI);
    create(inputData: string | string[] | Iterable<number> | Iterable<Iterable<number>>): Promise<number[]>;
    createBatch(inputDataList: string[]): Promise<number[][]>;
}
