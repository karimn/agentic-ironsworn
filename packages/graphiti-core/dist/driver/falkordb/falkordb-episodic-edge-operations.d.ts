import type { GraphDriver } from '../../contracts';
import type { EpisodicEdge } from '../../domain/edges';
import type { EpisodicEdgeOperations } from '../operations/episodic-edge-operations';
export declare class FalkorEpisodicEdgeOperations implements EpisodicEdgeOperations {
    saveBulk(driver: GraphDriver, edges: EpisodicEdge[]): Promise<void>;
    save(driver: GraphDriver, edge: EpisodicEdge): Promise<void>;
    getByUuid(driver: GraphDriver, uuid: string): Promise<EpisodicEdge>;
    getByUuids(driver: GraphDriver, uuids: string[]): Promise<EpisodicEdge[]>;
    deleteByUuids(driver: GraphDriver, uuids: string[]): Promise<void>;
    deleteByGroupId(driver: GraphDriver, groupId: string): Promise<void>;
}
