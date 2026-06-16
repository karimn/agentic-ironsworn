/**
 * Node deduplication prompts — port of Python's graphiti_core/prompts/dedupe_nodes.py.
 */
import type { Message } from './types';
export declare function dedupeNode(context: Record<string, unknown>): Message[];
export declare function dedupeNodes(context: Record<string, unknown>): Message[];
export declare function dedupeNodeList(context: Record<string, unknown>): Message[];
