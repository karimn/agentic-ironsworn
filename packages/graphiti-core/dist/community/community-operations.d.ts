import type { EmbedderClient, GraphDriver, LLMClient } from '../contracts';
import type { CommunityEdge } from '../domain/edges';
import type { CommunityNode, EntityNode } from '../domain/nodes';
export declare const MAX_COMMUNITY_BUILD_CONCURRENCY = 10;
export interface Neighbor {
    node_uuid: string;
    edge_count: number;
}
export declare function labelPropagation(projection: Map<string, Neighbor[]>): string[][];
export interface EntityNodeNamespaceReader {
    getByGroupIds(groupIds: string[]): Promise<EntityNode[]>;
    getByUuids(uuids: string[]): Promise<EntityNode[]>;
}
export declare function getCommunityClusters(driver: GraphDriver, entityNodes: EntityNodeNamespaceReader, groupIds: string[] | null): Promise<EntityNode[][]>;
export declare function summarizePair(llmClient: LLMClient, summaryPair: [string, string]): Promise<string>;
export declare function generateSummaryDescription(llmClient: LLMClient, summary: string): Promise<string>;
export declare function buildCommunityEdges(entityNodes: EntityNode[], communityNode: CommunityNode, createdAt: Date): CommunityEdge[];
export declare function buildCommunity(llmClient: LLMClient, communityCluster: EntityNode[]): Promise<[CommunityNode, CommunityEdge[]]>;
export declare function buildCommunities(driver: GraphDriver, llmClient: LLMClient, entityNodes: EntityNodeNamespaceReader, groupIds: string[] | null): Promise<[CommunityNode[], CommunityEdge[]]>;
export declare function removeCommunities(driver: GraphDriver): Promise<void>;
export declare function determineEntityCommunity(driver: GraphDriver, entity: EntityNode): Promise<[CommunityNode | null, boolean]>;
export interface CommunityNamespaceWriter {
    node: {
        save(node: CommunityNode): Promise<CommunityNode>;
    };
    edge: {
        save(edge: CommunityEdge): Promise<CommunityEdge>;
    };
}
export declare function updateCommunity(driver: GraphDriver, llmClient: LLMClient, embedder: EmbedderClient, communityNamespace: CommunityNamespaceWriter, entity: EntityNode): Promise<[CommunityNode[], CommunityEdge[]]>;
