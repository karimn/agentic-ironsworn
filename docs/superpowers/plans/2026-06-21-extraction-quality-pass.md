# Extraction-Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extraction pipeline record temporal supersession (eval temporal 0/2 → 2/2) and tighten dedup/precision, measured against the committed Zura golden set.

**Architecture:** Approach B (deterministic-anchor). Three code changes in the existing single-pass pipeline — endpoint-primary directed invalidation (temporal), a dedup-threshold alignment (0.92→0.85), and an entity confidence-drop plus a prompt-sharpening (precision) — followed by a re-baseline of `packages/core/eval/baseline.json`. No second LLM pass, no harness changes, no golden/scorer changes.

**Tech Stack:** Bun + TypeScript, `@agentic-rpg/core`, DuckDB (`world.duckdb`), Ollama (`nomic-embed-text`) embeddings, Anthropic (extraction LLM). Tests: `bun test`.

## Global Constraints

- Work happens in `packages/core/`. Run all commands from `packages/core/`.
- Pipeline tests use a stub `Extractor` (no LLM) but write through real DuckDB + Ollama embeddings; they early-return when Ollama is unreachable (`ollamaAvailable()` guard). Follow that exact pattern — do not add a hard Ollama dependency to CI.
- Temporal is the **hard pass/fail gate**: the new temporal test must pass, and the re-baseline must show `temporal.correct == 2`. Dedup/precision are **directional**: single-run eval deltas under ~0.1 are run-to-run noise (per `packages/core/eval/README.md`); do not treat small moves as success or failure.
- Do NOT change `packages/core/eval/score.ts`, `packages/core/eval/fixtures/golden.yaml`, or `packages/core/eval/fixtures/scenes.jsonl`. The golden set is the fixed spec.
- Relation-label accuracy and relation F1 are explicitly out of scope — do not touch the relation-scoring or label vocabulary.
- Bump `plugins/ironsworn/.claude-plugin/plugin.json` once, in the final task (minor bump). The Stop hook blocks completion otherwise.
- Valid entity types (`LORE_TYPES`): place, person, faction, material, concept, creature, event, truth, thread.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r
  ```

---

### Task 1: Endpoint-primary directed invalidation (temporal)

Make a supersession invalidate **all** current relations on the resolved
`from → to` pair regardless of label (today it requires an exact label match,
which a supersession — e.g. `BANISHED_FROM` replacing `HOLDS_TITLE` — can never
satisfy). Direction is preserved (`from → to` only).

**Files:**
- Modify: `packages/core/src/rag/lore.ts:559-581` (`invalidateRelations`)
- Modify: `packages/core/src/rag/extraction.ts:217-225` (call site)
- Test: `packages/core/src/rag/extraction.test.ts` (new `describe` block, appended)

**Interfaces:**
- Consumes: `recordScene(campaignPath, summary) → Promise<string>` (sceneId);
  `exportLore(campaignPath) → Promise<{ entities, relations }>` where each
  relation is `{ from_id, to_id, relation, invalid_at: string | null }`;
  `Extractor = (sceneText, existingEntities) => Promise<ExtractionResult>`;
  `ExtractedRelation` already has `supersedes?: boolean`.
- Produces: new signature
  `invalidateRelations(campaignPath: string, fromId: string, toId: string, invalidAt: string): Promise<void>`
  (the `label: string` parameter is REMOVED).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/rag/extraction.test.ts`:

