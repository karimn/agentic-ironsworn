import { type CommunityNamespaceApi } from './namespaces/communities';
import { type EdgeNamespaceApi } from './namespaces/edges';
import { type NodeNamespaceApi } from './namespaces/nodes';
import { type Tracer } from './tracing';
import { TokenUsageTracker } from './llm/token-tracker';
import { LLMCache } from './llm/cache';
import type { CrossEncoderClient, EmbedderClient, GraphDriver, GraphitiClients, LLMClient } from './contracts';
import type { CommunityEdge, EntityEdge, EpisodicEdge } from './domain/edges';
import type { CommunityNode, EntityNode, EpisodicNode, SagaNode } from './domain/nodes';
import type { EpisodeType } from './domain/nodes';
import { type EpisodeExtractor, type EpisodeExtractionResult } from './ingest/extractor';
import { type NodeHydrator } from './ingest/hydrator';
import type { SearchConfig, SearchResults } from './search/config';
import { type SearchFilters } from './search/filters';
import { type EntityTypeDefinition } from './maintenance/node-operations';
import { type EdgeTypeDefinition } from './maintenance/edge-operations';
import { type RawEpisode } from './maintenance/bulk-utils';
export interface GraphitiOptions {
    driver: GraphDriver;
    llm_client?: LLMClient | null;
    embedder?: EmbedderClient | null;
    cross_encoder?: CrossEncoderClient | null;
    episode_extractor?: EpisodeExtractor | null;
    node_hydrator?: NodeHydrator | null;
    tracer?: Tracer | null;
    /** Whether to store raw episode content. Defaults to true. */
    store_raw_episode_content?: boolean;
    /** Maximum number of concurrent operations. Defaults to 20. */
    max_coroutines?: number;
    /** Enable LLM response caching. Defaults to false. */
    cache_enabled?: boolean;
}
export interface AddTripletInput {
    source: EntityNode;
    edge: EntityEdge;
    target: EntityNode;
}
export interface AddTripletResult {
    nodes: [EntityNode, EntityNode];
    edges: [EntityEdge];
}
export interface AddEpisodeInput {
    episode: EpisodicNode;
    entities?: EntityNode[];
    entity_edges?: EntityEdge[];
}
export interface AddEpisodeResult {
    episode: EpisodicNode;
    episodic_edges: EpisodicEdge[];
    nodes: EntityNode[];
    edges: EntityEdge[];
    communities: CommunityNode[];
    community_edges: CommunityEdge[];
}
export interface AddBulkEpisodeResults {
    episodes: EpisodicNode[];
    episodic_edges: EpisodicEdge[];
    nodes: EntityNode[];
    edges: EntityEdge[];
    communities: CommunityNode[];
    community_edges: CommunityEdge[];
}
export interface IngestEpisodeInput {
    episode: EpisodicNode;
    previous_episode_count?: number;
    update_communities?: boolean;
    extraction_instructions?: string;
}
export interface IngestEpisodeResult {
    episode: EpisodicNode;
    episodic_edges: EpisodicEdge[];
    nodes: EntityNode[];
    edges: EntityEdge[];
    communities: CommunityNode[];
    community_edges: CommunityEdge[];
    previous_episodes: EpisodicNode[];
    extraction: EpisodeExtractionResult;
}
export interface IngestEpisodesInput {
    episodes: IngestEpisodeInput[];
}
export interface IngestEpisodesResult {
    episodes: IngestEpisodeResult[];
}
/**
 * Input for the Python-parity add_episode() method.
 * This is the primary ingestion API matching Python's full parameter set.
 */
export interface AddEpisodeFullInput {
    name: string;
    episode_body: string;
    source_description: string;
    reference_time: Date;
    source?: EpisodeType;
    group_id?: string | null;
    uuid?: string | null;
    update_communities?: boolean;
    entity_types?: Record<string, EntityTypeDefinition> | null;
    excluded_entity_types?: string[] | null;
    edge_types?: Record<string, EdgeTypeDefinition> | null;
    edge_type_map?: Record<string, string[]> | null;
    custom_extraction_instructions?: string | null;
    previous_episode_uuids?: string[] | null;
    saga?: string | SagaNode | null;
    saga_previous_episode_uuid?: string | null;
}
/**
 * Input for the Python-parity add_episode_bulk() method.
 */
