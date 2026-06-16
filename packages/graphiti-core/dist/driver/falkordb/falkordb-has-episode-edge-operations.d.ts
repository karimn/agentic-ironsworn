import type { GraphDriver } from '../../contracts';
import type { HasEpisodeEdge } from '../../domain/edges';
import type { HasEpisodeEdgeOperations } from '../operations/has-episode-edge-operations';
export declare class FalkorHasEpisodeEdgeOperations implements HasEpisodeEdgeOperations {
    save(driver: GraphDriver, edge: HasEpisodeEdge): Promise<void>;
    saveBulk(driver: GraphDriver, edges: HasEpisodeEdge[]): Promise<void>;
    getByUuid(driver: GraphDriver, uuid: string): Promise<HasEpisodeEdge>;
    getByUuids(driver: GraphDriver, uuids: string[]): Promise<HasEpisodeEdge[]>;
    getByGroupIds(driver: GraphDriver, groupIds: string[]): Promise<HasEpisodeEdge[]>;
    deleteByUuid(driver: GraphDriver, uuid: string): Promise<void>;
    deleteByUuids(driver: GraphDriver, uuids: string[]): Promise<void>;
}
