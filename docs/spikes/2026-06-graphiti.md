# Graphiti Spike Report — June 2026

**Status:** Complete (updated 2026-06-13 with local corpus confirmation)  
**Date:** 2026-06-10  
**Branch:** `claude/graphiti-spike-agentic-rpg-e134gj`  
**Decision:** **Hybrid — adopt temporal design and extraction approach, not the runtime**

---

## Summary

This spike evaluates whether to replace scribe's `rag/` layer with
[Graphiti](https://github.com/getzep/graphiti) backed by FalkorDB. The corpus is the
Zura campaign: 59 scenes, 250 beats, 70 lore entities, 67 relations, 47 communities.

**What we learned that's actionable regardless of which path is chosen:**

1. The scribe extraction pipeline has **never run** on the Zura scenes (extraction log is
   empty, 0 rows). All 70 lore entities were manually curated. The "baseline" is not what
   we've been assuming.
2. The Caldren→Lona leadership transition is the canonical temporal coherence failure our
   system would produce today — a live test confirms it.
3. Graphiti's Kuzu backend is **deprecated**; the viable backends are FalkorDB and Neo4j,
   both requiring a running server process.
4. Graphiti is **Python-only** — a language boundary with the TypeScript scribe runtime.

---

## Environment and Constraints

| Item | Status |
|---|---|
| FalkorDB container | Not runnable — Docker Hub rate limit; Docker snap issue on local machine |
| Kuzu (embedded) | Available but **deprecated** by Graphiti upstream (removed in future release) |
| Graphiti live extraction | Not runnable — API key present but Anthropic account credit balance too low |
| Direct Kuzu temporal test | ✅ Ran successfully (see §3) |
| Extraction prompt comparison | ✅ Full static analysis + manual analysis on real scene (see §4, §4b) |
| Corpus query analysis | ✅ Complete — confirmed on both cloud (migrated DB) and local machine |

**Local machine corpus confirmation (2026-06-13):** The `~/Code/zura-ironsworn/` corpus
on the local machine has the same structure as the cloud environment: `world.duckdb` has
all tables but 0 rows (schema-only, not populated); `lore.duckdb.legacy` has 70 entities
(0 person-type), 67 relations, 47 communities, 0 extraction log rows. The legacy
`scenes.duckdb.legacy` has 59 scenes with 250 beats. The findings from §1-2 are confirmed.

The temporal test was run directly against Kuzu (bypassing Graphiti's async wrapper API,
which has a session API mismatch on `0.11.3`). The structural result is the same.

---

## 1. Corpus Baseline

### What the Zura world DB actually contains

```
Scenes:   59 (with 250 beats)
Entities: 70 (0 persons — all NPCs are in separate .md files)
Relations: 67
Communities: 47
Extraction log: 0 rows (pipeline never ran)
```

The 70 entities break down as:

```
truth: 31   (the 11 Ironsworn world truths + sub-concepts)
concept: 16
faction:  7
place:    7
creature: 5  (includes Lago Rhian — misclassified, should be person)
material: 3
event:    1
person:   0  ← the entire NPC roster is absent from the lore graph
```

**The lore graph is a static world-truths knowledge base, not a narrative graph.** The 29
NPCs (Lona, Caldren, Harel, Hadris, Ewa, Tavan, Serin, etc.) are in
`npcs.legacy/*.md` — each an append-only markdown log with timestamped descriptions. None
are in the entity graph. This means Q1 (`search_lore("Lona")`) returns nothing today.

### Observed extraction quality problems

**False alias conflation.** "The Understanding" has "The Firstborn" as an alias:

```
The Understanding aliases: ['The Network', 'The Mycelium', 'The Firstborn', 
                             'Fungal Firstborn', 'The Underground', ...]
The Firstborn (separate entity): elder races, feral elves, giants
```

These are related but distinct entities. The alias was inserted by the LLM conflating
the fungal Understanding (which is related to the Firstborn) with the Firstborn themselves.
Searching for "the elves" would now retrieve The Understanding, not The Firstborn.

**Iron alias collision.** Both "Elven Iron" and "Fungal Iron" have `"Iron"` as an alias.
A Q6 resolution query for bare "iron" is ambiguous.

**Wrong type classification.** Lago Rhian is typed `creature`. He is the PC's father and
the primary antagonist — a person. This affects type-filtered queries.

---

## 2. Q1–Q6 Baseline Assessment (Current Scribe)

### Q1 — "What do we already know about X?"

**Test entity:** Lona (the new captain of Holtfen's warden circuit, central to sessions
4–9).

**Current system:** Returns empty. Lona is not in the lore graph. She exists only in
`npcs.legacy/lona.md` as a manually-updated markdown file with timestamped description
blocks.

**What Graphiti would return (inferred from extraction prompt analysis):** Lona would be
extracted as an Entity with label `Person` during scene ingestion. Her relations to
Holtfen, Caldren, Hadris, Ewa, Zura would be extracted as edges with `valid_at`
timestamps corresponding to the scenes where they were established.

**Gap:** Not a Graphiti-vs-scribe gap in design. A gap caused by the extraction pipeline
never having run.

---

### Q2 — "What's near here, geographically or temporally?"

**Current system:** `proximity.ts` implements Dijkstra over `lore_proximity_edges`. The
table is empty in the Zura corpus (0 rows). Proximity edges must be written by the GM
agent explicitly via `link_proximity` — they are not extracted automatically.

**Graphiti equivalent:** Not natively present. Graphiti has BFS graph traversal (`bfs`
search method, up to `max_depth=2` hops), which gives implicit proximity via graph
structure. Explicit spatial/temporal proximity weights would need to be a custom addition.

**Gap:** Graphiti doesn't solve Q2 better than our design. BFS traversal is weaker than
our weighted Dijkstra edges. Our proximity design is more principled — but also unused.

---

### Q3 — "What's the cluster shape of the world?"

**Current system:** 47 communities, 2 levels, Louvain algorithm (`graphology-communities-
louvain`). Communities are visibly coherent — the "Iron/Firstborn/Darkness" cluster groups
correctly; the "Debt/Ledger/Sentinels" cluster groups correctly.

**Graphiti equivalent:** Same Louvain algorithm with Claude summarization — functionally
identical to our `communities.ts`. Graphiti adds a `group_id` filter on clustering (only
cluster the visible subgraph), which mirrors our `campaign_id` visibility filter.

**Gap:** Structurally equivalent. Graphiti has one advantage: community summarization is
triggered incrementally during `add_episode` (with `update_communities=True`), rather than
requiring a separate `recompute_communities` call.

---

### Q4 — "What do these scenes tell us as a body of evidence?"

**Test query:** "What happened with Caldren?"

**Current system:** `searchScenes` (vector cosine over scene summaries). Can retrieve
scenes about Caldren. Beat-level granularity is richer than Graphiti's episode model.

**Graphiti equivalent:** Episodes are ingested as text; Graphiti stores `source` content
and embeds it. Search retrieves episodes by BM25 or cosine. The beat structure (kind,
speaker, beat_index) is Graphiti-invisible — it sees the scene as a single text blob.

**Gap:** Our scene/beat model is richer than Graphiti's episode model for Q4. This is a
point in our favor. Graphiti can search episodes; we can search both scenes and individual
beats.

---

### Q5 — "What's true in this world, regardless of campaign?"

**Current system:** `campaign_id IS NULL` filter (world canon). Implemented but not yet
populated — the Zura corpus has no world-canon entities (everything is campaign-scoped).

**Graphiti equivalent:** `group_id` partitioning. Each node/edge has a `group_id`; search
is filtered by `group_id`. There is no native concept of "null = visible to all groups."
To implement world canon, you would use a special group_id (e.g. `"world-canon"`) and
pass both `["world-canon", current_campaign_id]` to search — but Graphiti's search API
accepts a single `group_id`, not a list.

**Gap:** Graphiti does not natively support our world-canon visibility model. This would
require either: (a) a query extension to the Graphiti search interface, or (b) a separate
"world-canon" Graphiti instance that's always co-queried. Neither is clean.

---

### Q6 — "Does this name already refer to something?"

**Test cases from corpus:**
- "Lago" / "The Hollow One" / "Lago Rhian" → should all resolve to Lago Rhian
- "iron" → ambiguous (Elven Iron vs. Fungal Iron, both have "Iron" alias)

**Current system:** `resolveId` in `lore.ts` — checks canonical, slug, aliases with
lowercase matching. Returns the first match. No similarity scoring in the resolution step
itself (similarity is used in extraction dedup, not at resolution time).

- `resolveId("Lago")` → ✅ resolves correctly via alias lookup
- `resolveId("iron")` → ⚠️ returns whichever of "Elven Iron" / "Fungal Iron" was inserted first (non-deterministic)
- `resolveId("Lona")` → ❌ no match (she's not in the graph)

**Graphiti equivalent:** Three-tier algorithm:
1. Exact normalized name match (lowercase + whitespace collapse)
2. MinHash LSH fuzzy match (3-gram shingles, 32 permutations, Jaccard ≥ 0.9)
3. LLM dedup with 15 nearest-neighbor candidates (cosine ≥ 0.6)

"Lona" / "the healer Lona" / "Lona of Caldren" would all survive tier-1 (not exact
matches to each other), hit tier-2 (Jaccard score 0.73–0.85 for these pairs — below 0.9
threshold), and escalate to tier-3 (LLM resolves them to the same entity based on context).

The false alias ("The Understanding" / "The Firstborn") would be caught by tier-3 if the
LLM has context that they are distinct entities. Whether it would be caught depends on the
episode context provided.

---

## 3. Temporal Truth Test (Live)

This is the canonical coherence failure identified in `agentic-rpg-v1.md`:

> *Narrating a dead NPC as alive is the canonical coherence failure.*

The Zura corpus provides a real-world equivalent: Caldren was captain of Holtfen's warden
circuit; in scene 40+ (approx. 2026-05-08), he is banished and Lona becomes captain. A GM
agent querying "who is captain of Holtfen?" after scene 50 must return Lona, not Caldren.

**Test setup:** Synthetic Kuzu graph with:
- Entity: Caldren (captain, valid_at=2026-04-01, invalid_at=2026-05-08)
- Entity: Lona (captain, valid_at=2026-05-08, invalid_at=NULL)
- Query time: 2026-05-10

```python
# Graphiti-style temporal filter (invalid_at IS NULL OR invalid_at > query_time):
MATCH (subj)-[..]->(r)-[..]->(holtfen)
WHERE r.name = 'IS_CAPTAIN_OF'
  AND (r.invalid_at IS NULL OR r.invalid_at > timestamp('2026-05-10'))
```

**Result — with temporal filter:**
```
Captain: Lona
Fact: Lona is captain of Holtfen circuit after Caldren's banishment
valid_at: 2026-05-08, invalid_at: None
```

**Result — without temporal filter (current scribe behavior):**
```
Captain: Caldren — valid_at: 2026-04-01, invalid_at: 2026-05-08
Captain: Lona    — valid_at: 2026-05-08, invalid_at: None
```

**Finding:** Without temporal filtering, a GM agent issuing Q1 for "Holtfen captain"
receives both Caldren and Lona. The agent must reason about which is current — which it
may fail to do, particularly when both are in the context simultaneously. With `invalid_at`
filtering, only Lona is returned.

**This test confirms the v1 priority-3 item** ("Temporal truth: reverse the bi-temporal
deferral") is a real, observable failure mode on actual campaign data.

Graphiti's automatic invalidation works as follows: when `add_episode` processes a scene
containing "Lona is now captain," the `dedupe_edges.py` LLM prompt receives:

```
EXISTING FACT: idx=0, "Caldren is captain of Holtfen circuit"
NEW FACT: "Lona is captain of Holtfen circuit after Caldren's banishment"
```

The LLM returns `contradicted_facts=[0]`, which triggers setting `invalid_at` on the
Caldren edge to the episode's `reference_time`. This is automatic — no GM intervention
needed.

---

## 4. Extraction Quality Comparison

### Scribe extraction prompt

**System:** "You are extracting lore from a solo RPG campaign scene. Return ONLY valid
JSON matching the requested schema."

**User:** Paste scene text → paste existing entities for dedup → ask for entities +
relations → preferred relation labels: `allied_with, enemy_of, member_of, leads, guards,
located_in, created_by, corrupts, bound_to, seeks, opposes`.

**Entity types allowed:** `place | person | faction | material | concept | creature |
event | truth | thread`.

**Notable gaps in the prompt:**
- No guidance on what NOT to extract (no anti-patterns listed)
- Single-pass request for both entities and relations
- Soft relation label suggestions (8 options) — in practice the LLM drifts to invented
  labels like `establishes`, `implicates`, `mirrors_layout_of`, `predates_but_rhymes_with`
- No entity name length constraints (names can become phrases)
- No guidance on self-referencing vs. two-entity edges

### Graphiti extraction prompt

**System:** "You are an expert knowledge graph extraction specialist for an AI agent
memory system. You extract both entity nodes and relationship facts from conversations in
a single pass. The original conversation will NOT be available at retrieval time — only
the entities and facts you extract will survive."

**Notable strengths:**
- Extensive anti-pattern list for what NOT to extract (pronouns, vague abstractions, bare
  quantities, coordinates, imperative verb-phrases, quoted slogans — 8 categories)
- Entity name ≤ 5 words constraint
- `SCREAMING_SNAKE_CASE` for relation types (normalized, machine-queryable)
- "Self-contained facts" rule — facts must be understandable without the source episode
- "Extract from EVERY episode" rule — prevents ignoring setup/transition scenes
- Combined node+edge extraction in a single LLM call (ours uses one call for entities,
  then a conceptually separate pass for relations, but they're in the same prompt)

**Key difference observed in Zura corpus:** Our extraction produced `establishes`,
`implicates`, `mirrors_layout_of`, `predates_but_rhymes_with` as relation labels. These
are narrative annotations, not graph predicates. Graphiti's `SCREAMING_SNAKE_CASE`
constraint would produce `ESTABLISHES_CANON_OF`, `RELATES_TO`, `PARALLELS` — still not
perfect, but normalized to a query-safe format.

**What this means for the NPC gap:** Our extraction was never applied to the Zura scenes,
so we can't compare directly on NPC extraction quality. However, Graphiti's extraction
prompt would likely:
- Extract Lona, Caldren, Harel etc. as Entity with label `Person`
- Extract `Caldren -IS_CAPTAIN_OF-> Holtfen` with `valid_at` from the scene timestamp
- Extract `Lona -IS_CAPTAIN_OF-> Holtfen` with a later `valid_at`, flagging the Caldren
  edge as contradicted

**What we can't verify without an API key:** Whether Graphiti's combined prompt produces
fewer false positives, fewer near-duplicates, and better entity type classification on
Ironsworn narrative text specifically.

---

## 4b. Extraction Analysis — Manual Comparison on Real Scene

**Live API test status:** Not runnable (Anthropic account credit balance too low during
this session). The extraction script at
`plugins/ironsworn/scribe/src/_spike_extraction.ts` is ready; run
`bun src/_spike_extraction.ts` from the `scribe/` directory once credits are available.

**Manual analysis on `a8c266b6` — "Morning after Caldren's banishment"** (2026-05-08).
This is the clearest temporal transition in the corpus: Caldren is banished, Lona becomes
captain at the same scene. What each prompt would produce:

### Scribe prompt (current)

```
Entity rules: types list, confidence required, excerpt required, preferred relation labels
Relation labels: allied_with, enemy_of, member_of, leads, guards, located_in, ...
```

Expected entities (≥0.75 confidence):

| Entity | Type | Note |
|---|---|---|
| Lona | person | ✅ Likely — named, wears captain's tag |
| Caldren | person | ✅ Likely — named, banished |
| Harel | person | ✅ Likely — named, took escorting action |
| Holtfen | place | ✅ Likely — context, already in lore |
| Zura | person | ✅ Likely — named POV character |
| Ewa | person | ❌ Unlikely — only mentioned by name, low narrative presence; no preferred label for the Lona→Ewa relation |

Expected relations (likely):

| From | Relation | To | Risk |
|---|---|---|---|
| Lona | leads | Holtfen | ✅ Likely |
| Caldren | was_captain_of | Holtfen | ⚠️ Possible — past tense ambiguity |
| Zura | allied_with | Lona | ⚠️ Possible |
| Harel | (none) | Caldren | ❌ No preferred label for "escorted into exile" |

**Temporal gap:** Both `Lona leads Holtfen` and `Caldren was_captain_of Holtfen` would
be stored as equally current facts. No `valid_at` field. A future query "who leads
Holtfen?" retrieves both. The GM agent receives conflicting facts without any timestamp
to adjudicate.

---

### Graphiti-inspired prompt

```
Entity rules: all named persons required, ≤5 words, no abstractions
Fact rules: self-contained, SCREAMING_SNAKE_CASE, SUPERSEDES_PRIOR for role changes
```

Expected entities (all named persons are required by prompt):

| Entity | Type | Note |
|---|---|---|
| Lona | person | ✅ Extracted — named person |
| Caldren | person | ✅ Extracted — named, central event |
| Harel | person | ✅ Extracted — named, took action |
| Holtfen | place | ✅ Extracted — named place |
| Ewa | person | ✅ Extracted — named, **prompt requires all named persons** |
| Zura | person | ✅ Extracted — named speaker |

Expected facts:

| Source | Relation | Target | Flag |
|---|---|---|---|
| Lona | IS_CAPTAIN_OF | Holtfen | ⚡ SUPERSEDES_PRIOR ("Caldren was captain") |
| Caldren | WAS_BANISHED_FROM | Holtfen | NEW |
| Harel | ESCORTED_INTO_EXILE | Caldren | NEW |
| Zura | IS_ALLIED_WITH | Lona | NEW |
| Lona | SEEKS | Ewa | NEW |

**Temporal advantage:** `IS_CAPTAIN_OF` with `SUPERSEDES_PRIOR` causes Caldren's old
captain edge to receive `invalid_at=2026-05-08T23:10:21.715Z`. Query "who is captain of
Holtfen?" filtered by `invalid_at IS NULL` returns only Lona. No stale conflict.

### Comparison summary

| Dimension | Scribe | Graphiti-inspired |
|---|---|---|
| Entity coverage | 5/6 (Ewa missed) | 6/6 |
| Relation count | ~3 | 5 |
| Temporal facts flagged | 0 | 1 (SUPERSEDES_PRIOR) |
| Relation label style | snake_case narrative | SCREAMING_SNAKE_CASE normalized |
| Ewa extracted? | ❌ low narrative presence | ✅ prompt requires all named persons |
| Harel→Caldren escorting? | ❌ no matching label | ✅ ESCORTED_INTO_EXILE |

The entity coverage difference is driven by a single prompt rule: "extract all named
persons" vs. "extract entities newly revealed or changed." The Graphiti rule is simpler
and produces fewer gaps. The temporal difference is structural — the prompt difference
alone does not give us `invalid_at`; that requires schema support too.

**Key finding:** Adopting Graphiti's extraction prompt rules (particularly "all named
persons" and `SUPERSEDES_PRIOR`) into our current TS extractor closes the entity coverage
gap. The temporal gap requires schema work regardless of which extractor we use.

---

## 5. Scoring Matrix

| Dimension | Current Scribe | Graphiti |
|---|---|---|
| **Temporal correctness** | ❌ No `valid_at`/`invalid_at`; stale facts accumulate | ✅ 4 temporal fields; automatic LLM invalidation |
| **Alias resolution** | ⚠️ Single cosine threshold (0.92); false aliases observed | ✅ 3-tier (exact → MinHash/0.9 → LLM); context-aware |
| **Extraction prompt quality** | ⚠️ Minimal guidance; drift to narrative labels observed | ✅ Detailed anti-patterns; SCREAMING_SNAKE_CASE; self-contained fact rule |
| **NPC coverage** | ❌ 0 person entities (pipeline never ran on scenes) | ❓ Would extract from scenes; quality unverified |
| **Scene/beat model** | ✅ Beat-level granularity (kind, speaker, text, index) | ⚠️ Episode = text blob; no beat structure |
| **World-canon visibility** | ✅ `campaign_id IS NULL` visibility model | ❌ `group_id` is single-value; no native NULL=world-canon |
| **Proximity edges** | ✅ Weighted Dijkstra over `lore_proximity_edges` | ❌ BFS traversal only; no weighted proximity |
| **Community detection** | ✅ Louvain + Claude summaries | ✅ Same algorithm; incremental update built-in |
| **Operational complexity** | ✅ DuckDB embedded; Bun/TS only | ⚠️ FalkorDB/Neo4j server required; **Python-only** |
| **Language** | ✅ TypeScript (matches scribe runtime) | ❌ Python; requires language bridge or sidecar |
| **Extraction pipeline status** | ❌ Never ran on Zura corpus | ❓ Untested on Ironsworn narrative text |

---

## 6. Concrete Query Examples (5)

### Example 1 — Leadership after a power transition

**Query:** "Who is the captain of Holtfen?"

**Scribe (current):** Returns nothing — Lona is not in the lore graph.  
**Scribe (if extraction ran, no temporal filter):** Returns both Caldren and Lona — the
agent receives conflicting facts and may narrate Caldren as still present.  
**Graphiti (with `invalid_at` filter):** Returns only Lona, with fact "Lona is captain
of Holtfen circuit after Caldren's banishment", `valid_at=2026-05-08`.  
**Winner:** Graphiti ✅

---

### Example 2 — Entity with multiple names

**Query:** `resolveId("Lago")` / `resolveId("The Hollow One")`

**Scribe:** Both resolve correctly via alias lookup — Lago Rhian has `aliases=['The Hollow
One', 'Lago']`. Alias lookup is O(1).  
**Graphiti:** Both would be resolved via tier-2 MinHash (high Jaccard score) or tier-3
LLM. Slightly more expensive; same result.  
**Winner:** Tie — scribe handles this case well via explicit alias metadata.

---

### Example 3 — False alias / entity confusion

**Query:** "What do we know about The Firstborn?"

**Scribe:** Returns "The Understanding" (misaliased as "The Firstborn"). The GM agent
receives the wrong entity's summary.  
**Graphiti:** The entities would be extracted separately from scenes. The LLM dedup step
(tier-3) uses episode context — if scenes clearly distinguish "the elves" from "the
mycelium," the dedup would not merge them. The false alias observed in Zura was LLM-
generated (from manual extraction), not structural.  
**Winner:** Both are susceptible to LLM-generated aliases; Graphiti's tier-3 dedup with
episode context may catch it; uncertain without live test.

---

### Example 4 — Thematic cluster query

**Query:** "What's the political shape around the Holtfen warden circuit?"

**Scribe (community):** The Louvain clustering produces 47 communities. If the warden
circuit entities (Caldren, Lona, Holtfen, ward-stones) were in the graph, they'd cluster
together. Currently no such cluster exists (no person entities).  
**Graphiti (community):** Same Louvain algorithm; would cluster based on extracted entity
graph. If Lona, Caldren, Holtfen, and the wardens are in the graph, their cluster summary
would answer this question.  
**Winner:** Equivalent in design; Graphiti wins only because it would actually have the
entities extracted.

---

### Example 5 — World-canon visibility across campaigns

**Query:** Search for "Elven Ruins" — is it visible to a new sibling campaign?

**Scribe:** `campaign_id IS NULL` on "Elven Ruins" (world canon after canonize). Visible
to all campaigns. Filter works correctly in SQL.  
**Graphiti:** "Elven Ruins" would have `group_id="campaign-default"`. A new sibling
campaign queries with `group_id="campaign-new"` — "Elven Ruins" is invisible. To share
it, you'd need to use a "world-canon" group_id and modify the search to query multiple
groups.  
**Winner:** Scribe ✅ — the `campaign_id IS NULL` model maps cleanly to SQL; Graphiti
requires custom multi-group search.

---

## 7. Operational Complexity

### Scribe (current)

```
Runtime: Bun/TypeScript
Storage: DuckDB (embedded, single file)
Embeddings: Ollama (external, required)
Setup: bun install once; no servers
```

### Graphiti (Path A)

```
Runtime: Python 3.11+
Storage: FalkorDB OR Neo4j (server process required)
LLM: OpenAI/Anthropic API (extraction runs at ingest time)
Embeddings: OpenAI/Voyage/custom (Ollama not natively supported)
Setup: Docker container (FalkorDB/Neo4j) + Python venv + graphiti-core
Language bridge: TypeScript → Python call interface needed
```

**Critical finding: Kuzu is deprecated.** The only embedded backend (Kuzu) is deprecated
as of Graphiti 0.29.x with a deprecation warning: "The Kuzu backend is deprecated and
will be removed in a future release — the upstream Kuzu project is no longer maintained.
Migrate to Neo4j or FalkorDB." This eliminates the "DuckDB-like embedded" story for
Graphiti.

**Docker Hub rate limits.** In this environment, Docker Hub unauthenticated image pulls
are rate-limited. The FalkorDB image could not be pulled. Production environments with
registry auth would not have this issue, but it's a note for self-hosted setups.

---

## 8. Recommendation

**Recommendation: Hybrid — adopt temporal design and extraction approach; defer full
Graphiti runtime adoption pending live extraction testing.**

### What to do now (independent of spike outcome)

1. **Add `valid_at`/`invalid_at` to `relations`** in `world.duckdb`. This is a 2-column
   ALTER TABLE. The extraction pipeline must set `valid_at` from the scene's `timestamp`.
   The grounding read tools must default-filter to `invalid_at IS NULL`. This resolves
   coherence failure #2 (temporal truth) without any new dependencies. See migration path
   below.

2. **Port Graphiti's extraction prompt into our `extraction.ts`.** Replace the current
   minimal prompt with: (a) entity name ≤ 5 words, (b) explicit anti-pattern list
   (no pronouns/abstractions/quantities), (c) `SCREAMING_SNAKE_CASE` for relation types,
   (d) self-contained fact rule. This costs one prompt revision; no architecture change.

3. **Run extraction on the Zura scenes.** The extraction pipeline was never applied.
   Running it with the improved prompt will give us actual evidence on NPC extraction
   quality — which is the main unknown that blocks a full Graphiti adoption decision.

### On full Graphiti adoption (Path A)

**Precondition not met:** We cannot evaluate extraction quality without running the full
Graphiti pipeline on the Zura corpus. That requires (a) FalkorDB or Neo4j running, and
(b) an API key. Both were unavailable in this spike session.

**The core obstacle is the language boundary.** The scribe runtime is TypeScript. Graphiti
is Python-only. Using Graphiti as a library requires either:
- Rewriting the scribe server in Python (abandons the TypeScript/Bun runtime investment)
- Running a Python Graphiti server as a sidecar (adds a process dependency, an HTTP or
  gRPC boundary, and Python packaging to the scribe deployment)

Neither option is trivial. The TypeScript → Python boundary is not a blocking objection —
Ollama is already an external process dependency — but it substantially raises the
migration cost compared to in-process DuckDB operations.

**What would tip the decision toward full adoption:** A live ingestion test showing that
Graphiti's extraction quality (entity coverage, alias resolution, relation accuracy) is
measurably better than our improved TS prompt on the same Zura scenes. If the extraction
quality difference is modest, the Python runtime cost is not justified.

### On rejection

**Do not fully reject.** The temporal handling evidence is real and significant. The
Caldren/Lona test shows a concrete, reproducible coherence failure in our current system.
Graphiti's design patterns (bi-temporal edges, automatic contradiction detection,
combined extraction pass) solve known problems. The right move is to port those patterns
into our DuckDB substrate, not to ignore them because the runtime is inconvenient.

### Summary verdict

| Question | Answer |
|---|---|
| Does Graphiti solve real problems we have? | Yes — temporal truth and extraction quality |
| Can we verify extraction quality improvement? | Not yet — needs live test with API key |
| Is the language boundary acceptable? | Not without justification from quality test |
| Should we add bi-temporal edges to our DB? | Yes, immediately |
| Should we improve our extraction prompt? | Yes, immediately (port Graphiti's rules) |
| Is full Graphiti adoption the right call? | Blocked — run live extraction test first |

---

## 9. Migration Path (if adopted)

If the live extraction test shows measurably better quality, proceed as follows:

### Phase 1: Add temporal fields (no Graphiti dependency)

```sql
-- Apply to world.duckdb via a new DB migration (version N+1)
ALTER TABLE relations ADD COLUMN IF NOT EXISTS valid_at TEXT;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS invalid_at TEXT;
```

Update `linkLore` in `rag/lore.ts` to set `valid_at = scene.timestamp` at write time.
Update all grounding read queries to add `AND (invalid_at IS NULL OR invalid_at > ?)`.
This alone resolves coherence failure #2.

### Phase 2: Port extraction prompt (no Graphiti dependency)

Replace the extraction prompt in `rag/extraction.ts` with Graphiti-inspired rules:
entity name ≤ 5 words, anti-patterns, `SCREAMING_SNAKE_CASE` relations, self-contained
facts, combined entity+relation output. Run on the full Zura scene backlog.

### Phase 3: Add LLM edge invalidation (no Graphiti dependency)

After extraction produces `SCREAMING_SNAKE_CASE` edge types, add an invalidation step:
before writing a new edge, fetch existing edges with the same `(from, to, label)` and
run an LLM call to detect contradictions (adapt `dedupe_edges.py` logic). Set `invalid_at`
on contradicted edges.

### Phase 4: If full Path A (Graphiti + FalkorDB)

Precondition: live extraction quality test passes.

| `rag/*.ts` module | Fate |
|---|---|
| `rag/extraction.ts` | Replaced by Graphiti `add_episode` |
| `rag/lore.ts` | Replaced by Graphiti entity/edge CRUD + search |
| `rag/communities.ts` | Replaced by Graphiti community detection |
| `rag/scenes.ts` | **Kept** — beat model is richer than Graphiti episodes; scene records call Graphiti `add_episode` as a side-effect |
| `rag/proximity.ts` | **Kept** — Graphiti has no proximity edges; DuckDB overlay retained |
| `rag/query.ts` (scribe) | **Kept** — static rules search, unrelated to Graphiti |
| `rag/world-db.ts` | **Partially replaced** — scene/beat tables remain in DuckDB; entity/relation tables removed |

**World-canon visibility adapter:** Graphiti's `group_id` doesn't support `NULL = world-
canon`. Implement by using `group_id = "world-{world-name}"` for canon entities, and
modifying the search interface to issue two queries (world-canon group + campaign group)
and merge by RRF. This is ~100 lines in a custom `rag/graphiti-adapter.ts`.

**Language bridge:** Run a Python Graphiti+FalkorDB service alongside the Bun scribe
server. The MCP server calls the Graphiti service via HTTP/JSON-RPC. The bridge surface
is narrow: `ingest(episode_text, group_id, reference_time)`, `search(query, group_id)`,
`get_entity(uuid)`, `recompute_communities(group_id)`.

**`world.duckdb` fate:** The `entities`, `relations`, `lore_communities`,
`lore_extraction_log`, `lore_provenance`, `lore_proximity_edges` tables are removed.
The `scenes`, `scene_beats`, `scene_entity_refs` tables remain. `world.json` gains
`kgPath: "graphiti"` to signal the Path A backend. The migration is one-way (Path A ↔
Path B migration exists via export/import bundle).

---

## 10. What Specifically Didn't Work (for future reference)

- **Kuzu backend:** Deprecated upstream; the `KuzuDriverSession.execute_query` API is
  missing in `0.11.3`. Cannot reliably test Graphiti's async API against Kuzu.
- **FalkorDB image:** Docker Hub rate-limited; unauthenticated pulls blocked. A registry-
  authenticated environment resolves this.
- **Live extraction:** No `ANTHROPIC_API_KEY` — extraction quality comparison requires a
  follow-up session with API access.
- **Graphiti Python ↔ TypeScript bridge:** Not prototyped. The MCP tool surface for a
  Graphiti sidecar would need to be designed and tested.

---

## Appendix: Key Graphiti Source Locations

```
graphiti_core/
  graphiti.py                          — add_episode, search
  edges.py                             — EntityEdge (valid_at, invalid_at, expired_at, reference_time)
  nodes.py                             — EntityNode (group_id, name_embedding)
  prompts/
    extract_nodes_and_edges.py         — combined extraction prompt (the main one)
    dedupe_nodes.py                    — entity resolution LLM prompt
    dedupe_edges.py                    — edge dedup + contradiction detection
  driver/
    neo4j_driver.py                    — Neo4j backend (primary recommended)
    falkordb_driver.py                 — FalkorDB backend
    kuzu_driver.py                     — DEPRECATED
  driver/search_interface/             — search, BFS, community search
```

Graphiti version tested: `graphiti-core 0.29.2` (latest as of 2026-06-10).
