/**
 * Node summarization prompts — port of Python's graphiti_core/prompts/summarize_nodes.py.
 */
import type { Message } from './types';
export declare function summarizePair(context: Record<string, unknown>): Message[];
/**
 * Generate a summary and attributes for an entity from conversation context.
 * This is the missing summarize_context prompt from Python.
 */
export declare function summarizeContext(context: Record<string, unknown>): Message[];
export declare function summaryDescription(context: Record<string, unknown>): Message[];
