/**
 * Token usage tracking — port of Python's graphiti_core/llm_client/token_tracker.py.
 */
export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
}
export declare function totalTokens(usage: TokenUsage): number;
export interface PromptTokenUsage {
    call_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
}
export declare function promptTotalTokens(usage: PromptTokenUsage): number;
export declare function avgInputTokens(usage: PromptTokenUsage): number;
export declare function avgOutputTokens(usage: PromptTokenUsage): number;
export declare class TokenUsageTracker {
    private usage;
    /**
     * Record token usage for a prompt type.
     */
    record(promptType: string, tokenUsage: TokenUsage): void;
    /**
     * Get a copy of the current usage by prompt type.
     */
    getUsage(): Map<string, PromptTokenUsage>;
    /**
     * Get aggregate usage across all prompt types.
     */
    getTotalUsage(): PromptTokenUsage;
    /**
     * Clear all tracked usage.
     */
    reset(): void;
    /**
     * Print a formatted summary of token usage to console.
     */
    printSummary(sortBy?: 'calls' | 'tokens'): void;
}
