# Extraction Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a developer-invoked eval that runs a fixed set of real Zura scenes through the full extraction pipeline and scores the resulting DB state (entities + relations) against a hand-curated golden set, diffing a committed baseline scorecard.

**Architecture:** A pure, name-based scoring core (`score.ts`) is unit-tested with synthetic objects and a stub embedder. An orchestrator (`run-eval.ts`) seeds a throwaway world DB, replays fixture scenes through the shipping `extractLoreFromScene` pipeline, flattens `exportLore`'s ID-keyed relations into canonical-name relations, and feeds them to the scorer. A `bootstrap.ts` helper generates the golden draft from the private Zura DB; only committed fixtures drive `run-eval.ts`.

**Tech Stack:** Bun, TypeScript, `@agentic-rpg/core` internals (`rag/extraction.ts`, `rag/scenes.ts`, `rag/lore.ts`, `rag/world-db.ts`), `yaml` (already a dep), Ollama (`getWorldEmbedding`), Anthropic SDK (real LLM, via the shipping default extractor).

## Global Constraints

- **Package:** all new code lives under `packages/core/` (run commands from `packages/core`).
- **Bun test runner:** tests use `bun:test` (`import { describe, it, expect } from "bun:test"`).
- **ESM `.js` import specifiers:** intra-package imports use `.js` extensions on TS source paths (e.g. `import { exportLore } from "../src/rag/lore.js"`), matching the existing codebase.
- **No new runtime dependencies:** `yaml` is already in `packages/core/package.json`; do not add others.
- **Embedding dim:** 768 (`nomic-embed-text`); `getWorldEmbedding(text: string) => Promise<number[]>`.
- **Plugin version bump:** the final PR must bump `plugins/ironsworn/.claude-plugin/plugin.json` (Stop hook enforces). Bump the **minor** version (new feature). Do this once, in the last task.
- **Commit trailer:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r
  ```
  (Trailer omitted from the example commit commands below for brevity — add it to each.)

---

### Task 1: Thread an optional `temperature` through the default extractor

The eval runs the **shipping** extractor (single source of truth for the prompt) but at temperature 0 to cut sampling noise. The current `_makeDefaultExtractor(client)` hardcodes no temperature (SDK default 1.0). Add an optional opts bag and widen the structural `AnthropicLike` type to permit `temperature`.

**Files:**
- Modify: `packages/core/src/rag/communities.ts` (widen `AnthropicLike`, ~line 242–252)
- Modify: `packages/core/src/rag/extraction.ts` (`_makeDefaultExtractor`, ~line 289–335)
- Test: `packages/core/src/rag/extraction.test.ts` (append a test)

**Interfaces:**
- Consumes: existing `AnthropicLike` from `./communities.js`, `Extractor`, `ExtractionResult`.
- Produces: `_makeDefaultExtractor(client: AnthropicLike, opts?: { model?: string; temperature?: number }): Extractor`. When `opts.temperature` is set, it is passed to `client.messages.create`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/rag/extraction.test.ts`:

```ts
describe("_makeDefaultExtractor — options", () => {
  it("passes temperature through to the Anthropic client", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const fakeClient = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return {
            content: [
              { type: "text", text: '{"entities":[],"relations":[]}' },
            ],
          };
        },
      },
    };

    const extractor = _makeDefaultExtractor(fakeClient as never, {
      temperature: 0,
    });
    const result = await extractor("Some scene text.", []);

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs!["temperature"]).toBe(0);
    expect(result).toEqual({ entities: [], relations: [] });
  });

  it("omits temperature when not provided", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const fakeClient = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          capturedArgs = args;
          return {
            content: [
              { type: "text", text: '{"entities":[],"relations":[]}' },
            ],
          };
        },
      },
    };

    const extractor = _makeDefaultExtractor(fakeClient as never);
    await extractor("Some scene text.", []);

    expect(capturedArgs).toBeDefined();
    expect("temperature" in capturedArgs!).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "options"`
Expected: FAIL — `_makeDefaultExtractor` ignores the second arg, so `temperature` is `undefined` in `capturedArgs` (first test fails on `toBe(0)`).

- [ ] **Step 3: Widen `AnthropicLike`**

In `packages/core/src/rag/communities.ts`, add the optional `temperature` field to the `create` args:

```ts
export type AnthropicLike = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      temperature?: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }) => Promise<{ content: { type: string; text?: string }[] }>;
  };
};
```

