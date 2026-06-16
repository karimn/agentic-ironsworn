import type { EntityEdge } from '../domain/edges';
import type { SearchResults } from './config';
/**
 * Format an edge's valid_at/invalid_at as a human-readable date range.
 * Port of Python's format_edge_date_range().
 */
export declare function formatEdgeDateRange(edge: EntityEdge): string;
/**
 * Convert SearchResults into a context string suitable for LLM prompts.
 * Port of Python's search_results_to_context_string().
 */
export declare function searchResultsToContextString(searchResults: SearchResults): string;
