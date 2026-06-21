// Pure, name-based scoring core for the extraction eval harness.
// No DB, no Ollama, no LLM — the embedder is injected so tests can stub it.

export interface GoldenEntity {
  canonical: string;
  type: string;
  aliases?: string[];
}
export interface GoldenRelation {
  from: string;
  to: string;
  label: string;
  invalidated?: boolean;
}
export interface GoldenSet {
  entities: GoldenEntity[];
  relations: GoldenRelation[];
}

export interface ActualEntity {
  canonical: string;
  type: string;
  aliases: string[];
}
export interface ActualRelation {
  from: string;
  to: string;
  label: string;
  invalidated: boolean;
}
export interface ActualState {
  entities: ActualEntity[];
  relations: ActualRelation[];
}

export type Embedder = (text: string) => Promise<number[]>;

export interface EntityMatching {
  pairs: { actual: ActualEntity; golden: GoldenEntity }[];
  nearDuplicates: ActualEntity[];
  falsePositives: ActualEntity[];
  unmatchedGolden: GoldenEntity[];
}

export const DEFAULT_SIM_THRESHOLD = 0.85;

// Minimal, explicit relation-label synonym map. This is PART OF THE SPEC,
// not a convenience knob: collapsing two labels here makes the score go up
// without the extractor improving, so every entry needs a one-line
// justification and changes get the same review scrutiny as prompt changes.
// Prefer fixing the extractor's label vocabulary over widening this map.
const LABEL_SYNONYMS: Record<string, string> = {
  SERVES: "MEMBER_OF", // extractor emits both for faction membership
  MEMBER_OF: "MEMBER_OF",
  ALLY_OF: "ALLIED_WITH", // directional vs. symmetric phrasing of the same bond
  ALLIED_WITH: "ALLIED_WITH",
};

export function canonLabel(label: string): string {
  const u = label.trim().toUpperCase().replace(/\s+/g, "_");
  return LABEL_SYNONYMS[u] ?? u;
}

function norm(s: string): string {
  return s.toLowerCase().trim();
}

