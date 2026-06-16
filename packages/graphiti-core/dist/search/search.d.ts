import type { CrossEncoderClient, GraphDriver } from '../contracts';
import { type SearchConfig, type SearchResults } from './config';
import { type SearchFilters } from './filters';
export interface SearchExecutionOptions {
    bfs_origin_node_uuids?: string[] | null;
    center_node_uuid?: string | null;
    query_embedding?: number[] | null;
}
export declare function search(driver: GraphDriver, query: string, groupIds: string[] | null | undefined, config: SearchConfig, searchFilter?: SearchFilters, options?: SearchExecutionOptions, crossEncoder?: CrossEncoderClient | null): Promise<SearchResults>;
