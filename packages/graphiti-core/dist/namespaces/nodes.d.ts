import type { EmbedderClient, GraphDriver } from '../contracts';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
import { type RecordLike } from '../utils/records';
import type { EntityNodeOperations } from '../driver/operations/entity-node-operations';
import type { EpisodeNodeOperations } from '../driver/operations/episode-node-operations';
export declare class EntityNodeNamespace {
    private readonly driver;
    private readonly embedder?;
    private readonly ops?;
    constructor(driver: GraphDriver, embedder?: (EmbedderClient | null) | undefined, ops?: EntityNodeOperations | undefined);
    save(node: EntityNode): Promise<EntityNode>;
    getByUuid(uuid: string): Promise<EntityNode>;
    saveBulk(nodes: EntityNode[]): Promise<EntityNode[]>;
    getByUuids(uuids: string[]): Promise<EntityNode[]>;
    getByGroupIds(groupIds: string[]): Promise<EntityNode[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
    deleteByGroupId(groupId: string): Promise<void>;
}
export declare class EpisodeNodeNamespace {
    private readonly driver;
    private readonly ops?;
    constructor(driver: GraphDriver, ops?: EpisodeNodeOperations | undefined);
    save(node: EpisodicNode): Promise<EpisodicNode>;
    getByUuid(uuid: string): Promise<EpisodicNode>;
    getByGroupIds(groupIds: string[], lastN?: number, referenceTime?: Date | null): Promise<EpisodicNode[]>;
    deleteByUuid(uuid: string): Promise<void>;
    saveBulk(nodes: EpisodicNode[]): Promise<EpisodicNode[]>;
    getByUuids(uuids: string[]): Promise<EpisodicNode[]>;
    deleteByUuids(uuids: string[]): Promise<void>;
    deleteByGroupId(groupId: string): Promise<void>;
}
export interface NodeNamespaceApi {
    entity: EntityNodeNamespace;
    episode: EpisodeNodeNamespace;
}
export declare function createNodeNamespace(driver: GraphDriver, embedder?: EmbedderClient | null): NodeNamespaceApi;
export declare function mapEntityNode(record: RecordLike): EntityNode;
export declare function mapEpisodeNode(record: RecordLike): EpisodicNode;
