import type { EntityNode } from '../domain/nodes';
export declare const NAME_ENTROPY_THRESHOLD = 1.5;
export declare const MIN_NAME_LENGTH = 6;
export declare const MIN_TOKEN_COUNT = 2;
export declare const FUZZY_JACCARD_THRESHOLD = 0.9;
export declare const MINHASH_PERMUTATIONS = 32;
export declare const MINHASH_BAND_SIZE = 4;
export declare function normalizeStringExact(name: string): string;
export declare function normalizeNameForFuzzy(name: string): string;
export declare function nameEntropy(normalizedName: string): number;
export declare function hasHighEntropy(normalizedName: string): boolean;
export declare function hasCjk(text: string): boolean;
export declare function shingles(normalizedName: string): Set<string>;
export declare function hashShingle(shingle: string, seed: number): number;
export declare function minhashSignature(shingleSet: Set<string>): number[];
export declare function lshBands(signature: number[]): number[][];
export declare function jaccardSimilarity(a: Set<string>, b: Set<string>): number;
export interface DedupCandidateIndexes {
    existingNodes: EntityNode[];
    nodesByUuid: Map<string, EntityNode>;
    normalizedExisting: Map<string, EntityNode[]>;
    shinglesByCandidate: Map<string, Set<string>>;
    lshBuckets: Map<string, string[]>;
}
export declare function buildCandidateIndexes(existingNodes: EntityNode[]): DedupCandidateIndexes;
export interface DedupResolutionState {
    resolvedNodes: (EntityNode | null)[];
    uuidMap: Map<string, string>;
    unresolvedIndices: number[];
    duplicatePairs: [EntityNode, EntityNode][];
}
export declare function resolveWithSimilarity(extractedNodes: EntityNode[], indexes: DedupCandidateIndexes, state: DedupResolutionState): void;
