/**
 * Edge extraction prompts — port of Python's graphiti_core/prompts/extract_edges.py.
 */
import type { Message } from './types';
export declare function extractEdges(context: Record<string, unknown>): Message[];
export declare function extractEdgeAttributes(context: Record<string, unknown>): Message[];
