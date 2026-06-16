export declare function reciprocalRankFusion(results: string[][], rankConstant?: number, minScore?: number): {
    uuids: string[];
    scores: number[];
};
export declare function cosineSimilarity(left: number[], right: number[]): number;
export declare function rankByCosineSimilarity<ResultShape>(candidates: ResultShape[], queryEmbedding: number[], candidateEmbeddingGetter: (candidate: ResultShape) => number[] | null | undefined, candidateUuidGetter: (candidate: ResultShape) => string, minScore?: number, limit?: number): ResultShape[];
export declare function maximalMarginalRelevance<ResultShape>(candidates: ResultShape[], queryEmbedding: number[], candidateEmbeddingGetter: (candidate: ResultShape) => number[] | null | undefined, candidateUuidGetter: (candidate: ResultShape) => string, lambda?: number, minScore?: number, limit?: number): {
    items: ResultShape[];
    scores: number[];
};
