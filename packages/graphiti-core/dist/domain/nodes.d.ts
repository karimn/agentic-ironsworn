import type { EntityAttributes } from './common';
export declare const EpisodeTypes: {
    readonly message: "message";
    readonly json: "json";
    readonly text: "text";
};
export type EpisodeType = (typeof EpisodeTypes)[keyof typeof EpisodeTypes];
export interface Node {
    uuid: string;
    name: string;
    group_id: string;
    labels: string[];
    created_at: Date;
}
export interface EntityNode extends Node {
    summary: string;
    name_embedding?: number[] | null;
    summary_embedding?: number[] | null;
    attributes?: EntityAttributes;
}
export interface EpisodicNode extends Node {
    source: EpisodeType;
    source_description: string;
    content: string;
    valid_at?: Date | null;
    entity_edges?: string[];
}
export interface CommunityNode extends Node {
    summary: string;
    name_embedding?: number[] | null;
    rank?: number | null;
}
export interface SagaNode extends Node {
    summary: string;
}
export interface CreateNodeInput {
    uuid: string;
    name: string;
    group_id: string;
    labels?: string[];
    created_at?: Date;
}
export declare function createNode(input: CreateNodeInput): Node;
