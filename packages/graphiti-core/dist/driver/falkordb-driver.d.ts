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
export interface FalkorConnectionConfig {
    host?: string;
    port?: number;
    username?: string | null;
    password?: string | null;
    url?: string;
    database?: string;
}
export interface FalkorQueryReply<RecordShape = unknown> {
    data?: RecordShape[];
    headers?: string[];
}
export interface FalkorGraphAdapter {
    query<RecordShape = unknown>(query: string, options?: {
        params?: Record<string, unknown>;
    }): Promise<FalkorQueryReply<RecordShape>>;
    roQuery<RecordShape = unknown>(query: string, options?: {
        params?: Record<string, unknown>;
    }): Promise<FalkorQueryReply<RecordShape>>;
    createNodeRangeIndex(label: string, ...properties: string[]): Promise<unknown>;
    createNodeFulltextIndex(label: string, ...properties: string[]): Promise<unknown>;
    createEdgeRangeIndex(label: string, ...properties: string[]): Promise<unknown>;
    createEdgeFulltextIndex(label: string, ...properties: string[]): Promise<unknown>;
    delete(): Promise<void>;
}
export interface FalkorClientAdapter {
    selectGraph(graphId: string): FalkorGraphAdapter;
    close(): Promise<void>;
}
export declare class FalkorDriver extends BaseGraphDriver {
    readonly provider: "falkordb";
    readonly default_group_id = "_";
    readonly config: FalkorConnectionConfig;
    readonly client: FalkorClientAdapter;
    readonly entityNodeOps: EntityNodeOperations;
    readonly communityNodeOps: CommunityNodeOperations;
    readonly communityEdgeOps: CommunityEdgeOperations;
    readonly entityEdgeOps: EntityEdgeOperations;
    readonly episodeNodeOps: EpisodeNodeOperations;
    readonly episodicEdgeOps: EpisodicEdgeOperations;
    readonly sagaNodeOps: SagaNodeOperations;
    readonly hasEpisodeEdgeOps: HasEpisodeEdgeOperations;
    readonly nextEpisodeEdgeOps: NextEpisodeEdgeOperations;
    readonly graphOps: GraphMaintenanceOperations;
    readonly searchOps: SearchOperations;
    constructor(config: FalkorConnectionConfig, client: FalkorClientAdapter);
    executeQuery<RecordShape = unknown>(cypherQuery: string, options?: QueryOptions): Promise<QueryResult<RecordShape>>;
    session(database?: string): GraphDriverSession;
    transaction(): Promise<AsyncDisposableTransaction>;
    /**
     * Clone the driver with a different database name, reusing the same connection.
     * Port of Python's FalkorDriver.clone().
     */
    clone(database: string): FalkorDriver;
    close(): Promise<void>;
    deleteAllIndexes(): Promise<void>;
    buildIndicesAndConstraints(_deleteExisting?: boolean): Promise<void>;
}
export declare function createFalkorClientAdapter(config: FalkorConnectionConfig): Promise<FalkorClientAdapter>;
