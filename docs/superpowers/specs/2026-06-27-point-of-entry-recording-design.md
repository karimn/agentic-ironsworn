# Point-of-Entry Structured Recording — Design Spec

**Status:** design spec, approved 2026-06-27. Greenfield (new worlds only).

**Goal:** Capture world canon — entities *and relations* — at the moment the
GM narrates it, on the beat, instead of reconstructing it later from prose via
batch LLM extraction. Make authorial point-of-entry recording the primary path
to the knowledge graph; demote `extract_session_lore` to optional backfill.

## Why this exists (the finding that motivates it)

A session spent trying to improve `extract_session_lore` quality hit a wall.
Reliable, multi-run measurement against the Zura golden set showed:

- Relation recall is the worst metric (~0.15–0.24 across variants) because the
  batch extractor reconstructs **100% of relations from prose** — the hardest
  possible version of the task. The GM never records the relations it narrates.
- A two-pass extractor (entities then relations over a fixed vocabulary) was a
  measured **negative result**: ~2× API cost, no precision/dedup recovery. It
  falsified the hypothesis that relation pressure drives entity over-extraction
  — the entity pass over-extracts on its own.
- An audit of the dedup regression found the extractor produces only ~2 true
  off-world false positives, but heavy **fragmentation** (`Lago` vs
  `Lago Rhian`, `Ashfen` vs `Ashfen Settlement`) — the same entity under
  multiple names — because batch extraction re-derives names independently and
  drifts.

Root cause: batch extraction is a **lossy prose→structure reconstruction** that
lacks the author's knowledge of what is canonical and lacks reliable grounding
to reuse existing names. The GM, at the moment of narration, has both. The
architecture already half-intends this — the fiction-grounding protocol mandates
`upsert_entity` for new entities — but **relations are never recorded at point
of entry**, and batch extraction re-derives entities independently, reintroducing
fragmentation.

This spec closes that gap.

## Architecture & data flow

Structured canon is captured *on the beat*, riding the call the GM is already
mandated to make live during play (`record_beat`).

```
CURRENT:  record_beat(prose) ──────────────► beat row
          extract_session_lore (batch LLM re-reads prose) ──► entities + relations

NEW:      record_beat(prose, entities?, relations?) ──► beat row
                                  │  (rides the existing async beat pipeline)
                                  ▼
                          resolve names against existing graph (resolveExisting)
                                  │
                                  ▼
                          write entities + relations, provenance = this beat
          extract_session_lore ──► OPTIONAL backfill (idempotent dedup)
```

Why this dissolves the failure modes:

- **Relations** are captured where they are *known* (the GM just narrated them),
  not reconstructed from prose. Fixes the worst metric at its source.
- **Fragmentation** disappears because entity/endpoint names resolve by **exact
  match** against the existing graph (`resolveExisting`, in
  `packages/core/src/rag/lore.ts`). That works *because* the GM grounded first
  (`recall`) and reuses the existing canonical name — unlike batch extraction.
- **Over-extraction** disappears because recording is a deliberate authorial act,
  not a "pull everything from prose" sweep.

Key property: at point of entry, dedup is **exact-match** (cheap, safe), because
naming is deliberate. We never need the fuzzy/embedding dedup that batch
extraction forces — which carried a real false-merge risk.

## `record_beat` schema & resolution

New optional parameters; existing ones (`scene_id`, `kind`, `text`, `speaker`,
`metadata`, `wait`) unchanged:

```ts
record_beat({
  scene_id, kind, text, speaker?, metadata?, wait?,            // unchanged
  entities?:  [{ canonical, type, summary, aliases? }],        // canon this beat establishes
  relations?: [{ from, to, label, notes?, supersedes? }],      // links this beat establishes
})
```

Resolution runs in the beat's existing async settle path (completes before
return when `wait=true`):

