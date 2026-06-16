/**
 * Directed union-find with iterative path compression.
 *
 * Given a list of (source, target) UUID pairs representing alias→canonical
 * mappings, collapses transitive chains so every UUID resolves to its ultimate
 * canonical target.
 *
 * Example: [(a,b), (b,c)] → {a:c, b:c, c:c}
 */
export declare function buildDirectedUuidMap(pairs: [string, string][]): Map<string, string>;
