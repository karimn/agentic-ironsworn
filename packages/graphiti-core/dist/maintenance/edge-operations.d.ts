/**
 * Edge extraction and resolution — port of Python's utils/maintenance/edge_operations.py.
 *
 * Core functions:
 * - extractEdges(): Extract entity edges from an episode via LLM
 * - resolveExtractedEdges(): Resolve extracted edges against existing graph
 * - resolveExtractedEdge(): Resolve a single edge (dedup + contradiction detection)
 * - buildEpisodicEdges(): Build MENTIONS edges between episode and entity nodes
 * - resolveEdgePointers(): Update edge source/target UUIDs based on node dedup map
 */
import type { GraphitiClients, LLMClient } from '../contracts';
import { type GenerateResponseContext } from '../llm/generate-response';
import type { EntityEdge, EpisodicEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
export declare function buildEpisodicEdges(entityNodes: EntityNode[], episodeUuid: string, createdAt: Date): EpisodicEdge[];
export declare function resolveEdgePointers(edges: EntityEdge[], uuidMap: Record<string, string>): EntityEdge[];
export interface EdgeTypeDefinition {
    description?: string;
    fields?: Record<string, unknown>;
}
export declare function extractEdges(clients: GraphitiClients, episode: EpisodicNode, nodes: EntityNode[], previousEpisodes: EpisodicNode[], edgeTypeMap: Record<string, string[]>, groupId: string, edgeTypes?: Record<string, EdgeTypeDefinition> | null, customExtractionInstructions?: string | null): Promise<EntityEdge[]>;
export declare function resolveExtractedEdges(clients: GraphitiClients, extractedEdges: EntityEdge[], episode: EpisodicNode, entities: EntityNode[], edgeTypes: Record<string, EdgeTypeDefinition>, edgeTypeMap: Record<string, string[]>): Promise<[EntityEdge[], EntityEdge[], EntityEdge[]]>;
export declare function resolveExtractedEdge(llmClient: LLMClient, extractedEdge: EntityEdge, relatedEdges: EntityEdge[], existingEdges: EntityEdge[], episode: EpisodicNode, edgeTypeCandidates?: Record<string, EdgeTypeDefinition> | null, llmContext?: GenerateResponseContext): Promise<[EntityEdge, EntityEdge[]]>;
export declare function resolveEdgeContradictions(resolvedEdge: EntityEdge, invalidationCandidates: EntityEdge[]): EntityEdge[];
