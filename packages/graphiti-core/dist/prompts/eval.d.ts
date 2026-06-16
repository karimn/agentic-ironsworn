/**
 * Evaluation prompts — port of Python's graphiti_core/prompts/eval.py.
 */
import type { Message } from './types';
export interface QueryExpansion {
    query: string;
}
export interface QAResponse {
    ANSWER: string;
}
export interface EvalResponse {
    is_correct: boolean;
    reasoning: string;
}
export interface EvalAddEpisodeResults {
    candidate_is_worse: boolean;
    reasoning: string;
}
export declare function queryExpansion(context: Record<string, unknown>): Message[];
export declare function qaPrompt(context: Record<string, unknown>): Message[];
export declare function evalPrompt(context: Record<string, unknown>): Message[];
export declare function evalAddEpisodeResults(context: Record<string, unknown>): Message[];