```ts
describe("extractLoreFromScene — temporal supersession (endpoint-primary)", () => {
  it("invalidates all prior relations on a from→to pair when a later relation supersedes, regardless of label", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene } = await import("./scenes.js");
    const { exportLore } = await import("./lore.js");

    // Scene 1: establish Caldren's title + location in Holtfen.
    const scene1 = await recordScene(
      campaignDir,
      "Caldren is the warden captain of Holtfen Settlement, where he lives.",
    );
    const setup: ExtractionResult = {
      entities: [
        {
          canonical: "Caldren",
          type: "person",
          summary: "Caldren is the warden captain of Holtfen Settlement.",
          aliases: [],
          excerpt: "Caldren is the warden captain of Holtfen Settlement",
          confidence: 0.95,
        },
        {
          canonical: "Holtfen Settlement",
          type: "place",
          summary: "Holtfen Settlement is a fortified village.",
          aliases: ["Holtfen"],
          excerpt: "Holtfen Settlement",
          confidence: 0.95,
        },
      ],
      relations: [
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "HOLDS_TITLE",
          excerpt: "warden captain of Holtfen Settlement",
          confidence: 0.95,
        },
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "LOCATED_IN",
          excerpt: "where he lives",
          confidence: 0.95,
        },
      ],
    };
    await extractLoreFromScene(campaignDir, scene1, {
      extractor: makeStubExtractor(setup),
    });

    // Scene 2: Caldren banished — a DIFFERENT label that supersedes the prior facts.
    const scene2 = await recordScene(
      campaignDir,
      "The council banished Caldren from Holtfen Settlement.",
    );
    const supersede: ExtractionResult = {
      entities: [],
      relations: [
        {
          from: "Caldren",
          to: "Holtfen Settlement",
          relation: "BANISHED_FROM",
          supersedes: true,
          excerpt: "banished Caldren from Holtfen Settlement",
          confidence: 0.95,
        },
      ],
    };
    await extractLoreFromScene(campaignDir, scene2, {
      extractor: makeStubExtractor(supersede),
    });

    const { relations } = await exportLore(campaignDir);
    const isCaldrenHoltfen = (r: (typeof relations)[number]) =>
      r.relation === "HOLDS_TITLE" || r.relation === "LOCATED_IN";
    const prior = relations.filter(isCaldrenHoltfen);
    expect(prior.length).toBe(2);
    // Both prior facts must now be invalidated (non-null invalid_at).
    expect(prior.every((r) => r.invalid_at !== null)).toBe(true);
    // The superseding fact itself stays current.
    const banished = relations.find((r) => r.relation === "BANISHED_FROM");
    expect(banished).toBeDefined();
    expect(banished!.invalid_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "temporal supersession"`
Expected: FAIL — both prior relations still have `invalid_at === null` (current
label-strict `invalidateRelations` never matches `BANISHED_FROM`). If Ollama is
down the test early-returns (passes vacuously); ensure Ollama is up so the test
actually exercises the path.

- [ ] **Step 3: Make `invalidateRelations` endpoint-primary and directed**

In `packages/core/src/rag/lore.ts`, replace the function at lines 559-581:

```ts
/**
 * Mark every currently-valid relation on a directed from→to pair as invalidated
 * at the given timestamp, regardless of label. Endpoint-primary (not label-
 * strict) because a supersession is typically expressed with a different label
 * than the fact it replaces (e.g. BANISHED_FROM replacing HOLDS_TITLE); matching
 * on label would never invalidate the prior fact. Direction is preserved, so a
 * to→from relation between the same entities is untouched.
 */
export async function invalidateRelations(
  campaignPath: string,
  fromId: string,
  toId: string,
  invalidAt: string,
): Promise<void> {
  const ctx = await resolveWorldContext(campaignPath);
  const instance = await getWorldDb(ctx);
  const conn = await openWorldWriteConn(instance);
  try {
    await conn.run(
      `UPDATE relations SET invalid_at = ?
       WHERE from_entity = ? AND to_entity = ?
         AND invalid_at IS NULL
         AND (campaign_id IS NULL OR campaign_id = ?)`,
      [invalidAt, fromId, toId, ctx.campaignId],
    );
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 4: Update the call site to drop the `label` argument**

In `packages/core/src/rag/extraction.ts`, replace lines 217-225:

```ts
    if (rel.supersedes && scene.timestamp) {
      await invalidateRelations(
        campaignPath,
        fromEntity.id,
        toEntity.id,
        scene.timestamp,
      );
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "temporal supersession"`
Expected: PASS — both prior relations carry a non-null `invalid_at`, the
`BANISHED_FROM` relation stays current.

- [ ] **Step 6: Run the full rag test file + typecheck to catch fallout**

Run: `cd packages/core && bun test src/rag/extraction.test.ts && bun run tsc --noEmit`
Expected: all extraction tests PASS; tsc clean (no other caller of
`invalidateRelations` exists, confirmed by `git grep`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/lore.ts packages/core/src/rag/extraction.ts packages/core/src/rag/extraction.test.ts
git commit -m "feat(rag): endpoint-primary directed relation invalidation

Supersessions emit a different label than the fact they replace, so the
label-strict invalidateRelations never invalidated prior facts (eval
temporal 0/2). Match on the directed from->to endpoint pair instead,
label-agnostic, mirroring the endpoint-primary scorer.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

---

### Task 2: Dedup threshold alignment (0.92 → 0.85)

Lower the vector dedup pre-check threshold so the write path agrees with the
scorer's `DEFAULT_SIM_THRESHOLD = 0.85` on what counts as "the same entity."

**Risk to note (not a blocker):** the pre-check embeds the bare *canonical name*
(`searchLore(entity.canonical, 3)`) and compares it against each entity's stored
embedding, which is computed from its *summary sentence*. This cross-field
geometry means cosine scores skew moderate, so 0.85 may help less than a naive
reading suggests. The eval re-baseline (Task 4) is the honest measure; if dedup
barely moves, that is a finding for a future pass (normalization, or embedding
the canonical), not a defect in this change.

**Files:**
- Modify: `packages/core/src/rag/extraction.ts:68` (`DEDUP_SIMILARITY_THRESHOLD`)
- Modify: `packages/core/src/rag/extraction.test.ts:134-135` (existing dedup test title/comment referencing 0.92)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (internal constant change).

- [ ] **Step 1: Update the constant**

In `packages/core/src/rag/extraction.ts`, change line 68:

```ts
// Align with the eval scorer's DEFAULT_SIM_THRESHOLD (0.85): the write-path
// "same entity?" decision must match how the eval matches entities, or the
// pipeline and the harness disagree on duplicates. The pre-check embeds the
// canonical name against stored summary embeddings, so scores skew moderate.
const DEDUP_SIMILARITY_THRESHOLD = 0.85;
```

- [ ] **Step 2: Fix the stale 0.92 reference in the existing dedup test**

In `packages/core/src/rag/extraction.test.ts`, the existing test title at line
135 reads `"updates an existing entity when cosine similarity >= 0.92 ..."`.
That test actually merges via exact-canonical match (both names are "Lona"), not
the vector path, so it still passes — but the title is now wrong. Rename it:

```ts
  it("updates an existing entity by exact canonical match instead of creating a duplicate", async () => {
```

- [ ] **Step 3: Run the existing dedup + full extraction tests**

Run: `cd packages/core && bun test src/rag/extraction.test.ts`
Expected: PASS (the exact-canonical dedup test is unaffected by the threshold;
the temporal test from Task 1 still passes).

- [ ] **Step 4: Typecheck**

Run: `cd packages/core && bun run tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rag/extraction.ts packages/core/src/rag/extraction.test.ts
git commit -m "feat(rag): lower dedup pre-check threshold 0.92->0.85

Align the write-path 'same entity?' decision with the eval scorer's
DEFAULT_SIM_THRESHOLD so the pipeline and harness agree on duplicates.
The eval re-baseline is the measure of effect (dedup is a directional
metric); temporal stays the hard gate.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

---

### Task 3: Precision — drop low-confidence entities + sharpen the prompt

Two precision levers. Deterministic: entities below the confidence threshold are
*dropped* (counted as skipped), not inserted-and-flagged. Directional: sharpen
the extraction prompt's entity noise rules. (Low-confidence *relations* are
already skipped at lines 203-207 — leave that as is.)

**Files:**
- Modify: `packages/core/src/rag/extraction.ts:163-201` (entity loop) and the
  entity-rules block of the prompt in `_makeDefaultExtractor` (lines ~302-309)
- Modify: `packages/core/src/rag/extraction.test.ts:244-278` (the confidence
  test now asserts a *drop*, not a flag)

**Interfaces:**
- Consumes: `report.skipped` counter (existing `ExtractionReport` field).
- Produces: no signature changes. Behavior change: `confidence < threshold`
  entities are skipped; `needs_review` metadata is no longer written by
  extraction (it was the only writer).

- [ ] **Step 1: Rewrite the existing confidence test to expect a drop**

In `packages/core/src/rag/extraction.test.ts`, replace the test at lines 245-278
(`"low-confidence entity is upserted with needs_review=true"`) with:

```ts
  it("drops a low-confidence entity instead of inserting it", async () => {
    if (!(await ollamaAvailable())) return;

    const { recordScene, exportScenes } = await import("./scenes.js");
    await recordScene(campaignDir, "A shadowy figure was seen near the ruins.");
    const scenes = await exportScenes(campaignDir);
    const sceneId = scenes[scenes.length - 1]!.id;

    const stubResult: ExtractionResult = {
      entities: [
        {
          canonical: "Shadowy Figure",
          type: "creature",
          summary: "An unidentified figure seen near ruins.",
          aliases: [],
          excerpt: "A shadowy figure was seen near the ruins.",
          confidence: 0.4, // below default threshold of 0.6
        },
      ],
      relations: [],
    };

    const report = await extractLoreFromScene(campaignDir, sceneId, {
      extractor: makeStubExtractor(stubResult),
    });

    // Entity is dropped, not created or flagged.
    expect(report.entities_created).toBe(0);
    expect(report.skipped).toBe(1);
    expect(await getLore(campaignDir, "Shadowy Figure")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "drops a low-confidence entity"`
Expected: FAIL — current code inserts the entity (`entities_created === 1`,
`getLore` non-null).

- [ ] **Step 3: Drop low-confidence entities in the entity loop**

In `packages/core/src/rag/extraction.ts`, replace the entity loop body at lines
163-201. Insert a confidence check right after the type check and remove the
`needs_review` metadata block:

```ts
  for (const entity of result.entities) {
    if (!LORE_TYPES.includes(entity.type)) {
      report.skipped++;
      continue;
    }

    // Drop low-confidence entities entirely rather than flagging them — keeps
    // extraction precision honest (the eval scores every persisted entity).
    if (entity.confidence < threshold) {
      report.skipped++;
      continue;
    }

    const hits = await searchLore(campaignPath, entity.canonical, 3);
    const topHit = hits[0];
    const isExisting = topHit !== undefined && topHit.score >= DEDUP_SIMILARITY_THRESHOLD;

    const upsertResult = await upsertLore(campaignPath, {
      ...(isExisting ? { id: topHit.id } : {}),
      canonical: isExisting ? topHit.canonical : entity.canonical,
      type: entity.type,
      summary: entity.summary,
      aliases: entity.aliases,
      provenance: {
        source_kind: "extraction",
        source_id: sceneId,
        excerpt: entity.excerpt,
        confidence: entity.confidence,
      },
    });

    // Count what actually happened: even when the vector pre-check (isExisting)
    // misses, upsertLore still dedups by exact canonical/alias, so trust its
    // result rather than the cosine guess.
    if (upsertResult.updated) {
      report.entities_updated++;
    } else {
      report.entities_created++;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test src/rag/extraction.test.ts -t "drops a low-confidence entity"`
Expected: PASS.

- [ ] **Step 5: Sharpen the prompt's entity noise rules**

In `packages/core/src/rag/extraction.ts`, in `_makeDefaultExtractor`, replace the
`Do NOT extract` entity bullet (lines ~307-309) with a sharper version carrying
the curator's "named + consequential" principle and concrete negative examples:

```ts
      `- Extract an entity ONLY if it is both NAMED and CONSEQUENTIAL — a proper\n` +
      `  noun that the ongoing story will refer back to. When in doubt, leave it out.\n` +
      `- Do NOT extract: player character stats or moves; emotional or transient\n` +
      `  states ("X is afraid"); implied facts ("X is alive"); generic/unnamed\n` +
      `  background ("a guard", "some merchants", "the road", "the crowd"); or\n` +
      `  anything already captured in the existing entities list above\n\n` +
```

(Confirm the surrounding string-concatenation seams `+` and trailing `\n\n` match
the adjacent lines so the assembled prompt stays valid — read lines 302-319
before editing.)

- [ ] **Step 6: Verify prompt-text tests still pass + typecheck**

Run: `cd packages/core && bun test src/rag/extraction.test.ts && bun run tsc --noEmit`
Expected: PASS / clean. The `_makeDefaultExtractor` fence-stripping and options
tests don't assert on the entity-rules wording, so they are unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rag/extraction.ts packages/core/src/rag/extraction.test.ts
git commit -m "feat(rag): drop low-confidence entities + sharpen extraction prompt

Entities below the confidence threshold are now dropped (counted as
skipped) rather than inserted with needs_review, so persisted entities
reflect extraction precision. Sharpen the prompt's entity rules with the
curator's 'named + consequential' principle and concrete noise examples.
Prompt impact is directional (single-run eval noise); the drop is the
measurable lever.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

---

### Task 4: Re-baseline, README, version bump

> **SUPERSEDED.** Investigation during execution proved the extractor is
> non-deterministic at `temperature=0` (irreducible LLM API non-determinism),
> so a single-run baseline is untrustworthy and temporal is a flaky binary
> gate. This task is replaced by the two tasks in the addendum plan
> `docs/superpowers/plans/2026-06-21-extraction-quality-pass-addendum.md`
> (multi-run aggregation, then re-baseline via aggregation). Do not execute the
> steps below; they assume a deterministic single run.

Run the full eval against the committed fixtures, record the new baseline, and
bump the plugin version. This is the integration gate: temporal must be 2/2.

**Files:**
- Modify: `packages/core/eval/baseline.json` (regenerated)
- Modify: `packages/core/eval/README.md` (baseline numbers, if the doc cites them)
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json` (version bump)

**Interfaces:**
- Consumes: `eval:extraction` script (`bun run eval/run-eval.ts`), which prints a
  scorecard and writes/echoes the JSON. Requires `ANTHROPIC_API_KEY` + Ollama.
- Produces: updated `baseline.json` committed as the new reference.

- [ ] **Step 1: Run the full suite (ensure green before the eval)**

Run: `cd packages/core && bun test`
Expected: all tests PASS (Ollama up). Record the pass count.

- [ ] **Step 2: Run the extraction eval**

Run: `cd packages/core && ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" bun run eval:extraction`
Expected: completes in a few minutes (~24 LLM calls); prints a scorecard
including a `temporal` line. Read `run-eval.ts` to confirm whether it writes
`baseline.json` directly or prints JSON to copy in — follow whichever the script
does.

- [ ] **Step 3: Verify the temporal gate**

Confirm the printed/written scorecard has `temporal.correct === 2` (out of 2).
- If `2/2`: proceed.
- If still `0/2` or `1/2`: the failure is now extraction-side (the LLM did not
  emit a `Caldren → Holtfen` relation with `supersedes: true`, or did not extract
  Caldren). Inspect the throwaway DB / scorecard detail to confirm, and report
  back — do NOT mark this task complete. The invalidation code (Task 1) is proven
  by its unit test; a remaining 0/2 is a recall/flag problem to escalate, not a
  reason to weaken the gate.

- [ ] **Step 4: Record the new baseline**

Write the new scorecard JSON to `packages/core/eval/baseline.json` (matching the
existing shape: `entity`, `relation`, `dedup`, `temporal`). If `run-eval.ts`
already overwrites the file, confirm the diff is sane: `temporal.correct` 0 → 2;
entity recall holds or improves; entity precision and dedup do not drop by more
than ~0.1 (noise). A precision/dedup *regression* beyond noise means the
threshold (Task 2) over-merged — report it before committing.

- [ ] **Step 5: Update README baseline numbers if cited**

Run: `cd packages/core && grep -n "0\\.\\|temporal\\|baseline" eval/README.md`
If the README quotes specific baseline numbers, update them to the new values and
keep the determinism caveat. If it doesn't cite numbers, leave it.

- [ ] **Step 6: Bump the plugin version (minor)**

In `plugins/ironsworn/.claude-plugin/plugin.json`, bump `version` from `0.31.0`
to `0.32.0` (minor — new extraction behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/core/eval/baseline.json packages/core/eval/README.md plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "feat(eval): re-baseline after extraction-quality pass; bump v0.32.0

Temporal 0/2 -> 2/2 (endpoint-primary invalidation now records the
Caldren banishment supersession). Entity/dedup recorded as the new
reference baseline; treated as directional per the harness noise floor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HBH3AtoNwfYCJotTR2kw3r"
```

---

## Plan Self-Review

**Spec coverage:**
- Component 1 (endpoint-primary invalidation) → Task 1 ✅
- Component 2 (dedup 0.92→0.85) → Task 2 ✅
- Component 3 (confidence-drop + prompt) → Task 3 ✅
- Component 4 (re-baseline + tests + version) → Task 4 ✅ (unit tests live in
  Tasks 1 & 3; Task 2's behavioral effect is deferred to the eval per the spec's
  measurement-discipline section)
- Non-goal "no scorer/golden changes" → enforced in Global Constraints ✅
- Non-goal "relation F1 untouched" → enforced in Global Constraints ✅

**Type consistency:** `invalidateRelations` new signature
`(campaignPath, fromId, toId, invalidAt)` is defined in Task 1 and its single
caller is updated in the same task — no later task references the old `label`
arg. `ExtractedRelation.supersedes` and `report.skipped` are pre-existing.
`exportLore` relation shape (`invalid_at: string | null`) is used consistently in
the Task 1 test.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands
have expected output.