1. **Entities** — for each, `resolveExisting(canonical / aliases)`:
   - **Found** → reuse the existing entity (reference; do not overwrite its
     summary). This is the anti-fragmentation guarantee.
   - **Not found** → create campaign-scoped via `upsertLore`, provenance
     `{ source_kind: "beat", source_id }`.

2. **Relations** — resolve `from`/`to` against the existing graph **plus the
   entities in this same beat**:
   - **Both resolve** → `linkLore` with `valid_at = scene timestamp` and beat
     provenance. `supersedes: true` → call `invalidateRelations` first (reuses
     existing temporal logic). Duplicate links are idempotent (`ON CONFLICT`).
   - **An endpoint does not resolve** → **skip the relation and surface a
     notice** ("'Y' not found — ground it or add it to `entities`"). We do NOT
     auto-stub: auto-creating a node from a bare endpoint name would reintroduce
     the fragmentation this design eliminates, and grounding-first discipline
     plus backfill extraction cover the genuinely-missed case.

**Error handling:** scene-not-found returns the existing error; an invalid
entity `type` is skipped with a notice; unresolved relation endpoints are
skipped with a notice (above). Notices drain to the GM through the existing
notice channel, so omissions are visible during play.

**Async note:** the structured writes happen in the beat's background settle
(like the embedding write today), preserving `record_beat`'s fire-and-forget
default; `wait=true` blocks until they complete.

## Protocol & prompt changes (GM behavior)

This is what turns mechanism into habit. Content changes in two places: the GM
agent's **Fiction Grounding Protocol** (`plugins/ironsworn/agents/ironsworn-gm.md`)
and the scene-craft skill's reminder
(`plugins/ironsworn/skills/ironsworn-scene-craft/SKILL.md`).

Revised protocol:

1. **Ground first** — `recall` the subject before naming it. *(Already exists.)*
2. **Narrate** the beat.
3. **Record the beat with its canon** — call `record_beat` carrying:
   - `entities`: new canon the beat established, **using the exact canonical
     names returned by grounding** (reuse; never coin a variant);
   - `relations`: the relationships the beat asserted between those entities.
4. **MANDATORY** — a beat that establishes a new entity or a relationship MUST
   carry it in that same `record_beat` call (mirrors the existing rule that a
   summary-only scene recording is forbidden).
5. **Never contradict** established canon. *(Already exists.)*

Two emphases do the heavy lifting and must be stated explicitly and repeatedly:

- **Reuse exact grounded names** — the single anti-fragmentation instruction.
  The exact-match resolution only pays off if the GM reuses names.
- **Relations are first-class at point of entry** — closing the gap where they
  were left entirely to batch extraction.

Reliability is **prompt discipline only** (consistent with how `record_beat` is
already mandated). No enforcement hooks; the backfill path is the safety net.

## Extraction as backfill + measurement

**Backfill.** Idempotent dedup is already present — `upsertLore` matches
existing entities by exact canonical/alias, `linkLore` is `ON CONFLICT`. So
extraction run after point-of-entry recording reuses what the GM recorded. The
residual caveat (extraction may still coin a name variant) is **accepted**:
extraction is now the rarely-used exception path. The `extract_session_lore`
command's framing changes from "how lore gets into the graph" to "optional
backfill — run it if you suspect the GM missed something."

**Explicit scope boundary:** no further extraction-quality optimization is in
scope. The pivot is to stop polishing the lossy reconstruction. The diagnostics
and type-aware prompt produced this session remain on their branch as artifacts;
this design supersedes the *strategy*, not those files.

**Measurement** (honestly softer — the real cost of the pivot, since quality now
depends on GM behavior):

