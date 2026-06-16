/**
 * Search utility functions — port of Python's graphiti_core/search/search_utils.py (partial).
 */
import type { GraphDriver } from '../contracts';
import type { EntityEdge } from '../domain/edges';
import type { EntityNode, EpisodicNode } from '../domain/nodes';
/**
 * Get entity nodes mentioned in the given episodes via MENTIONS edges.
 * Port of Python's get_mentioned_nodes().
 */
export declare function getMentionedNodes(driver: GraphDriver, episodes: EpisodicNode[]): Promise<EntityNode[]>;
/**
 * Get entity edges relevant to a query by searching edges connected to the given nodes.
 * Port of Python's get_relevant_edges().
 */
export declare function getRelevantEdges(driver: GraphDriver, nodeUuids: string[], limit?: number): Promise<EntityEdge[]>;
/**
 * Get entity nodes relevant to a query by finding nodes connected via edges to seed nodes.
 * Port of Python's get_relevant_nodes().
 */
export declare function getRelevantNodes(driver: GraphDriver, nodeUuids: string[], limit?: number): Promise<EntityNode[]>;
/**
 * Find existing edges that may conflict/contradict a new edge.
 * Port of Python's get_edge_invalidation_candidates().
 */
export declare function getEdgeInvalidationCandidates(driver: GraphDriver, sourceNodeUuid: string, targetNodeUuid: string, excludeUuids?: string[]): Promise<EntityEdge[]>;
