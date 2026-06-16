import { type GraphProvider } from '@graphiti/shared';
export declare const ComparisonOperators: {
    readonly equals: "=";
    readonly not_equals: "<>";
    readonly greater_than: ">";
    readonly less_than: "<";
    readonly greater_than_equal: ">=";
    readonly less_than_equal: "<=";
    readonly is_null: "IS NULL";
    readonly is_not_null: "IS NOT NULL";
};
export type ComparisonOperator = (typeof ComparisonOperators)[keyof typeof ComparisonOperators];
export interface DateFilter {
    date?: Date | null;
    comparison_operator: ComparisonOperator;
}
export interface PropertyFilter {
    property_name: string;
    property_value?: string | number | null;
    comparison_operator: ComparisonOperator;
}
export interface ConditionStateFilter {
    entity_uuid: string;
    state: 'active' | 'inactive';
}
export interface SearchFilters {
    node_labels?: string[] | null;
    edge_types?: string[] | null;
    valid_at?: DateFilter[][] | null;
    invalid_at?: DateFilter[][] | null;
    created_at?: DateFilter[][] | null;
    expired_at?: DateFilter[][] | null;
    edge_uuids?: string[] | null;
    property_filters?: PropertyFilter[] | null;
    condition_state?: ConditionStateFilter[] | null;
    anchor_lens?: {
        anchor_type?: import('../domain/anchoring').AnchorType;
        anchor_uuid?: string;
    } | null;
}
export declare function createSearchFilters(overrides?: Partial<SearchFilters>): SearchFilters;
export declare function cypherToOpensearchOperator(op: ComparisonOperator): string;
export declare function dateFilterQueryConstructor(valueName: string, paramName: string, operator: ComparisonOperator): string;
export declare function nodeSearchFilterQueryConstructor(filters: SearchFilters, provider: GraphProvider): [string[], Record<string, unknown>];
export declare function edgeSearchFilterQueryConstructor(filters: SearchFilters, provider: GraphProvider): [string[], Record<string, unknown>];