1. **Mechanism correctness** → unit tests (below).
2. **Recording quality in real play** → **golden-free graph-health checks**
   runnable against any world's graph after a session. NOTE: the diagnostics
   built this session (`entityRecallByType`, near-duplicates, false-positives)
   are golden-*relative* — they compare against the eval's golden set and cannot
   run on an arbitrary world. The graph-health checks are small new golden-free
   adaptations of the same ideas: fragmentation = near-duplicate clusters found
   by self-similarity *among the graph's own entities* (no golden); relation
   coverage = fraction of entities with ≥1 current relation, relations-per-entity.
   Indicators, not a golden score. These are lightweight; if they slip, the
   mechanism unit tests and backfill eval remain the gates.
3. **Backfill quality** → the existing extraction eval remains as the reference
   for the fallback path and a guard that we did not break extraction.

A play-session golden ("ideal recorded canon" for a scripted session) is noted
as future work, not built here.

## Testing (TDD, mechanism-level)

Logic lives in `@agentic-rpg/core`; the MCP tool is a thin wrapper. Tests follow
existing `scenes.test.ts` / `extraction.test.ts` patterns (Ollama-guarded where
embeddings are needed):

- `entities` with an existing name → reuses, no duplicate node.
- `entities` with a new name → creates campaign-scoped entity with beat provenance.
- `relations` with both endpoints resolving → `linkLore` written with `valid_at`
  + beat provenance.
- relation endpoint defined in the same beat's `entities` → resolves (new entity
  + link in one call).
- relation with an unresolved endpoint → skipped + notice surfaced.
- `supersedes: true` → `invalidateRelations` invoked.
- idempotency: re-recording the same entity/relation → no duplicate.
- `wait=true` → structured writes complete before return.

## v1 design-doc reconciliation

This pivot revises claims in `docs/design/agentic-rpg-v1.md`. The implementation
updates these four sections so the architectural source of truth stays consistent:

1. **"Why coherence is the hard problem" → failure mode #1 (Extraction quality).**
   Currently calls extraction the "highest-leverage component." Rewrite: the
   highest-leverage fix is authorial capture at point of entry; extraction is a
   lossy reconstruction demoted to backfill. Record *why* (this session's
   measured findings).
2. **"v1 priorities, in order" + the status header.** Add a new priority —
   point-of-entry structured recording as the primary canon-capture path — and
   reframe #2 (the extraction eval harness) as *backfill-quality measurement*,
   not the primary quality lever.
3. **"The fiction-grounding protocol."** The doc's version stops at
   `upsert_entity`; update it to record **relations on the beat**.
4. **"Tool surface."** Note that `record_scene` / `record_beat` now carry
   structured canon, and reposition `extract_session_lore` as optional backfill.

## Scope

**In scope:** `record_beat` schema + resolution in core; the MCP wrapper;
Fiction-Grounding-Protocol rewrite (agent + scene-craft skill);
`extract_session_lore` repositioned as optional backfill (framing only);
small golden-free graph-health checks (fragmentation clustering + relation
coverage); the four v1-doc edits above.

**Non-goals:**

- Migration of existing worlds — **greenfield only**.
- Any further extraction-quality optimization.
- A play-session golden eval — future work.
- Enforcement hooks — **prompt discipline only**.
- Auto-stub for unresolved endpoints — chose **skip + notice**.
- Scene-level structured payload — chose **beats**.
- Changes to `recall` / search — already built.

## Decisions

- **D1** Greenfield only; existing worlds keep using extraction as-is.
- **D2** Extraction stays as optional backfill (not removed), deduping against
  recorded canon via existing exact-match/`ON CONFLICT` idempotency.
- **D3** Reliability is prompt discipline only — no enforcement hooks.
- **D4** Recording mechanism is **structured beats**: `record_beat` carries
  `entities` + `relations`. Rejected: protocol-only (verbose, easier to forget)
  and scene-level payload (reintroduces reconstruct-from-memory at scene close).
- **D5** Unresolved relation endpoints are skipped with a notice, never
  auto-stubbed, to preserve exact-match cleanliness.
- **D6** Point-of-entry dedup is exact-match only (`resolveExisting`); no fuzzy
  or embedding dedup on this path.
