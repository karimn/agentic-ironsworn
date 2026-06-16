import type { LLMClient } from '../contracts';
import type { EntityEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
import { type Message } from '../prompts/types';
export interface EpisodeExtractionContext {
    episode: EpisodicNode;
    previous_episodes: EpisodicNode[];
}
export interface EpisodeExtractionResult {
    entities: EntityNode[];
    entity_edges: EntityEdge[];
}
export interface EpisodeExtractor {
    extract(context: EpisodeExtractionContext): Promise<EpisodeExtractionResult>;
}
export declare class HeuristicEpisodeExtractor implements EpisodeExtractor {
    extract(context: EpisodeExtractionContext): Promise<EpisodeExtractionResult>;
}
export declare class ModelEpisodeExtractor implements EpisodeExtractor {
    private readonly llmClient;
    private readonly fallbackExtractor;
    constructor(llmClient: LLMClient, fallbackExtractor?: EpisodeExtractor);
    extract(context: EpisodeExtractionContext): Promise<EpisodeExtractionResult>;
}
interface ModelExtractionResponse {
    entities?: Array<{
        name?: string;
        labels?: string[];
        summary?: string;
        aliases?: string[];
    }>;
    entity_edges?: Array<{
        source?: string;
        target?: string;
        name?: string;
        fact?: string;
    }>;
}
export declare function extractEntityNames(content: string): string[];
export declare function extractEntityEdges(content: string, entityByName: Map<string, EntityNode>, episode: EpisodicNode, aliasLookup?: Map<string, string>): EntityEdge[];
export declare function buildEpisodeExtractionPrompt(context: EpisodeExtractionContext): Message[];
export declare function parseModelExtractionResponse(responseText: string): ModelExtractionResponse;
export declare function mapModelExtractionResponse(context: EpisodeExtractionContext, responseText: string): EpisodeExtractionResult;
export {};