- [ ] **Step 4: Add the opts bag to `_makeDefaultExtractor`**

In `packages/core/src/rag/extraction.ts`, change the signature and the `create` call:

```ts
export function _makeDefaultExtractor(
  client: AnthropicLike,
  opts?: { model?: string; temperature?: number },
): Extractor {
  return async (sceneText, existingEntities) => {
    // ... existingContext + userPrompt unchanged ...

    const response = await client.messages.create({
      model: opts?.model ?? DEFAULT_EXTRACTION_MODEL,
      max_tokens: 4096,
      ...(opts?.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // ... response parsing unchanged ...
  };
}
```

Leave `defaultExtractor` (the zero-arg internal wrapper) unchanged — it calls `_makeDefaultExtractor(getAnthropic())` with no opts, preserving production behavior.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "options"`
Expected: PASS (both cases).

- [ ] **Step 6: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/communities.ts packages/core/src/rag/extraction.ts packages/core/src/rag/extraction.test.ts
git commit -m "feat(core): optional temperature on _makeDefaultExtractor for eval determinism"
```

---

### Task 2: Scoring core — types, helpers, and entity matching

Create the pure scorer's foundation: shared types, normalization/cosine/label helpers, and `matchEntities` (normalized-name pass → embedding fallback → greedy 1:1, classifying each actual as a pair, near-duplicate, or false positive).

**Files:**
- Create: `packages/core/eval/score.ts`
- Test: `packages/core/eval/score.test.ts`

**Interfaces:**
- Produces (consumed by Task 3 and the orchestrator):
  ```ts
  export interface GoldenEntity { canonical: string; type: string; aliases?: string[]; }
  export interface GoldenRelation { from: string; to: string; label: string; invalidated?: boolean; }
  export interface GoldenSet { entities: GoldenEntity[]; relations: GoldenRelation[]; }
  export interface ActualEntity { canonical: string; type: string; aliases: string[]; }
  export interface ActualRelation { from: string; to: string; label: string; invalidated: boolean; }
  export interface ActualState { entities: ActualEntity[]; relations: ActualRelation[]; }
  export type Embedder = (text: string) => Promise<number[]>;
  export interface EntityMatching {
    pairs: { actual: ActualEntity; golden: GoldenEntity }[];
    nearDuplicates: ActualEntity[];
    falsePositives: ActualEntity[];
    unmatchedGolden: GoldenEntity[];
  }
  export function matchEntities(actual: ActualEntity[], golden: GoldenEntity[], embedder: Embedder, threshold?: number): Promise<EntityMatching>;
  export function nameSet(names: string[]): Set<string>;
  export function cosine(a: number[], b: number[]): number;
  export function canonLabel(label: string): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/core/eval/score.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  matchEntities,
  cosine,
  canonLabel,
  type ActualEntity,
  type GoldenEntity,
  type Embedder,
} from "./score.js";

// Deterministic stub embedder: maps known names to fixed vectors so we can
// drive the embedding-fallback branch without Ollama.
function stubEmbedder(table: Record<string, number[]>): Embedder {
  return async (text: string) => table[text.toLowerCase().trim()] ?? [1, 0, 0];
}

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
});

describe("canonLabel", () => {
  it("uppercases, underscores spaces, and applies the synonym map", () => {
    expect(canonLabel("member of")).toBe("MEMBER_OF");
    expect(canonLabel("serves")).toBe("MEMBER_OF");
    expect(canonLabel("LEADS")).toBe("LEADS");
  });
});

describe("matchEntities", () => {
  const embedder = stubEmbedder({});

  it("matches by canonical name (case-insensitive)", async () => {
    const actual: ActualEntity[] = [{ canonical: "Lona", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(1);
    expect(m.falsePositives.length).toBe(0);
    expect(m.unmatchedGolden.length).toBe(0);
  });

  it("matches via alias overlap", async () => {
    const actual: ActualEntity[] = [{ canonical: "the healer Lona", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature", aliases: ["the healer Lona"] }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(1);
  });

  it("flags an unmatched actual as a false positive", async () => {
    const actual: ActualEntity[] = [{ canonical: "Goblin", type: "creature", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(0);
    expect(m.falsePositives.length).toBe(1);
    expect(m.unmatchedGolden.length).toBe(1);
  });

  it("flags a second actual for the same golden as a near-duplicate", async () => {
    const actual: ActualEntity[] = [
      { canonical: "Lona", type: "creature", aliases: [] },
      { canonical: "Lona", type: "creature", aliases: [] },
    ];
    const golden: GoldenEntity[] = [{ canonical: "Lona", type: "creature" }];
    const m = await matchEntities(actual, golden, embedder);
    expect(m.pairs.length).toBe(1);
    expect(m.nearDuplicates.length).toBe(1);
  });

  it("matches via embedding fallback when names differ but are close", async () => {
    const emb = stubEmbedder({
      "ashfen market quarter": [1, 0, 0],
      "the ashfen market": [0.99, 0.01, 0],
    });
    const actual: ActualEntity[] = [{ canonical: "the Ashfen market", type: "place", aliases: [] }];
    const golden: GoldenEntity[] = [{ canonical: "Ashfen Market Quarter", type: "place" }];
    const m = await matchEntities(actual, golden, emb, 0.85);
    expect(m.pairs.length).toBe(1);
    expect(m.falsePositives.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test eval/score.test.ts`
