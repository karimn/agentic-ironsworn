/**
 * Shared generateResponse() implementation -- wraps generateText() with structured output,
 * language instructions, input cleaning, token tracking, and response caching.
 *
 * Port of Python's LLMClient.generate_response() base class method.
 */
import type { GenerateResponseOptions, LLMClient } from '../contracts';
import type { Message } from '../prompts/types';
import type { TokenUsageTracker } from './token-tracker';
import type { LLMCache } from './cache';
/**
 * Clean input string of invalid unicode and control characters.
 * Port of Python's LLMClient._clean_input().
 */
export declare function cleanInput(text: string): string;
/**
 * Extended options for generateResponse that includes token tracking and caching.
 */
export interface GenerateResponseContext {
    /** Token usage tracker instance for recording per-prompt usage. */
    tokenTracker?: TokenUsageTracker | null;
    /** LLM response cache for avoiding duplicate calls. */
    cache?: LLMCache | null;
}
/**
 * Default implementation of generateResponse() that wraps generateText().
 * This is called by all LLM client implementations.
 *
 * Now supports optional token tracking (via prompt_name) and response caching.
 */
export declare function generateResponse(client: LLMClient, messages: Message[], options?: GenerateResponseOptions, context?: GenerateResponseContext): Promise<Record<string, unknown>>;
