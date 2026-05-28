# Knowledge Graph (DRAFT SPEC)

Status: draft. Names what the scribe server's lore/scene/NPC stores
collectively *are*, what they're *for*, and what they're deliberately *not*.
Companion to #166 (unified world DB).

## What we're building

A **narrative knowledge graph**: a typed property graph of in-fiction
entities and relations, with vector embeddings on nodes, hierarchical
community summaries, weighted spatial edges, and an LLM extraction
pipeline that turns recorded scenes into graph deltas.

Closest cousins in the wild:

- **Microsoft GraphRAG** — community detection over an LLM-extracted entity
  graph, Claude-written cluster summaries, hybrid retrieval. We use the same
  Leiden + summarize loop in `rag/communities.ts`.
- **Graphiti** — temporal narrative KG built from agent transcripts. We
  share the extraction-from-prose pattern but defer bi-temporal edges.
- **Neo4j GenAI patterns** — vector-augmented property graph. Same shape;
  we use DuckDB rather than a graph DB.

What it is **not**:

- Not an RDF/OWL knowledge base. No formal ontology, no SPARQL, no
  reasoning engine.
- Not an enterprise KG. No master data management, no canonical Wikidata-
  style IDs across worlds, no schema governance.
- Not a database of facts to be proved. Coherence is a GM-judgment property
  enforced through the canonize ritual and the GM agent's prompt, not a
  logical-consistency property enforced by the schema.

## What the graph is for

The graph exists to answer a small, concrete set of questions during play.
Every schema and feature decision should trace back to one of these.

### Q1. "What do we already know about X?"

Hybrid BM25 + vector search (`search_lore`, `search_lore_global`) over
entities, returning canonical summaries plus connected relations. This is
the **fiction-grounding query** the GM agent runs before introducing or
narrating anything that might already be canon (see fiction grounding
protocol in `ironsworn-gm.md`).

### Q2. "What's near here, geographically or temporally?"

Proximity edges with Dijkstra distance and radius queries
(`proximity_distance`, `proximity_within`). Answers "what places does the
PC pass through if they travel from A to B," "what NPCs were last seen
within N edges of this place," and "what events happened in this region
recently." Weighted, not just adjacent.

### Q3. "What's the cluster shape of the world?"

Community detection + Claude-written summaries (`recompute_communities`).
Answers "what's the gist of the fungal-iron-network material," "what's
the political shape around this faction," at a granularity coarser than
individual entities. The GM agent reads cluster summaries when the
question is about *themes* rather than *facts*.

### Q4. "What do these scenes tell us as a body of evidence?"

