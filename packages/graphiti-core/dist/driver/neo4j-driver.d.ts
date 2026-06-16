import type { AsyncDisposableTransaction, GraphDriverSession, QueryOptions, QueryResult } from '../contracts';
import { BaseGraphDriver } from './graph-driver';
import type { CommunityEdgeOperations } from './operations/community-edge-operations';
import type { CommunityNodeOperations } from './operations/community-node-operations';
import type { EntityEdgeOperations } from './operations/entity-edge-operations';
import type { EntityNodeOperations } from './operations/entity-node-operations';
import type { EpisodeNodeOperations } from './operations/episode-node-operations';
import type { EpisodicEdgeOperations } from './operations/episodic-edge-operations';
import type { SagaNodeOperations } from './operations/saga-node-operations';
import type { HasEpisodeEdgeOperations } from './operations/has-episode-edge-operations';
import type { NextEpisodeEdgeOperations } from './operations/next-episode-edge-operations';
import type { GraphMaintenanceOperations } from './operations/graph-maintenance-operations';
import type { SearchOperations } from './operations/search-operations';
export interface Neo4jConnectionConfig {
    uri: string;
    user: string | null;
    password: string | null;
    database?: string;
}
export interface Neo4jClientAdapter {
    executeQuery<RecordShape = unknown>(query: string, options: {
        parameters: Record<string, unknown>;
        database: string;
        routing?: 'r' | 'w';
    }): Promise<QueryResult<RecordShape>>;
    session(database: string): GraphDriverSession;
    close(): Promise<void>;
    verifyConnectivity?(): Promise<void>;
}
export interface Neo4jOperationsRegistry {
    entity_node_ops?: EntityNodeOperations;
    episode_node_ops?: EpisodeNodeOperations;
    community_node_ops?: CommunityNodeOperations;
    saga_node_ops?: SagaNodeOperations;
    entity_edge_ops?: EntityEdgeOperations;
    episodic_edge_ops?: EpisodicEdgeOperations;
    community_edge_ops?: CommunityEdgeOperations;
    has_episode_edge_ops?: HasEpisodeEdgeOperations;
    next_episode_edge_ops?: NextEpisodeEdgeOperations;
    search_ops?: SearchOperations;
    graph_ops?: GraphMaintenanceOperations;
}
export declare class Neo4jDriver extends BaseGraphDriver {
    readonly provider: "neo4j";
    readonly default_group_id = "";
    readonly config: Neo4jConnectionConfig;
    readonly client: Neo4jClientAdapter;
    readonly operations: Neo4jOperationsRegistry;
    readonly entityNodeOps: EntityNodeOperations;
    readonly episodeNodeOps: EpisodeNodeOperations;
    readonly communityNodeOps: CommunityNodeOperations;
    readonly communityEdgeOps: CommunityEdgeOperations;
    readonly entityEdgeOps: EntityEdgeOperations;
    readonly episodicEdgeOps: EpisodicEdgeOperations;
    readonly sagaNodeOps: SagaNodeOperations;
    readonly hasEpisodeEdgeOps: HasEpisodeEdgeOperations;
    readonly nextEpisodeEdgeOps: NextEpisodeEdgeOperations;
    readonly graphOps: GraphMaintenanceOperations;
    readonly searchOps: SearchOperations;
    constructor(config: Neo4jConnectionConfig, client: Neo4jClientAdapter, operations?: Neo4jOperationsRegistry);
    executeQuery<RecordShape = unknown>(cypherQuery: string, options?: QueryOptions): Promise<QueryResult<RecordShape>>;
    session(database?: string): GraphDriverSession;
    transaction(): Promise<AsyncDisposableTransaction>;
    close(): Promise<void>;
    deleteAllIndexes(): Promise<void>;
    buildIndicesAndConstraints(deleteExisting?: boolean): Promise<void>;
    healthCheck(): Promise<void>;
}
export declare function createNeo4jClientAdapter(config: Neo4jConnectionConfig): Neo4jClientAdapter;
