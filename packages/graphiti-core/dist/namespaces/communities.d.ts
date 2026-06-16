import type { EmbedderClient, GraphDriver } from '../contracts';
import type { CommunityNode } from '../domain/nodes';
import type { CommunityEdge } from '../domain/edges';
import { type RecordLike } from '../utils/records';
import type { CommunityNodeOperations } from '../driver/operations/community-node-operations';
import type { CommunityEdgeOperations } from '../driver/operations/community-edge-operations';
export declare class CommunityNodeNamespace {
    private readonly driver;
    private readonly embedder?;
    private readonly ops?;
    constructor(driver: GraphDriver, embedder?: (EmbedderClient | null) | undefined, ops?: CommunityNodeOperations | undefined);
    save(node: CommunityNode): Promise<CommunityNode>;
    saveBulk(nodes: CommunityNode[]): Promise<CommunityNode[]>;
    getByUuid(uuid: string): Promise<CommunityNode>;
    getByUuids(uuids: string[]): Promise<CommunityNode[]>;
    getByGroupIds(groupIds: string[]): Promise<CommunityNode[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
    deleteByGroupId(groupId: string): Promise<void>;
}
export declare class CommunityEdgeNamespace {
    private readonly driver;
    private readonly ops?;
    constructor(driver: GraphDriver, ops?: CommunityEdgeOperations | undefined);
    save(edge: CommunityEdge): Promise<CommunityEdge>;
    saveBulk(edges: CommunityEdge[]): Promise<CommunityEdge[]>;
    getByUuid(uuid: string): Promise<CommunityEdge>;
    getByUuids(uuids: string[]): Promise<CommunityEdge[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
}
export declare function mapCommunityNode(record: RecordLike): CommunityNode;
export declare function mapCommunityEdge(record: RecordLike): CommunityEdge;
export interface CommunityNamespaceApi {
    node: CommunityNodeNamespace;
    edge: CommunityEdgeNamespace;
}
export declare function createCommunityNamespace(driver: GraphDriver, embedder?: EmbedderClient | null): CommunityNamespaceApi;
