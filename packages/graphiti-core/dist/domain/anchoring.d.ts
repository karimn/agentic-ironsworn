import type { EntityEdge } from './edges';
export declare const ANCHOR_TYPES: readonly ["scale", "definition", "baseline", "comparison", "taxonomy", "temporal_frame", "scope", "methodology"];
export type AnchorType = (typeof ANCHOR_TYPES)[number];
export interface AnchoredInterpretation {
    anchor_uuid: string;
    anchor_type: AnchorType;
    derived_meaning?: string | null;
    derived_weight?: number | null;
    computed_at: Date;
}
export interface AnchorGraphContext {
    getEdge(uuid: string): EntityEdge | null;
}
export declare function computeAnchorConfidence(edge: EntityEdge, ctx: AnchorGraphContext, visited?: Set<string>): number;
