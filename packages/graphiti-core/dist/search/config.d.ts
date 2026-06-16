import type { CommunityNode, EntityNode, EpisodicNode } from '../domain/nodes';
import type { EntityEdge } from '../domain/edges';
export declare const EdgeSearchMethods: {
    readonly cosine_similarity: "cosine_similarity";
    readonly bm25: "bm25";
    readonly bfs: "breadth_first_search";
};
export declare const NodeSearchMethods: {
    readonly cosine_similarity: "cosine_similarity";
    readonly bm25: "bm25";
    readonly bfs: "breadth_first_search";
};
export declare const EpisodeSearchMethods: {
    readonly bm25: "bm25";
};
export declare const CommunitySearchMethods: {
    readonly cosine_similarity: "cosine_similarity";
    readonly bm25: "bm25";
};
export declare const EdgeRerankers: {
    readonly rrf: "reciprocal_rank_fusion";
    readonly node_distance: "node_distance";
    readonly episode_mentions: "episode_mentions";
    readonly mmr: "mmr";
    readonly cross_encoder: "cross_encoder";
};
export declare const NodeRerankers: {
    readonly rrf: "reciprocal_rank_fusion";
    readonly node_distance: "node_distance";
    readonly episode_mentions: "episode_mentions";
    readonly mmr: "mmr";
    readonly cross_encoder: "cross_encoder";
};
export declare const EpisodeRerankers: {
    readonly rrf: "reciprocal_rank_fusion";
    readonly cross_encoder: "cross_encoder";
};
export declare const CommunityRerankers: {
    readonly rrf: "reciprocal_rank_fusion";
    readonly mmr: "mmr";
    readonly cross_encoder: "cross_encoder";
};
export type EdgeSearchMethod = (typeof EdgeSearchMethods)[keyof typeof EdgeSearchMethods];
export type NodeSearchMethod = (typeof NodeSearchMethods)[keyof typeof NodeSearchMethods];
export type EpisodeSearchMethod = (typeof EpisodeSearchMethods)[keyof typeof EpisodeSearchMethods];
export type CommunitySearchMethod = (typeof CommunitySearchMethods)[keyof typeof CommunitySearchMethods];
export type EdgeReranker = (typeof EdgeRerankers)[keyof typeof EdgeRerankers];
export type NodeReranker = (typeof NodeRerankers)[keyof typeof NodeRerankers];
export type EpisodeReranker = (typeof EpisodeRerankers)[keyof typeof EpisodeRerankers];
export type CommunityReranker = (typeof CommunityRerankers)[keyof typeof CommunityRerankers];
export interface EdgeSearchConfig {
    search_methods: EdgeSearchMethod[];
    reranker: EdgeReranker;
    sim_min_score: number;
    mmr_lambda: number;
    bfs_max_depth: number;
}
export interface NodeSearchConfig {
    search_methods: NodeSearchMethod[];
    reranker: NodeReranker;
    sim_min_score: number;
    mmr_lambda: number;
    bfs_max_depth: number;
}
export interface EpisodeSearchConfig {
    search_methods: EpisodeSearchMethod[];
    reranker: EpisodeReranker;
    sim_min_score: number;
    mmr_lambda: number;
    bfs_max_depth: number;
}
export interface CommunitySearchConfig {
    search_methods: CommunitySearchMethod[];
    reranker: CommunityReranker;
    sim_min_score: number;
    mmr_lambda: number;
    bfs_max_depth: number;
}
export interface SearchConfig {
    edge_config?: EdgeSearchConfig | null;
    node_config?: NodeSearchConfig | null;
    episode_config?: EpisodeSearchConfig | null;
    community_config?: CommunitySearchConfig | null;
    limit: number;
    reranker_min_score: number;
}
export interface SearchResults {
    edges: EntityEdge[];
    edge_reranker_scores: number[];
    nodes: EntityNode[];
    node_reranker_scores: number[];
    episodes: EpisodicNode[];
    episode_reranker_scores: number[];
    communities: CommunityNode[];
    community_reranker_scores: number[];
}
export declare function createEdgeSearchConfig(overrides?: Partial<EdgeSearchConfig>): EdgeSearchConfig;
export declare function createNodeSearchConfig(overrides?: Partial<NodeSearchConfig>): NodeSearchConfig;
export declare function createEpisodeSearchConfig(overrides?: Partial<EpisodeSearchConfig>): EpisodeSearchConfig;
export declare function createCommunitySearchConfig(overrides?: Partial<CommunitySearchConfig>): CommunitySearchConfig;
export declare function createSearchConfig(overrides?: Partial<SearchConfig>): SearchConfig;
export declare function createSearchResults(overrides?: Partial<SearchResults>): SearchResults;
export declare function mergeSearchResults(resultsList: SearchResults[]): SearchResults;