Expected: FAIL — `./score.js` does not exist / exports undefined.

- [ ] **Step 3: Implement `score.ts` (this task's portion)**

Create `packages/core/eval/score.ts`:

```ts
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

// Minimal, explicit relation-label synonym map. Intentionally tiny; extend
// only when a golden/actual label divergence is genuinely the same relation.
const LABEL_SYNONYMS: Record<string, string> = {
  SERVES: "MEMBER_OF",
  MEMBER_OF: "MEMBER_OF",
  ALLY_OF: "ALLIED_WITH",
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
  return [e.canonical, ...((e.aliases ?? []) as string[])];
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
      for (let i = 0; i < golden.length; i++) {
        const gEmb = await embed(golden[i]!.canonical);
        const sim = cosine(aEmb, gEmb);
        if (sim >= bestSim) {
          bestSim = sim;
          best = i;
        }
      }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test eval/score.test.ts`
Expected: PASS (all cases in this file so far).

- [ ] **Step 5: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/eval/score.ts packages/core/eval/score.test.ts
git commit -m "feat(eval): scoring types + entity matching core"
```

---

### Task 3: Scoring core — `scoreExtraction` (all four metrics)

Add the top-level `scoreExtraction` that turns an `ActualState` + `GoldenSet` into a `Scorecard`: entity P/R/F1 + type accuracy, relation P/R/F1 (synonym-aware, endpoint-resolved), dedup score, temporal correctness.

**Files:**
- Modify: `packages/core/eval/score.ts`
- Test: `packages/core/eval/score.test.ts` (append)

**Interfaces:**
- Consumes: `matchEntities`, `canonLabel`, the types from Task 2.
- Produces:
  ```ts
  export interface Scorecard {
    entity: { precision: number; recall: number; f1: number; typeAccuracy: number };
    relation: { precision: number; recall: number; f1: number };
    dedup: { score: number };
    temporal: { correct: number; total: number };
  }
  export function scoreExtraction(actual: ActualState, golden: GoldenSet, embedder: Embedder, threshold?: number): Promise<Scorecard>;
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/core/eval/score.test.ts`:

```ts
import { scoreExtraction, type ActualState, type GoldenSet } from "./score.js";

describe("scoreExtraction", () => {
  const embedder: Embedder = async () => [1, 0, 0];

  const golden: GoldenSet = {
    entities: [
      { canonical: "Lona", type: "creature", aliases: ["the healer Lona"] },
      { canonical: "Caldren", type: "place" },
      { canonical: "Thornwood", type: "faction" },
    ],
    relations: [
      { from: "Lona", to: "Caldren", label: "LOCATED_IN" },
      { from: "Lona", to: "Thornwood", label: "MEMBER_OF" },
    ],
  };

  it("scores a perfect match as 1.0 across entity and relation F1", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [
        { from: "Lona", to: "Caldren", label: "LOCATED_IN", invalidated: false },
        { from: "Lona", to: "Thornwood", label: "SERVES", invalidated: false }, // synonym
      ],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.f1).toBeCloseTo(1, 6);
    expect(s.entity.typeAccuracy).toBeCloseTo(1, 6);
    expect(s.relation.f1).toBeCloseTo(1, 6); // SERVES≈MEMBER_OF
    expect(s.dedup.score).toBeCloseTo(1, 6);
  });

  it("drops entity recall on a missed golden entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.recall).toBeCloseTo(2 / 3, 6);
    expect(s.entity.precision).toBeCloseTo(1, 6);
  });

  it("drops entity precision on a hallucinated entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
        { canonical: "Dragon", type: "creature", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.precision).toBeCloseTo(3 / 4, 6);
    expect(s.entity.recall).toBeCloseTo(1, 6);
  });

  it("drops type accuracy on a mistyped match", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "place", aliases: [] }, // wrong type
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    expect(s.entity.f1).toBeCloseTo(1, 6);
    expect(s.entity.typeAccuracy).toBeCloseTo(2 / 3, 6);
  });

  it("drops dedup score on a near-duplicate entity", async () => {
    const actual: ActualState = {
      entities: [
        { canonical: "Lona", type: "creature", aliases: [] },
        { canonical: "the healer Lona", type: "creature", aliases: [] }, // dup of Lona via alias
        { canonical: "Caldren", type: "place", aliases: [] },
        { canonical: "Thornwood", type: "faction", aliases: [] },
      ],
      relations: [],
    };
    const s = await scoreExtraction(actual, golden, embedder);
    // 1 near-dup over 3 matched golden → 1 - 1/3
    expect(s.dedup.score).toBeCloseTo(1 - 1 / 3, 6);
  });

  it("reports temporal correctness for invalidated relations", async () => {
    const goldenT: GoldenSet = {
      entities: [
        { canonical: "Veil", type: "creature" },
        { canonical: "Ashfen", type: "place" },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
      ],
    };
    const actualGood: ActualState = {
      entities: [
        { canonical: "Veil", type: "creature", aliases: [] },
        { canonical: "Ashfen", type: "place", aliases: [] },
      ],
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: true },
      ],
    };
    const actualBad: ActualState = {
      entities: actualGood.entities,
      relations: [
        { from: "Veil", to: "Ashfen", label: "HOLDS_TITLE", invalidated: false },
      ],
    };
    expect((await scoreExtraction(actualGood, goldenT, embedder)).temporal).toEqual({ correct: 1, total: 1 });
    expect((await scoreExtraction(actualBad, goldenT, embedder)).temporal).toEqual({ correct: 0, total: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test eval/score.test.ts -t "scoreExtraction"`
Expected: FAIL — `scoreExtraction` is not exported.

- [ ] **Step 3: Implement `scoreExtraction`**

Append to `packages/core/eval/score.ts`:

```ts
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
  const m = await matchEntities(actual.entities, golden, embedder, threshold);

  // --- Entity metrics ---
  const matched = m.pairs.length;
  const entityPrecision = actual.entities.length === 0 ? 0 : matched / actual.entities.length;
  const entityRecall = golden.entities.length === 0 ? 0 : matched / golden.entities.length;
  const typeMatches = m.pairs.filter((p) => norm(p.actual.type) === norm(p.golden.type)).length;
  const typeAccuracy = matched === 0 ? 0 : typeMatches / matched;
  const dedupScore = 1 - m.nearDuplicates.length / Math.max(1, matched);

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
    `${norm(from)} ${norm(to)} ${canonLabel(label)}`;

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test eval/score.test.ts`
Expected: PASS (all cases, both describe blocks).

- [ ] **Step 5: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/eval/score.ts packages/core/eval/score.test.ts
git commit -m "feat(eval): scoreExtraction — entity/relation/dedup/temporal metrics"
```

---

### Task 4: `bootstrap.ts` — generate the golden draft from the Zura DB

A manually-run script that reads a contiguous arc of scenes from the **private** Zura world DB, writes them to `fixtures/scenes.jsonl`, runs them through the pipeline in a throwaway DB, and emits `fixtures/golden.draft.yaml` for hand-curation. This is the only code that touches the private source; `run-eval.ts` never does.

**Files:**
- Create: `packages/core/eval/bootstrap.ts`
- Create: `packages/core/eval/fixtures/` (directory; created by the script)

**Interfaces:**
- Consumes: `exportScenes`, `getScene` (`../src/rag/scenes.js`); `extractLoreFromScene`, `_makeDefaultExtractor` (`../src/rag/extraction.js`); `exportLore` (`../src/rag/lore.js`); `recordScene` (`../src/rag/scenes.js`); `getWorldEmbedding` (`../src/rag/world-db.js`); `Anthropic` (`@anthropic-ai/sdk`); `stringify` (`yaml`).
- Produces (files, not code symbols): `fixtures/scenes.jsonl`, `fixtures/golden.draft.yaml`.

- [ ] **Step 1: Implement `bootstrap.ts`**

Create `packages/core/eval/bootstrap.ts`:

```ts
// Manual-run helper: dump a contiguous arc of Zura scenes + a draft golden set.
//
//   SOURCE_CAMPAIGN=/path/to/zura/campaigns/<id> \
//   ARC_START=10 ARC_COUNT=14 \
//   ANTHROPIC_API_KEY=... \
//   bun run eval/bootstrap.ts
//
// Outputs eval/fixtures/scenes.jsonl and eval/fixtures/golden.draft.yaml.
// Hand-correct the draft into golden.yaml; commit scenes.jsonl + golden.yaml.

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import Anthropic from "@anthropic-ai/sdk";
import { exportScenes, getScene, recordScene } from "../src/rag/scenes.js";
import { extractLoreFromScene, _makeDefaultExtractor } from "../src/rag/extraction.js";
import { exportLore } from "../src/rag/lore.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(here, "fixtures");

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const source = reqEnv("SOURCE_CAMPAIGN");
  const arcStart = Number(process.env["ARC_START"] ?? "0");
  const arcCount = Number(process.env["ARC_COUNT"] ?? "14");
  reqEnv("ANTHROPIC_API_KEY");

  // 1. Pull all source scenes, order by timestamp, slice the arc.
  const all = (await exportScenes(source)).sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp)),
  );
  const arc = all.slice(arcStart, arcStart + arcCount);
  if (arc.length === 0) throw new Error("Arc slice is empty — check ARC_START/ARC_COUNT");

  // 2. Re-read each with beats and write scenes.jsonl (processing order).
  await mkdir(FIXTURES, { recursive: true });
  const lines: string[] = [];
  const replay: { text: string; kind: string; beats: unknown[] }[] = [];
  for (const s of arc) {
    const full = await getScene(source, s.id, { include_beats: true });
    if (full === null) continue;
    const beats = (full.beats ?? []).map((b) => ({
      beat_index: b.beat_index,
      kind: b.kind,
      speaker: b.speaker ?? null,
      text: b.text,
    }));
    const record = { id: s.id, timestamp: full.timestamp, text: full.text, kind: full.kind, beats };
    lines.push(JSON.stringify(record));
    replay.push({ text: full.text, kind: full.kind, beats });
  }
  await writeFile(join(FIXTURES, "scenes.jsonl"), lines.join("\n") + "\n", "utf8");

  // 3. Run the arc through a fresh pipeline (temperature 0) → draft golden.
  const dir = await mkdtemp(join(tmpdir(), "eval-bootstrap-"));
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as never,
    { temperature: 0 },
  );
  for (const r of replay) {
    const id = await recordScene(dir, r.text, r.kind, undefined, r.beats as never);
    await extractLoreFromScene(dir, id, { extractor });
  }

  const { entities, relations } = await exportLore(dir);
  const idToCanon = new Map(entities.map((e) => [e.id, e.canonical]));
  const draft = {
    entities: entities.map((e) => ({ canonical: e.canonical, type: e.type, aliases: e.aliases })),
    relations: relations.map((r) => ({
      from: idToCanon.get(r.from_id) ?? r.from_id,
      to: idToCanon.get(r.to_id) ?? r.to_id,
      label: r.relation,
      invalidated: r.invalid_at !== null,
    })),
  };
  await writeFile(join(FIXTURES, "golden.draft.yaml"), stringify(draft), "utf8");

  console.log(
    `Wrote ${lines.length} scenes to fixtures/scenes.jsonl and a ${entities.length}-entity / ${relations.length}-relation draft to fixtures/golden.draft.yaml`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Smoke-run against the Zura DB**

Run (adjust the campaign path to the real Zura campaign dir — find it with `ls /media/karim/Code-Drive/karimn-code/zura-ironsworn/campaigns`):

```bash
cd packages/core
SOURCE_CAMPAIGN=/media/karim/Code-Drive/karimn-code/zura-ironsworn/campaigns/<id> \
ARC_START=0 ARC_COUNT=14 \
bun run eval/bootstrap.ts
```

Expected: prints the "Wrote N scenes …" line; `eval/fixtures/scenes.jsonl` and `eval/fixtures/golden.draft.yaml` exist. (Requires `ANTHROPIC_API_KEY` + Ollama. If unavailable, defer this step to when they are — it is a generation step, not a unit test.)

- [ ] **Step 4: Commit the script only (not fixtures yet)**

```bash
git add packages/core/eval/bootstrap.ts
git commit -m "feat(eval): bootstrap script to draft golden set from Zura DB"
```

---

### Task 5: `run-eval.ts` — orchestrator + baseline diff + npm script

The reproducible eval: reads committed fixtures, seeds a fresh DB, replays scenes through the shipping pipeline at temperature 0, flattens `exportLore` to an `ActualState`, scores, prints, and diffs `baseline.json`.

**Files:**
- Create: `packages/core/eval/run-eval.ts`
- Modify: `packages/core/package.json` (add script)

**Interfaces:**
- Consumes: `scoreExtraction`, `ActualState`, `GoldenSet`, `Scorecard` (`./score.js`); `recordScene` (`../src/rag/scenes.js`); `extractLoreFromScene`, `_makeDefaultExtractor` (`../src/rag/extraction.js`); `exportLore` (`../src/rag/lore.js`); `getWorldEmbedding` (`../src/rag/world-db.js`); `parse` (`yaml`); `Anthropic`.
- Produces: a printed scorecard + a non-zero exit only on infra error (never on score regression — accepting baselines is manual).

- [ ] **Step 1: Implement `run-eval.ts`**

Create `packages/core/eval/run-eval.ts`:

```ts
// Reproducible extraction eval. Reads committed fixtures, runs the shipping
// pipeline at temperature 0 into a throwaway DB, scores vs golden.yaml, and
// diffs baseline.json.
//
//   ANTHROPIC_API_KEY=... bun run eval:extraction
//
// Accepting a change: copy the printed scorecard into baseline.json and commit.

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import Anthropic from "@anthropic-ai/sdk";
import { recordScene } from "../src/rag/scenes.js";
import { extractLoreFromScene, _makeDefaultExtractor } from "../src/rag/extraction.js";
import { exportLore } from "../src/rag/lore.js";
import { getWorldEmbedding } from "../src/rag/world-db.js";
import { scoreExtraction, type ActualState, type GoldenSet, type Scorecard } from "./score.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(here, "fixtures");
const BASELINE = join(here, "baseline.json");

interface SceneRecord {
  id: string;
  timestamp: string;
  text: string;
  kind: string;
  beats: { beat_index: number; kind: string; speaker: string | null; text: string }[];
}

async function ollamaReachable(): Promise<boolean> {
  try {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: "t" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function printScorecard(s: Scorecard, base: Scorecard | null): void {
  const delta = (cur: number, b: number | undefined): string =>
    b === undefined ? "" : `  (baseline ${fmt(b)}  ${cur - b >= 0 ? "+" : ""}${fmt(cur - b)})`;
  console.log("Extraction eval scorecard");
  console.log(`  entity precision  ${fmt(s.entity.precision)}${delta(s.entity.precision, base?.entity.precision)}`);
  console.log(`  entity recall     ${fmt(s.entity.recall)}${delta(s.entity.recall, base?.entity.recall)}`);
  console.log(`  entity F1         ${fmt(s.entity.f1)}${delta(s.entity.f1, base?.entity.f1)}`);
  console.log(`  type accuracy     ${fmt(s.entity.typeAccuracy)}${delta(s.entity.typeAccuracy, base?.entity.typeAccuracy)}`);
  console.log(`  relation precision${fmt(s.relation.precision)}${delta(s.relation.precision, base?.relation.precision)}`);
  console.log(`  relation recall   ${fmt(s.relation.recall)}${delta(s.relation.recall, base?.relation.recall)}`);
  console.log(`  relation F1       ${fmt(s.relation.f1)}${delta(s.relation.f1, base?.relation.f1)}`);
  console.log(`  dedup             ${fmt(s.dedup.score)}${delta(s.dedup.score, base?.dedup.score)}`);
  console.log(`  temporal          ${s.temporal.correct}/${s.temporal.total}`);
  console.log("");
  console.log("Scorecard JSON (copy into baseline.json to accept):");
  console.log(JSON.stringify(s, null, 2));
}

async function main(): Promise<void> {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error("Eval needs ANTHROPIC_API_KEY (the shipping extractor calls the real LLM).");
    process.exit(2);
  }
  if (!(await ollamaReachable())) {
    console.error("Eval needs Ollama reachable (embeddings). Set OLLAMA_BASE_URL or start Ollama.");
    process.exit(2);
  }
  if (!existsSync(join(FIXTURES, "scenes.jsonl")) || !existsSync(join(FIXTURES, "golden.yaml"))) {
    console.error("Missing fixtures. Run eval/bootstrap.ts and curate golden.yaml first.");
    process.exit(2);
  }

  const scenesRaw = await readFile(join(FIXTURES, "scenes.jsonl"), "utf8");
  const scenes: SceneRecord[] = scenesRaw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as SceneRecord);
  const golden = parse(await readFile(join(FIXTURES, "golden.yaml"), "utf8")) as GoldenSet;

  const dir = await mkdtemp(join(tmpdir(), "eval-run-"));
  const extractor = _makeDefaultExtractor(
    new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) as never,
    { temperature: 0 },
  );
  for (const sc of scenes) {
    const id = await recordScene(dir, sc.text, sc.kind, undefined, sc.beats as never);
    await extractLoreFromScene(dir, id, { extractor });
  }

  const { entities, relations } = await exportLore(dir);
  const idToCanon = new Map(entities.map((e) => [e.id, e.canonical]));
  const actual: ActualState = {
    entities: entities.map((e) => ({ canonical: e.canonical, type: e.type, aliases: e.aliases })),
    relations: relations.map((r) => ({
      from: idToCanon.get(r.from_id) ?? r.from_id,
      to: idToCanon.get(r.to_id) ?? r.to_id,
      label: r.relation,
      invalidated: r.invalid_at !== null,
    })),
  };

  const scorecard = await scoreExtraction(actual, golden, getWorldEmbedding);
  const base: Scorecard | null = existsSync(BASELINE)
    ? (JSON.parse(await readFile(BASELINE, "utf8")) as Scorecard)
    : null;
  printScorecard(scorecard, base);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `packages/core/package.json`, add to `"scripts"`:

```json
    "eval:extraction": "bun run eval/run-eval.ts"
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Verify the preflight guard without keys**

Run: `cd packages/core && ANTHROPIC_API_KEY= bun run eval:extraction; echo "exit=$?"`
Expected: prints "Eval needs ANTHROPIC_API_KEY …" and `exit=2` (no crash, clean guard).

- [ ] **Step 5: Commit**

```bash
git add packages/core/eval/run-eval.ts packages/core/package.json
git commit -m "feat(eval): run-eval orchestrator + eval:extraction script"
```

---

### Task 6: Author fixtures, generate baseline, finalize

Human curation + first baseline + version bump. This task produces the committed fixtures and the baseline scorecard, and bumps the plugin version for the PR.

**Files:**
- Create: `packages/core/eval/fixtures/scenes.jsonl` (from Task 4 bootstrap run)
- Create: `packages/core/eval/fixtures/golden.yaml` (hand-curated from the draft)
- Create: `packages/core/eval/baseline.json` (from a `run-eval` run)
- Create: `packages/core/eval/README.md`
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json` (minor version bump)

- [ ] **Step 1: Generate fixtures**

If not already done in Task 4, run `bootstrap.ts` (see Task 4 Step 3) to produce `fixtures/scenes.jsonl` and `fixtures/golden.draft.yaml`. Pick `ARC_START`/`ARC_COUNT` so the slice is a coherent ~12–15 scene arc. **Inspect the draft for at least one supersedes case** (a relation whose `invalidated: true`, e.g. a title stripped or alliance broken). If the slice contains none, shift the arc window until it does, and record the chosen `ARC_START`/`ARC_COUNT` in `eval/README.md`.

- [ ] **Step 2: Curate `golden.yaml`**

Copy `fixtures/golden.draft.yaml` → `fixtures/golden.yaml` and hand-correct it against the scene text in `scenes.jsonl`:
- fix wrong `type` values;
- merge near-duplicate entities into one (keep the best `canonical`, fold the others into `aliases`);
- delete noise (setting-generic entities, implied facts, PC stat artifacts);
- add entities/relations the extractor missed;
- set `invalidated: true` on every relation a later scene supersedes; remove the key (or set false) elsewhere.

The curated file is the spec of "good extraction." Delete `golden.draft.yaml` (do not commit it).

- [ ] **Step 3: Generate the baseline**

Run: `cd packages/core && bun run eval:extraction`
Copy the printed "Scorecard JSON" block into `packages/core/eval/baseline.json`.

Expected: a JSON object with `entity`/`relation`/`dedup`/`temporal` keys; `temporal.total >= 1`.

- [ ] **Step 4: Write `eval/README.md`**

Create `packages/core/eval/README.md`:

```markdown
# Extraction evaluation harness

Scores the full lore-extraction pipeline on a fixed Zura scene arc.

## Run

    ANTHROPIC_API_KEY=... bun run eval:extraction   # from packages/core

Needs Ollama (embeddings) + an Anthropic key (the shipping extractor). Prints
a scorecard and the delta vs `baseline.json`. Eyeball the diff; on an accepted
improvement, copy the printed scorecard JSON into `baseline.json` and commit.

## Files

- `fixtures/scenes.jsonl` — the fixed scene arc (real Zura prose), processing order.
- `fixtures/golden.yaml` — hand-curated ground truth (the spec of "good").
- `baseline.json` — last-accepted scorecard.
- `score.ts` — pure, unit-tested scoring core (`bun test eval/score.test.ts`).
- `run-eval.ts` — orchestrator (reproducible; reads only committed fixtures).
- `bootstrap.ts` — one-shot draft generator from the private Zura DB.

Arc window used: ARC_START=<n>, ARC_COUNT=<n>. Contains <n> supersedes case(s).

## Metrics

entity P/R/F1 + type accuracy · relation P/R/F1 (synonym-aware) · dedup score
(near-duplicate penalty) · temporal correctness (invalidated relations resolved).
```

Fill in the `<n>` placeholders with the actual arc window and supersedes count.

- [ ] **Step 5: Bump the plugin version**

In `plugins/ironsworn/.claude-plugin/plugin.json`, bump the `version` minor (e.g. `0.30.0` → `0.31.0`). Confirm it is higher than `origin/main`.

- [ ] **Step 6: Full test + typecheck sweep**

Run: `cd packages/core && bun test eval/score.test.ts && bun run tsc --noEmit`
Expected: score tests PASS, typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/eval/fixtures/scenes.jsonl packages/core/eval/fixtures/golden.yaml packages/core/eval/baseline.json packages/core/eval/README.md plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "feat(eval): commit Zura fixtures, golden set, baseline + version bump"
```

---

## Self-Review

**Spec coverage:**
- Full-pipeline scoring of DB state → Task 5 (orchestrator replays scenes through `extractLoreFromScene`, scores `exportLore` output). ✓
- Bootstrap + human-curate golden set → Task 4 (draft) + Task 6 (curation). ✓
- Script + saved baseline run mode → Task 5 (`run-eval` + diff) + Task 6 (baseline). ✓
- Fixtures committed to public repo under `packages/core/eval/` → Task 6. ✓
- All four metrics → Task 3 (`scoreExtraction`). ✓
- Matching: normalized + embedding fallback → Task 2 (`matchEntities`). ✓
- ~12–15 scene arc, ≥1 supersedes → Task 6 Step 1. ✓
- Temperature-0 determinism without duplicating the prompt → Task 1. ✓
- `score.ts` pure + unit-tested → Tasks 2–3 (`score.test.ts`, stub embedder). ✓
- Out-of-scope items (multi-sample, CI gating, alt-extractor compare) → not built. ✓

**Placeholder scan:** the only intentional fill-ins are the `<id>` Zura campaign path and `ARC_START`/`ARC_COUNT`/`<n>` arc-window values in Task 6 — these are genuinely runtime discoveries (depend on inspecting the Zura DB), documented as such, and recorded in `eval/README.md`. No code placeholders.

**Type consistency:** `Scorecard`, `ActualState`, `GoldenSet`, `Embedder`, `matchEntities`, `scoreExtraction`, `canonLabel`, `cosine` are defined in Tasks 2–3 and consumed with matching signatures in Tasks 4–5. `_makeDefaultExtractor(client, { temperature })` defined in Task 1, used identically in Tasks 4–5. `exportLore` relation fields (`from_id`, `to_id`, `relation`, `invalid_at`) match the actual `LoreRelationExport` shape. `recordScene(path, summary, kind?, complicationTheme?, beats?, …)` argument order matches the real signature.
