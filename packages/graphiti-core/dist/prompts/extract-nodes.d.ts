/**
 * Node extraction prompts — port of Python's graphiti_core/prompts/extract_nodes.py.
 */
import type { Message } from './types';
export declare function extractMessage(context: Record<string, unknown>): Message[];
export declare function extractJson(context: Record<string, unknown>): Message[];
export declare function extractText(context: Record<string, unknown>): Message[];
export declare function classifyNodes(context: Record<string, unknown>): Message[];
export declare function extractAttributes(context: Record<string, unknown>): Message[];
export declare function extractSummary(context: Record<string, unknown>): Message[];
export declare function extractSummariesBatch(context: Record<string, unknown>): Message[];
