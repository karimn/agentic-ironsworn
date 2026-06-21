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

const DEFAULT_SIM_THRESHOLD = 0.85;

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
        if (sim >= bestSim) {
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