Scene embeddings + retrieval (`scenes` table after #166). Scenes are the
raw narrative record; the graph is the distilled abstraction. We need both:
the abstraction for context discipline, the raw for fidelity when the GM
needs to recall a specific moment.

### Q5. "What's true in this world, regardless of campaign?"

After #166, the `campaign_id IS NULL` filter. World canon as a queryable
slice. This is the question that motivates the unified-DB architecture —
the graph has to express it without an export pipeline.

### Q6. "Does this name already refer to something?"

Alias-aware entity resolution (`resolveId`). Prevents the graph from
filling with near-duplicates ("Lona" / "the healer Lona" / "Lona of
Caldren"). Backed by embedding similarity plus an explicit `aliases`
metadata field.

These six questions exhaust the design pressure on the graph. Anything not
required by Q1–Q6 is speculative and should be pushed back to a future
issue.

## Schema (after #166)

The schema collapses the current three stores (`lore.duckdb`,
`scenes.duckdb`, `npcs/*.json`) into one world DB. See #166 for the full
migration. Core shape:

```sql
entities(
  id UUID, type ENUM, name TEXT, summary TEXT,
  campaign_id TEXT,            -- NULL = world canon
  created_in_campaign TEXT,
  metadata JSON, embedding FLOAT[768]
)

relations(
  from_entity UUID, to_entity UUID, label TEXT,
  campaign_id TEXT, metadata JSON
)

scenes(
  id UUID, campaign_id TEXT NOT NULL,
  place_entity UUID,
  summary TEXT, beats JSON, embedding FLOAT[768],
  occurred_at TIMESTAMP
)

scene_entity_refs(scene_id UUID, entity_id UUID, role TEXT)
```

The `type` enum is the closest thing we have to an ontology:
`place | person | faction | material | concept | creature | event | truth | thread`.
Free-form relation labels with a "prefer these or close variants" nudge
in the extraction prompt. We chose this over a constrained relation
vocabulary because narrative content resists fixed taxonomies; the cost is
some drift, mitigated by occasional GM curation rather than schema rules.

## What we are deliberately not building

### No ontology / no relation-type schema

Relation labels are free text. We considered OWL-style class hierarchies
and SHACL-style constraints; the storytelling cost is too high. The graph
must accept "sworn-on," "bound-by," and "kept-faith-with" as related but
distinct, not collapse them into a normalized predicate.

**Revisit if:** relation-label drift makes Q1 retrieval noisy enough that
the GM stops trusting `search_lore` results.

### No reasoning engine

The graph does not infer new facts. If A `parent-of` B and B `parent-of` C,
the graph does not produce A `grandparent-of` C. The GM agent can read both
edges and reach the conclusion in prose; that's the right place for
narrative inference.

**Revisit if:** ever. This is a setting-fiction system, not a logic
database.

### No bi-temporal validity windows

Relations do not carry `valid_from / valid_until`. A king who is deposed
gets a new relation (`deposed-by`) and the GM judges from the relation's
provenance which version is current. Graphiti does this properly; we
defer until NPC churn forces it. See #55's "non-goals."

**Revisit if:** NPC state churn (deaths, role changes, faction shifts)
makes the GM context regularly misrepresent the current state of a
relation. Symptom: the GM agent narrates an NPC as alive who has died.

### No cross-world entity references

Worlds are isolated DBs. The "Magistrate" entity in the Zura world has no
identity relationship to a similarly-named entity in another world. We
considered a global identifier layer; it solves a problem nobody has yet.

**Revisit if:** multi-setting campaigns become a real use case.

### No formal disambiguation via canonical IDs

Aliases plus embedding similarity is what we have. Wikidata-style external
IDs (Q-numbers) are not used. The graph is closed-world; what's in it is
what's true, and reconciliation against external knowledge bases is out of
scope.

**Revisit if:** never expected.

## Where coherence actually lives

The graph's schema does not enforce world-coherence. Three softer
mechanisms do:

1. **GM agent prompt + fiction grounding protocol.** The GM agent is
   instructed to call `search_lore` / `get_npc` / `search_lore_global`
   before narrating anything that might be canon. Coherence is enforced by
   *not making things up that contradict the graph*.
2. **The canonize ritual.** After #166, promoting an entity to world canon
   (`campaign_id = NULL`) is an explicit GM act, not automatic. This is
   where "is this really a stable truth about the world" gets adjudicated.
   The graph holds whatever's claimed; the ritual decides what's blessed.
3. **Community summaries as semantic checkpoints.** When clusters get
   resummarized, internally inconsistent clusters produce visibly bad
   summaries. That's the canary for graph drift, not a constraint
   violation.

Naming this explicitly matters because future feature pressure ("can we
add a constraint that prevents X?") will be tempting and almost always
wrong. The schema's job is to *store claims with provenance*; the GM's job
is to *decide which claims hold*; the canonize ritual is *the interface
between the two*.

## Decisions (settled)

- **D1** Property graph, not RDF. Free-form relation labels.
- **D2** Vector embeddings on entity nodes; hybrid BM25 + vector + RRF
  retrieval. No vector index on relations.
- **D3** GraphRAG-style community detection (Leiden + Claude summaries),
  not bespoke clustering.
- **D4** One world DB, campaign as a column (per #166). Visibility filter
  on every read.
- **D5** No bi-temporal validity. Deferred until forced by symptom.
- **D6** No reasoning engine. Inference is the GM agent's job.
- **D7** Coherence enforced by ritual (canonize) + prompt (fiction
  grounding), not by schema constraints.

## Open questions

- **OQ1** Should relation labels have a soft controlled vocabulary
  surfaced in the extraction prompt (today: free-form with examples)?
  Tracked informally; revisit after Q1 retrieval quality is evaluated on
  more campaigns.
- **OQ2** Do we need an explicit "supersedes" relation between entities
  (the new Magistrate supersedes the deposed one) as a lighter alternative
  to bi-temporal edges? Cheap to add; defer until a real case forces it.
- **OQ3** How does the canonize ritual surface in the UI/agent workflow?
  Slash command, end-of-session prompt, or implicit on extraction-with-
  high-confidence? Probably explicit slash command; settle when
  implementing #166.
