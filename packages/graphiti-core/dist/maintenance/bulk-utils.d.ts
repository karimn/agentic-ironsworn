/**
 * Bulk utilities — port of Python's utils/bulk_utils.py.
 *
 * Core functions:
 * - addNodesAndEdgesBulk(): Persist episodes, nodes, and edges in bulk
 * - dedupeNodesBulk(): Cross-episode node deduplication
 * - dedupeEdgesBulk(): Cross-episode edge deduplication
 * - extractNodesAndEdgesBulk(): Parallel extraction across episodes
 */
import type { GraphitiClients, EmbedderClient, GraphDriver } from '../contracts';
import type { EntityEdge, EpisodicEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
import { type EntityTypeDefinition } from './node-operations';
import { type EdgeTypeDefinition } from './edge-operations';
export interface RawEpisode {
    name: string;
    uuid?: string | null;
    content: string;
    source_description: string;
    source: import('../domain/nodes').EpisodeType;
    reference_time: Date;
}
export declare function addNodesAndEdgesBulk(driver: GraphDriver, episodicNodes: EpisodicNode[], episodicEdges: EpisodicEdge[], entityNodes: EntityNode[], entityEdges: EntityEdge[], embedder: EmbedderClient): Promise<void>;
export declare function extractNodesAndEdgesBulk(clients: GraphitiClients, episodeTuples: Array<[EpisodicNode, EpisodicNode[]]>, edgeTypeMap: Record<string, string[]>, entityTypes?: Record<string, EntityTypeDefinition> | null, excludedEntityTypes?: string[] | null, edgeTypes?: Record<string, EdgeTypeDefinition> | null, customExtractionInstructions?: string | null): Promise<[EntityNode[][], EntityEdge[][]]>;
export declare function dedupeNodesBulk(clients: GraphitiClients, extractedNodes: EntityNode[][], episodeTuples: Array<[EpisodicNode, EpisodicNode[]]>, entityTypes?: Record<string, EntityTypeDefinition> | null): Promise<[Record<string, EntityNode[]>, Record<string, string>]>;
export declare function dedupeEdgesBulk(clients: GraphitiClients, extractedEdges: EntityEdge[][], episodeTuples: Array<[EpisodicNode, EpisodicNode[]]>, edgeTypes: Record<string, EdgeTypeDefinition>): Promise<Record<string, EntityEdge[]>>;
