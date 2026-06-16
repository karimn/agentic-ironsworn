import type { EmbedderClient, GraphDriver } from '../../contracts';
import type { EntityNode } from '../../domain/nodes';
import type { EntityNodeOperations } from '../operations/entity-node-operations';
export declare class Neo4jEntityNodeOperations implements EntityNodeOperations {
    saveBulk(driver: GraphDriver, nodes: EntityNode[]): Promise<void>;
    getByUuids(driver: GraphDriver, uuids: string[]): Promise<EntityNode[]>;
    getByGroupIds(driver: GraphDriver, groupIds: string[]): Promise<EntityNode[]>;
    save(driver: GraphDriver, node: EntityNode): Promise<void>;
    getByUuid(driver: GraphDriver, uuid: string): Promise<EntityNode>;
    deleteByUuids(driver: GraphDriver, uuids: string[]): Promise<void>;
    deleteByGroupId(driver: GraphDriver, groupId: string): Promise<void>;
    loadEmbeddings(driver: GraphDriver, node: EntityNode, embedder: EmbedderClient): Promise<EntityNode>;
    loadEmbeddingsBulk(driver: GraphDriver, nodes: EntityNode[], embedder: EmbedderClient): Promise<EntityNode[]>;
}
