/**
 * Node extraction and resolution — port of Python's utils/maintenance/node_operations.py.
 *
 * Core functions:
 * - extractNodes(): Extract entity nodes from an episode via LLM
 * - resolveExtractedNodes(): Resolve extracted nodes against existing graph (similarity + LLM dedup)
 * - extractAttributesFromNodes(): Extract attributes and summaries for resolved nodes
 */
import type { GraphitiClients } from '../contracts';
import type { EntityEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
export interface EntityTypeDefinition {
    description?: string;
    fields?: Record<string, unknown>;
}
export declare function buildEntityTypesContext(entityTypes?: Record<string, EntityTypeDefinition> | null): Array<{
    entity_type_id: number;
    entity_type_name: string;
    entity_type_description: string;
}>;
export declare function extractNodes(clients: GraphitiClients, episode: EpisodicNode, previousEpisodes: EpisodicNode[], entityTypes?: Record<string, EntityTypeDefinition> | null, excludedEntityTypes?: string[] | null, customExtractionInstructions?: string | null): Promise<EntityNode[]>;
export declare function resolveExtractedNodes(clients: GraphitiClients, extractedNodes: EntityNode[], episode?: EpisodicNode | null, previousEpisodes?: EpisodicNode[] | null, entityTypes?: Record<string, EntityTypeDefinition> | null, existingNodesOverride?: EntityNode[] | null): Promise<[EntityNode[], Record<string, string>, Array<[EntityNode, EntityNode]>]>;
export declare function extractAttributesFromNodes(clients: GraphitiClients, nodes: EntityNode[], episode?: EpisodicNode | null, previousEpisodes?: EpisodicNode[] | null, entityTypes?: Record<string, EntityTypeDefinition> | null, edges?: EntityEdge[] | null): Promise<EntityNode[]>;
