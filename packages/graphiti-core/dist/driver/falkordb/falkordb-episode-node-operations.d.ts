import type { GraphDriver } from '../../contracts';
import type { EpisodeType, EpisodicNode } from '../../domain/nodes';
import type { EpisodeNodeOperations } from '../operations/episode-node-operations';
export declare class FalkorEpisodeNodeOperations implements EpisodeNodeOperations {
    saveBulk(driver: GraphDriver, nodes: EpisodicNode[]): Promise<void>;
    getByUuids(driver: GraphDriver, uuids: string[]): Promise<EpisodicNode[]>;
    save(driver: GraphDriver, node: EpisodicNode): Promise<void>;
    getByUuid(driver: GraphDriver, uuid: string): Promise<EpisodicNode>;
    getByGroupIds(driver: GraphDriver, groupIds: string[], lastN?: number, referenceTime?: Date | null): Promise<EpisodicNode[]>;
    getByEntityNodeUuid(driver: GraphDriver, entityNodeUuid: string): Promise<EpisodicNode[]>;
    retrieveEpisodes(driver: GraphDriver, referenceTime: Date, lastN?: number, groupIds?: string[] | null, source?: EpisodeType | null): Promise<EpisodicNode[]>;
    deleteByUuid(driver: GraphDriver, uuid: string): Promise<void>;
    deleteByUuids(driver: GraphDriver, uuids: string[]): Promise<void>;
    deleteByGroupId(driver: GraphDriver, groupId: string): Promise<void>;
}
