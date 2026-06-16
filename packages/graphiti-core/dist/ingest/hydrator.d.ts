import type { LLMClient } from '../contracts';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
import type { EntityEdge } from '../domain/edges';
import { type Message } from '../prompts/types';
export interface NodeHydrationContext {
    episode: EpisodicNode;
    previous_episodes: EpisodicNode[];
    entities: EntityNode[];
    entity_edges: EntityEdge[];
}
export interface NodeHydrator {
    hydrate(context: NodeHydrationContext): Promise<EntityNode[]>;
}
export declare class HeuristicNodeHydrator implements NodeHydrator {
    hydrate(context: NodeHydrationContext): Promise<EntityNode[]>;
}
export declare class ModelNodeHydrator implements NodeHydrator {
    private readonly llmClient;
    private readonly fallbackHydrator;
    constructor(llmClient: LLMClient, fallbackHydrator?: NodeHydrator);
    hydrate(context: NodeHydrationContext): Promise<EntityNode[]>;
}
interface ModelHydrationResponse {
    entities?: Array<{
        uuid?: string;
        name?: string;
        summary?: string;
        attributes?: Record<string, unknown>;
    }>;
}
export declare function splitIntoSentences(content: string): string[];
export declare function buildNodeHydrationPrompt(context: NodeHydrationContext): Message[];
export declare function parseModelHydrationResponse(responseText: string): ModelHydrationResponse;
export declare function mapModelHydrationResponse(baseline: EntityNode[], responseText: string, currentSeenAt?: Date): EntityNode[];
export {};