export interface AddEpisodeBulkInput {
    bulk_episodes: RawEpisode[];
    group_id?: string | null;
    entity_types?: Record<string, EntityTypeDefinition> | null;
    excluded_entity_types?: string[] | null;
    edge_types?: Record<string, EdgeTypeDefinition> | null;
    edge_type_map?: Record<string, string[]> | null;
    custom_extraction_instructions?: string | null;
    saga?: string | SagaNode | null;
}
export { type RawEpisode } from './maintenance/bulk-utils';
export { type EntityTypeDefinition } from './maintenance/node-operations';
export { type EdgeTypeDefinition } from './maintenance/edge-operations';
export interface GraphitiSearchOptions {
    group_ids?: string[] | null;
    search_filter?: SearchFilters;
    bfs_origin_node_uuids?: string[] | null;
    center_node_uuid?: string | null;
}
export declare class Graphiti {
    driver: GraphDriver;
    readonly llm_client: LLMClient | null;
    readonly embedder: EmbedderClient | null;
    readonly cross_encoder: CrossEncoderClient | null;
    readonly tracer: Tracer;
    readonly episode_extractor: EpisodeExtractor;
    readonly node_hydrator: NodeHydrator;
    clients: GraphitiClients | null;
    readonly nodes: NodeNamespaceApi;
    readonly edges: EdgeNamespaceApi;
    readonly communities: CommunityNamespaceApi;
    readonly tokenTracker: TokenUsageTracker;
    readonly llmCache: LLMCache | null;
    readonly store_raw_episode_content: boolean;
    readonly max_coroutines: number | null;
    constructor(options: GraphitiOptions);
    private _captureInitializationTelemetry;
    close(): Promise<void>;
    buildIndicesAndConstraints(deleteExisting?: boolean): Promise<void>;
    addTriplet(input: AddTripletInput): Promise<AddTripletResult>;
    addEpisode(input: AddEpisodeInput): Promise<AddEpisodeResult>;
    ingestEpisode(input: IngestEpisodeInput): Promise<IngestEpisodeResult>;
    ingestEpisodes(input: IngestEpisodesInput): Promise<IngestEpisodesResult>;
    addEpisodeBulk(inputs: IngestEpisodeInput[]): Promise<IngestEpisodesResult>;
    /**
     * Process an episode and update the graph. Port of Python's add_episode().
     * This is the primary ingestion API with full support for custom entity types,
     * edge types, edge type maps, custom extraction instructions, and sagas.
     */
    addEpisodeFull(input: AddEpisodeFullInput): Promise<AddEpisodeResult>;
    /**
     * Process multiple episodes in bulk with cross-episode dedup.
     * Port of Python's add_episode_bulk().
     */
    addEpisodeBulkFull(input: AddEpisodeBulkInput): Promise<AddBulkEpisodeResults>;
    _getOrCreateSaga(sagaName: string, groupId: string, now: Date): Promise<SagaNode>;
    private _processEpisodeSaga;
    private _saveNextEpisodeEdge;
    private _saveHasEpisodeEdge;
    /**
     * Add a triplet with full resolution against the existing graph.
     * Port of Python's add_triplet() which includes node resolution,
     * edge dedup, and contradiction detection.
     */
    addTripletFull(input: AddTripletInput): Promise<AddTripletResult>;
    private _getEdgesBetweenNodes;
    retrieveEpisodes(groupIds: string[], lastN?: number, referenceTime?: Date | null): Promise<EpisodicNode[]>;
    deleteEntityEdge(uuid: string): Promise<void>;
    /**
     * Mark a single entity edge as deprecated (soft-delete).
     *
     * Idempotent: if the edge already has both `invalid_at` and `expired_at`
     * set, this method returns without touching the database.
     *
     * @param edgeUuid - UUID of the edge to deprecate
     * @param options.reason - Human-readable reason stored in attributes
     * @param options.superseded_by - UUID of the edge that replaces this one
     * @param options.deprecated_at - Override the deprecation timestamp (default: now)
     */
    deprecateEdge(edgeUuid: string, options?: {
        reason?: string;
        superseded_by?: string;
        deprecated_at?: Date;
    }): Promise<void>;
    /**
     * Bulk-deprecate entity edges matching a filter.
     *
     * Only edges that are NOT already deprecated (`invalid_at IS NULL`) are
     * affected. Pass `dryRun: true` to count candidates without writing.
     *
     * @returns `{ count }` — number of edges (would-be-)deprecated
     */
    deprecateEdges(filter: {
        entity_name?: string;
        edge_type?: string;
        older_than?: Date;
        group_id?: string;
    }, options?: {
        reason?: string;
        deprecated_at?: Date;
        dryRun?: boolean;
    }): Promise<{
        count: number;
    }>;
    deleteEpisode(uuid: string): Promise<void>;
    /**
     * Remove an episode with full cleanup — deletes orphaned edges and nodes.
     * Port of Python's `remove_episode()` method.
     *
     * 1. Finds entity edges created by this episode (where it's the first episode in the list)
     * 2. Finds entity nodes only mentioned by this episode
     * 3. Deletes orphaned edges and nodes
     * 4. Deletes the episode itself
     */
    removeEpisode(episodeUuid: string): Promise<void>;
    deleteGroup(groupId: string): Promise<void>;
    clear(): Promise<void>;
    buildCommunities(groupIds?: string[] | null): Promise<{
        nodes: import('./domain/nodes').CommunityNode[];
        edges: import('./domain/edges').CommunityEdge[];
    }>;
    private _buildCommunitiesForGroups;
    updateCommunity(entity: EntityNode): Promise<{
        nodes: import('./domain/nodes').CommunityNode[];
        edges: import('./domain/edges').CommunityEdge[];
    }>;
    private enrichExtractionEmbeddings;
    /**
     * Advanced search returning full SearchResults with nodes, edges, communities, and episodes.
     * This is the TypeScript equivalent of Python's `search_()` method.
     * Alias for `search()` with the same signature.
     */
    advancedSearch(query: string, config: SearchConfig, options?: GraphitiSearchOptions): Promise<SearchResults>;
    searchEdges(query: string, options?: {
        group_ids?: string[] | null;
        center_node_uuid?: string | null;
        num_results?: number;
        search_filter?: SearchFilters;
    }): Promise<SearchResults['edges']>;
    searchAsOf(query: string, asOfDate: Date, options?: {
        group_ids?: string[] | null;
        num_results?: number;
    }): Promise<SearchResults['edges']>;
    getNodesAndEdgesByEpisode(episodeUuids: string[]): Promise<SearchResults>;
    search(query: string, config: SearchConfig, options?: GraphitiSearchOptions): Promise<SearchResults>;
    private _executeSearch;
}
