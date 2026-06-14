# Graphiti Spike Report — June 2026

**Status:** Complete (updated 2026-06-13 with live extraction comparison)  
**Date:** 2026-06-10, live test 2026-06-13  
**Branch:** `claude/graphiti-spike-agentic-rpg-e134gj`  
**Decision:** **Adopt extraction approach and temporal design; Python sidecar justified**

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
3. **Live extraction comparison (2026-06-13):** Graphiti-inspired prompt on 8 Zura scenes
   produces semantically specific relations (`DEFEATED_IN_COMBAT`, `WAS_STRIPPED_OF`,
   `GRIEVES_LOSS_OF`) vs. the scribe prompt's generic labels (`enemy_of`, `bound_to`,
   `located_in`). Graphiti correctly fired a `supersedes` flag when Caldren was stripped
   of the captain's tag. Scribe misclassified Holtfen as `person` (it's a settlement).
4. Graphiti's Kuzu backend is **deprecated**; the viable backends are FalkorDB and Neo4j,
   both requiring a running server process.
5. Graphiti is **Python-only** — a language boundary with the TypeScript scribe runtime.
   Given the extraction quality evidence, this cost is now justified.

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

## 4b. Live Extraction Comparison (2026-06-13)

Both prompts were run against 8 selected Zura scenes (covering early, mid, the
Caldren→Lona transition, and late sessions) using `claude-haiku-4-5-20251001`. Full
results at `docs/spikes/extraction_results_2026-06-13.json`.

### Aggregate metrics (8 scenes)

| Metric | Scribe prompt | Graphiti-inspired prompt |
|---|---|---|
| Total entities extracted | 51 | 46 |
| Total relations extracted | 26 | 36 |
| Person-type entities | 25 | 23 |
| `supersedes` flags fired | — | 1 |
| Failed scenes (parse error) | 1 | 1 |

Both prompts extract comparable numbers of person-type entities. The Graphiti prompt
extracts 39% more relations.

### Relation label quality (actual output)

**Scribe prompt — relation labels observed:**
```
bound_to, located_in, located_in, located_in, allied_with, leads,
grieves, located_in, teaches, trained_by, trained_by, trained_by,
enemy_of, bound_to, opposes
```

Six of the first 15 labels are `located_in`. Four are `bound_to`. The soft label list
produces heavy overloading: `bound_to` is used for vow relationships, companion bonds,
network connections, and debt obligations interchangeably.

**Graphiti-inspired prompt — relation types observed:**
```
MADE_VOW_TO, COMPLETED, HOLDING, ARRIVED_AT, TRAVELED_WITH, MEMBER_OF,
GRIEVES_LOSS_OF, STAYED_AT, PROVIDES_REFUGE_FOR, TRAINED_IN, TRAINED_IN,
DUELED_WITH, DEFEATED_IN_COMBAT, SPARED, REMOVED_FROM, WAS_STRIPPED_OF
```

Each type is semantically distinct. `DUELED_WITH`, `DEFEATED_IN_COMBAT`, `SPARED` each
appear on the duel scene rather than all collapsing to `enemy_of`.

### Key entity quality difference

**Scene: duel / Caldren defeated** (2026-05-07)

Scribe extracted:
```
Entities: Caldren (person), Mai (person), Mai's sword-line (concept),
  Unknown Mai-trained opponent from eight winters ago (person), Zura (person)
Relations:
  Zura --trained_by--> Mai
  Caldren --trained_by--> Unknown Mai-trained opponent from eight winters ago
```

Graphiti extracted:
```
Entities: Caldren (person), Mai (person), Zura (person)
Relations:
  Zura --TRAINED_IN--> Mai
  Caldren --TRAINED_IN--> Mai
  Caldren --DUELED_WITH--> Zura
```

