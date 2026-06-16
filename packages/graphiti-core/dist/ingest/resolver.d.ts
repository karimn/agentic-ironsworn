import type { GraphDriver } from '../contracts';
import type { EntityEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
import type { EpisodeExtractionResult } from './extractor';
export interface EpisodeResolutionResult {
    entities: EntityNode[];
    entity_edges: EntityEdge[];
    invalidated_edges: EntityEdge[];
}
export declare function resolveEpisodeExtraction(driver: GraphDriver, episode: EpisodicNode, extraction: EpisodeExtractionResult): Promise<EpisodeResolutionResult>;
