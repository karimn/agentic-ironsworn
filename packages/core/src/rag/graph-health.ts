// Golden-free graph-health indicators, runnable against any world's graph.
// Fragmentation: candidate duplicate nodes detected among the graph's OWN
// entities — same type, and one canonical's token set a strict subset of the
// other ("Lago" ⊂ "Lago Rhian"). Relation coverage: how connected the graph is.
// Indicators, not scores.

const STOPWORDS = new Set(["of", "the", "a", "at", "for"]);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/['']s\b/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

// True when one token set is a strict subset of the other (different sizes).
function subsetMerge(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0 || a.size === b.size) return false;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

export function fragmentationClusters(
  entities: { canonical: string; type: string; aliases: string[] }[],
): { type: string; names: string[] }[] {
  const toks = entities.map((e) => tokens(e.canonical));
  const parent = entities.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[i]!.type !== entities[j]!.type) continue; // same-type only
      if (subsetMerge(toks[i]!, toks[j]!)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < entities.length; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(entities[i]!.canonical);
  }
  return [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => ({ type: entities.find((e) => names.includes(e.canonical))!.type, names }));
}

export function relationCoverage(
  entities: { id: string }[],
  relations: { from_id: string; to_id: string }[],
): { withRelation: number; total: number; ratio: number } {
  const connected = new Set<string>();
  for (const r of relations) {
    connected.add(r.from_id);
    connected.add(r.to_id);
  }
  const withRelation = entities.filter((e) => connected.has(e.id)).length;
  const total = entities.length;
  return { withRelation, total, ratio: total === 0 ? 0 : withRelation / total };
}