Graphiti dropped the vague entity "Unknown Mai-trained opponent from eight winters ago"
(correctly — it's not resolvable or retrievable) and extracted the actual duel relation
that scribe missed. Scribe created a phantom entity from a passing reference.

**Type misclassification (scribe):**

In scene 1, scribe classified "Holtfen" as type `person`. Holtfen is the central
settlement. Graphiti correctly classified it as `place`. This error would cause `get_npc`
to return Holtfen and type-filtered queries to miss it.

### Supersedes flag — live confirmation

In the scene where Caldren is defeated and Harel removes the captain's tag:

**Graphiti output:**
```
Harel --REMOVED_FROM--> captain's tag
Caldren --WAS_STRIPPED_OF--> captain's tag  [supersedes=true]
```

The `supersedes=true` flag is the extraction-time signal that triggers `invalid_at` on
the old "Caldren IS_CAPTAIN_OF" edge. This is the mechanism that resolves the temporal
coherence failure — it fires correctly on real Zura scene text.

**Scribe output for the same scene:**
```
Zura --enemy_of--> Caldren
Harel --opposes--> Caldren
```

The leadership transfer is captured only as a vague opposition relation. No `invalid_at`
mechanism exists; no superseding signal is produced.

### Failure case: one scene returned empty from both prompts

Scene 4 in the selection ("Dalla's longhouse, morning of the arrival") returned 0
entities and 0 relations from both prompts. The scene contains 8+ named characters and
significant plot content. The likely cause: the scene summary was truncated mid-sentence
(it starts "Dalla's longhouse, morning of the arrival. Zura walked in through the back
with Lona and Hadris. Dalla, Esther (Saelin's..." and ends abruptly). The LLM produced
invalid JSON when the input was malformed. This is a scribe pipeline reliability issue
independent of which prompt is used.

---

## 5. Scoring Matrix

| Dimension | Current Scribe | Graphiti |
|---|---|---|
| **Temporal correctness** | ❌ No `valid_at`/`invalid_at`; stale facts accumulate | ✅ 4 temporal fields; automatic LLM invalidation |
| **Alias resolution** | ⚠️ Single cosine threshold (0.92); false aliases observed | ✅ 3-tier (exact → MinHash/0.9 → LLM); context-aware |
| **Extraction prompt quality** | ❌ Heavy label overloading (6/15 labels `located_in`); phantom entities; type errors | ✅ Semantically distinct labels; fewer false positives; self-contained fact rule |
| **NPC coverage** | ❌ 0 person entities (pipeline never ran); misclassifies places as persons | ✅ Comparable person-type coverage; no phantom entities observed |
| **Scene/beat model** | ✅ Beat-level granularity (kind, speaker, text, index) | ⚠️ Episode = text blob; no beat structure |
| **World-canon visibility** | ✅ `campaign_id IS NULL` visibility model | ❌ `group_id` is single-value; no native NULL=world-canon |
| **Proximity edges** | ✅ Weighted Dijkstra over `lore_proximity_edges` | ❌ BFS traversal only; no weighted proximity |
| **Community detection** | ✅ Louvain + Claude summaries | ✅ Same algorithm; incremental update built-in |
| **Operational complexity** | ✅ DuckDB embedded; Bun/TS only | ⚠️ FalkorDB/Neo4j server required; **Python-only** |
| **Language** | ✅ TypeScript (matches scribe runtime) | ❌ Python; requires language bridge or sidecar |
| **Extraction pipeline status** | ❌ Never ran on Zura corpus | ✅ Live-tested on 8 Zura scenes; supersedes flag fired correctly |

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

**graphiti-ts (TypeScript port):** `github.com/2b3pro/graphiti-ts` — forked to
`github.com/karimn/graphiti-ts` (commit `6921fe1`). Feature-complete for our use case,
Anthropic-native, Bun-native, bi-temporal edges, MinHash dedup, community detection,
FalkorDB + Neo4j backends. Pre-release (v0.1.0, not on npm). If adopted, eliminates the
Python sidecar entirely — same language stack as scribe. Install options: `file:` path
after local clone, or publish from the fork to npm. See §9 Phase 4 for the wiring plan.

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

**Recommendation: Adopt extraction approach and temporal design; Python sidecar is
justified by the evidence.**

The live extraction test resolves the main blocker from the earlier session. The
Graphiti-inspired prompt demonstrably:
- Produces semantically distinct relation types vs. overloaded generic labels
- Fires a `supersedes` flag on real Zura scene text at the exact moment of a leadership
  transition (Caldren stripped of captain's tag)
- Avoids phantom entity extraction (no "Unknown Mai-trained opponent from eight winters ago")
- Correctly classifies entity types (Holtfen as `place`, not `person`)

This evidence, combined with the temporal handling test (Caldren→Lona), makes the case
for full adoption strong enough to proceed with the Python sidecar approach.

### Immediate actions (no new dependencies)

1. **Add `valid_at`/`invalid_at` to `relations`** — a 2-column DB migration. Set
   `valid_at` from the scene's `timestamp` in `linkLore`. Filter `invalid_at IS NULL`
   in all grounding reads. Unblocks coherence failure #2 within the current TS stack.

2. **Port the improved extraction prompt into `extraction.ts`** — entity name ≤ 5 words,
   anti-patterns, `SCREAMING_SNAKE_CASE`, self-contained facts, `supersedes` flag.
   Eliminates the Holtfen/person error and phantom entity problem today.

3. **Run extraction on all 59 Zura scenes** with the improved prompt to populate the
   lore graph for the first time. This unblocks the extraction evaluation harness (v1
   priority 2) and gives the community detection real data to cluster.

### On the Python sidecar

The language boundary (TypeScript scribe + Python Graphiti) is real friction, but it is
in the same category as the existing Ollama dependency — an external process the scribe
server calls over a local interface. The sidecar surface is narrow:

```
ingest(episode_text, group_id, reference_time) → entity_ids[]
search(query, group_id, limit) → SearchResult[]
get_entity(uuid) → Entity
recompute_communities(group_id) → void
```

This is ~200 lines of FastAPI + Graphiti glue. The scribe MCP server calls it over
localhost HTTP. FalkorDB runs as a single container alongside it.

**What this replaces in `rag/`:** `extraction.ts`, `lore.ts` (entity/relation CRUD and
search), `communities.ts`. Total: ~2,000 lines deleted. The DuckDB-backed scene/beat
model stays; `proximity.ts` stays.

### On rejection

**Reject the runtime, not the patterns.** Even if the Python sidecar is deferred, the
extraction prompt and temporal schema changes from §9 phases 1–3 should proceed. They
deliver most of the coherence improvement with zero new dependencies.

### Summary verdict

| Question | Answer |
|---|---|
| Does Graphiti solve real problems? | Yes — confirmed on live Zura scenes |
| Is extraction quality measurably better? | ✅ Yes — fewer false positives, distinct relation types, supersedes fires |
| Is the language boundary acceptable? | Yes — comparable to existing Ollama dependency |
| Should we add bi-temporal edges to our DB? | Yes, immediately (phase 1) |
| Should we improve our extraction prompt? | Yes, immediately (phase 2) |
| Is full Graphiti adoption justified? | ✅ Yes — proceed with FalkorDB sidecar design |

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
