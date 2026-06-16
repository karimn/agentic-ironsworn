/**
 * Edge deduplication prompts — port of Python's graphiti_core/prompts/dedupe_edges.py.
 */
import type { Message } from './types';
export declare function resolveEdge(context: Record<string, unknown>): Message[];
