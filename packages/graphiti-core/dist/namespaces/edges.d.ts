import type { EmbedderClient, GraphDriver } from '../contracts';
import type { EntityEdge, EpisodicEdge } from '../domain/edges';
import { type RecordLike } from '../utils/records';
import type { EntityEdgeOperations } from '../driver/operations/entity-edge-operations';
import type { EpisodicEdgeOperations } from '../driver/operations/episodic-edge-operations';
export declare class EntityEdgeNamespace {
    private readonly driver;
    private readonly embedder?;
    private readonly ops?;
    constructor(driver: GraphDriver, embedder?: (EmbedderClient | null) | undefined, ops?: EntityEdgeOperations | undefined);
    save(edge: EntityEdge): Promise<EntityEdge>;
    getByUuid(uuid: string): Promise<EntityEdge>;
    deleteByUuid(uuid: string): Promise<void>;
    saveBulk(edges: EntityEdge[]): Promise<EntityEdge[]>;
    getByUuids(uuids: string[]): Promise<EntityEdge[]>;
    getByGroupIds(groupIds: string[]): Promise<EntityEdge[]>;
    getBetweenNodes(sourceNodeUuid: string, targetNodeUuid: string): Promise<EntityEdge[]>;
    getByNodeUuid(nodeUuid: string): Promise<EntityEdge[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
    deleteByGroupId(groupId: string): Promise<void>;
}
export declare class EpisodicEdgeNamespace {
    private readonly driver;
    private readonly ops?;
    constructor(driver: GraphDriver, ops?: EpisodicEdgeOperations | undefined);
    save(edge: EpisodicEdge): Promise<EpisodicEdge>;
    saveBulk(edges: EpisodicEdge[]): Promise<EpisodicEdge[]>;
    getByUuid(uuid: string): Promise<EpisodicEdge>;
    getByUuids(uuids: string[]): Promise<EpisodicEdge[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
    deleteByGroupId(groupId: string): Promise<void>;
}
export interface EdgeNamespaceApi {
    entity: EntityEdgeNamespace;
    episodic: EpisodicEdgeNamespace;
}
export declare function createEdgeNamespace(driver: GraphDriver, embedder?: EmbedderClient | null): EdgeNamespaceApi;
export declare function mapEntityEdge(record: RecordLike): EntityEdge;