export function nameSet(names: string[]): Set<string> {
  return new Set(names.map(norm).filter((s) => s.length > 0));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function entityNames(e: ActualEntity | GoldenEntity): string[] {
  return [e.canonical, ...(e.aliases ?? [])];
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

export async function matchEntities(
  actual: ActualEntity[],
  golden: GoldenEntity[],
  embedder: Embedder,
  threshold: number = DEFAULT_SIM_THRESHOLD,
): Promise<EntityMatching> {
  const goldenSets = golden.map((g) => nameSet(entityNames(g)));
  const claimed = new Set<number>(); // golden indices already bound

  // Embedding cache keyed by lowercased canonical.
  const embedCache = new Map<string, number[]>();
  const embed = async (name: string): Promise<number[]> => {
    const k = norm(name);
    let v = embedCache.get(k);
    if (v === undefined) {
      v = await embedder(name);
      embedCache.set(k, v);
    }
    return v;
  };

  const pairs: EntityMatching["pairs"] = [];
  const nearDuplicates: ActualEntity[] = [];
  const falsePositives: ActualEntity[] = [];

  for (const a of actual) {
    const aSet = nameSet(entityNames(a));

    // Pass 1: normalized name/alias intersection.
    let best = -1;
    for (let i = 0; i < golden.length; i++) {
      if (intersects(aSet, goldenSets[i]!)) {
        best = i;
        break;
      }
    }

    // Pass 2: embedding fallback on the canonical name.
    if (best === -1) {
      const aEmb = await embed(a.canonical);
      let bestSim = threshold;
      let bestIdx = -1;
      for (let i = 0; i < golden.length; i++) {
        const gEmb = await embed(golden[i]!.canonical);
        const sim = cosine(aEmb, gEmb);
        if (bestIdx === -1 ? sim >= bestSim : sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }
      best = bestIdx;
    }

    if (best === -1) {
      falsePositives.push(a);
    } else if (claimed.has(best)) {
      nearDuplicates.push(a);
    } else {
      claimed.add(best);
      pairs.push({ actual: a, golden: golden[best]! });
    }
  }

  const unmatchedGolden = golden.filter((_g, i) => !claimed.has(i));
  return { pairs, nearDuplicates, falsePositives, unmatchedGolden };
}

export interface Scorecard {
  entity: { precision: number; recall: number; f1: number; typeAccuracy: number };
  relation: { precision: number; recall: number; f1: number };
  dedup: { score: number };
  temporal: { correct: number; total: number };
}

function f1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export async function scoreExtraction(
  actual: ActualState,
  golden: GoldenSet,
  embedder: Embedder,
  threshold: number = DEFAULT_SIM_THRESHOLD,
): Promise<Scorecard> {
  const m = await matchEntities(actual.entities, golden.entities, embedder, threshold);

  // --- Entity metrics ---
  const matched = m.pairs.length;
  const entityPrecision = actual.entities.length === 0 ? 0 : matched / actual.entities.length;
  const entityRecall = golden.entities.length === 0 ? 0 : matched / golden.entities.length;
  const typeMatches = m.pairs.filter((p) => norm(p.actual.type) === norm(p.golden.type)).length;
  const typeAccuracy = matched === 0 ? 0 : typeMatches / matched;
  // Clamp the floor: multiple near-dups per matched golden can drive the
  // raw ratio above 1, which would make the score negative (nonsense).
  const dedupScore = Math.max(0, 1 - m.nearDuplicates.length / Math.max(1, matched));

  // --- Relation metrics ---
  // Map each matched actual entity's names → its golden canonical, so actual
  // relations can be expressed in golden terms before comparison.
  const actualNameToGoldenCanonical = new Map<string, string>();
  for (const p of m.pairs) {
    for (const name of entityNames(p.actual)) {
      actualNameToGoldenCanonical.set(norm(name), p.golden.canonical);
    }
  }

  const relKey = (from: string, to: string, label: string): string =>
    `${norm(from)} ${norm(to)} ${canonLabel(label)}`;

  const goldenRelKeys = new Set(
    golden.relations.map((r) => relKey(r.from, r.to, r.label)),
  );

  const matchedGoldenRel = new Set<string>();
  let relTruePositives = 0;
  for (const r of actual.relations) {
    const gf = actualNameToGoldenCanonical.get(norm(r.from));
    const gt = actualNameToGoldenCanonical.get(norm(r.to));
    if (gf === undefined || gt === undefined) continue; // endpoint not matched
    const key = relKey(gf, gt, r.label);
    if (goldenRelKeys.has(key) && !matchedGoldenRel.has(key)) {
      matchedGoldenRel.add(key);
      relTruePositives++;
    }
  }
  const relPrecision = actual.relations.length === 0 ? 0 : relTruePositives / actual.relations.length;
  const relRecall = golden.relations.length === 0 ? 0 : relTruePositives / golden.relations.length;

  // --- Temporal correctness ---
  const invalidatedGolden = golden.relations.filter((r) => r.invalidated === true);
  let temporalCorrect = 0;
  for (const gr of invalidatedGolden) {
    const want = relKey(gr.from, gr.to, gr.label);
    const ok = actual.relations.some((r) => {
      const gf = actualNameToGoldenCanonical.get(norm(r.from));
      const gt = actualNameToGoldenCanonical.get(norm(r.to));
      if (gf === undefined || gt === undefined) return false;
      return relKey(gf, gt, r.label) === want && r.invalidated === true;
    });
    if (ok) temporalCorrect++;
  }

  return {
    entity: {
      precision: entityPrecision,
      recall: entityRecall,
      f1: f1(entityPrecision, entityRecall),
      typeAccuracy,
    },
    relation: {
      precision: relPrecision,
      recall: relRecall,
      f1: f1(relPrecision, relRecall),
    },
    dedup: { score: dedupScore },
    temporal: { correct: temporalCorrect, total: invalidatedGolden.length },
  };
}
