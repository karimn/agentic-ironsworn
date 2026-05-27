# Agentic RPG v1.0 — Design Spec

Status: design spec. Replaces ad-hoc evolution from v0.x. Companion to
#166 (unified world DB) and `knowledge-graph.md` (KG framing). This is
the architectural target; migration from v0.x is tracked separately.

## What we're building

An agentic RPG companion that runs as a Claude Code MCP server and lets a
player run solo or co-GMed tabletop sessions with an LLM as the GM. The
agent maintains a coherent, queryable world across long-running and
parallel campaigns, supports multiple game systems, and persists craft
knowledge about how to play well.

The product surface is the GM agent. Everything else exists to give the
agent: clean fiction grounding (the KG), correct mechanics (the rules
engine), and reliable craft (skills + protocols).

## Goals

- Run as a Claude Code MCP server; no external service hard-required
- Solo or co-GMed play; persistent state across sessions
- One **world** can host multiple **campaigns**; world canon survives
  campaign boundaries (#166)
- **Game-system-agnostic core.** Ironsworn ships first; the architecture
  permits Cairn, Mausritter, Mythic GME, homebrew, etc.
- Coherent fiction: every retrieval the GM agent makes is grounded in
  recorded canon, never invented
- Portability: a world can be exported, shared, and resumed elsewhere

## Non-goals

- Multiplayer / synchronous play
- VTT integration, maps, tactical positioning
- Asset generation (images, audio)
- Closed-form replay of pre-written modules
- Mixing game systems within a single world

## The central insight from v0.x

Not all "knowledge the agent retrieves" is the same kind of thing. We
spent v0.x conflating three distinct kinds; v1.0 separates them.

### Three kinds of knowledge, three stores

**Game-system knowledge — static, authored, shipped with the system.**
Rules (dice, moves, progress tracks, momentum), data (moves, oracles,
assets), system canon (the official Ironlands setting for Ironsworn).
Lives in TS code + YAML data files, distributed via the game-system
module. Retrieved by typed direct lookup, never by similarity.

**Craft knowledge — static, authored, shipped with the GM tool.**
How to frame scenes, voice NPCs, pace montages, ground fiction in
setting before invention. Lives as Claude Code skills (markdown +
references), loaded by CC on activation. Retrieved by skill trigger, not
by RAG.

**World knowledge — dynamic, emergent, unique per world.**
Entities (people, places, factions, materials, concepts, events,
truths), relations between them, scenes, threads. Accumulates through
play. Lives in the knowledge graph. Retrieved by hybrid BM25 + vector +
graph traversal.

**Only the third kind belongs in the KG.** The retrieval loop — search,
disambiguate, ground, narrate — is what justifies the KG's complexity
(extraction prompts, community summaries, canonize ritual, visibility
filter). Rules don't need retrieval; they're always in context. Craft
doesn't need retrieval; CC activates whole skills wholesale. Putting
them in the KG would pay the cost of dynamic-store discipline for
content that's static.

### The bridge: system canon as world seed

Game systems often ship official setting (Ironsworn ships the Ironlands;
Mörk Borg ships the Dying Lands). This is *static at the system level*
but *world canon for any campaign in that system*.

Resolution: the game-system module declares an optional `systemCanon`
seed. At world-init time, the seed is loaded into the world DB as
`campaign_id IS NULL` entries. From that moment on, it's world
knowledge, governed by the same rules as emergent canon — including the
ability for a campaign to extend, contradict (per GM blessing), or
canonize new claims around it. The seed is the starting condition; the
world owns it from then on.

## Architecture

```
core/                          # game-system-agnostic
  scribe-server/               # MCP server, agent runtime, expansion loader
  kg/                          # knowledge graph integration
  state/                       # character state shell, journal, migrations
  agent/                       # GM agent prompt, fiction-grounding protocol

modules/
  game-system-ironsworn/       # Ironsworn rules, data, system canon seed
  game-system-cairn/           # (future)
  craft-default/               # default fiction-crafting skills
  craft-ironsworn/             # (optional) Ironsworn-flavored craft tweaks

expansions/
  ironsworn-delve/             # extends ironsworn
```

The core knows about MCP, the agent, the KG, and the campaign state
shell. It does not know what game system is in play; the game-system
module declares that. A world picks one game system at init.

## The KG layer — two paths, one spike to decide

(Per the architecture conversation; the start-from-scratch design.)

**Path A — Graphiti + FalkorDB.** Use Graphiti for the entire KG: typed
graph, bi-temporal edges, alias resolution, GraphRAG community
detection, hybrid retrieval. FalkorDB (a Redis-module graph DB) is the
backend; one local container per world. Sharing is bundle export, not
git clone.

**Path B — Embedded SQLite + sqlite-vec.** One file per world,
git-portable. We own the KG code, carrying forward the v0.x design with
#166 unification. Sharing is `git clone`. Lower install friction; we
own all the KG complexity.

Both paths satisfy v1.0's requirements. The decision is operational:
how much install friction is acceptable vs. how much KG code is worth
owning. **A time-boxed spike (tracked in a separate issue) feeds the
Zura corpus into Graphiti and compares retrieval quality and dev
ergonomics against the existing v0.x implementation.** Default
recommendation pending the spike: Path A, because Graphiti already
ships features (bi-temporal, alias resolution, group-id partitioning)
that we'd otherwise reinvent.

Whichever path: the **schema and visibility model are identical**, and
the rest of this doc is path-agnostic.

## World DB design (per #166)

- One world DB per world (one file in Path B; one container volume in
  Path A).
- All entities, relations, and scenes in one store. NPCs collapse into
  `entities` with `type='person'`. Threads collapse into `entities`
  with `type='thread'`.
- `campaign_id` (Path B) / `group_id` (Path A's Graphiti) as the
  partition column; NULL = world canon, visible to all campaigns.
- **Visibility filter on every read**: `campaign_id IS NULL OR campaign_id = current`.
- **Promotion to canon is one column flip** — no export pipeline.
- Scenes are always campaign-owned; they reference a shared `place_entity`
  so two campaigns can record different scenes at the same location with
  shared geometry (proximity edges, place metadata).

## Game-system module contract

A game-system module declares itself via manifest:

```jsonc
{
  "name": "ironsworn",
  "version": "1.0.0",
  "coreCompat": ">=1.0.0",
  "schemaVersion": 1,
  "contributes": {
    "rules":           "./rules",                  // pure TS, typed
    "data":            ["moves", "oracles", "assets"],
    "tools":           "./mcp-tools",              // game-specific MCP tools
    "characterShape":  "./character.schema.json",  // validates character.json
    "systemCanon":     "./seed/world.canon.json",  // optional setting seed
    "contextSections": ["./context/state.ts"],     // GM context injection
    "agentBriefing":   "./agent-briefing.md"       // appended to GM prompt
  }
}
```

The core uses these to:

- Validate `character.json` against the system's schema; run system-
  specific character migrations
- Register system MCP tools (`roll_move`, `endure_stress`, etc.) into
  the scribe namespace
- Inject `contextSections` output into the GM context build
- Append `agentBriefing` to the GM system prompt
- Load `systemCanon` into a fresh world DB as `campaign_id IS NULL`
  entities at world-init time

Other systems implement the same contract. The KG, the MCP plumbing,
the agent runtime, and the campaign state shell stay system-agnostic.

## Craft module

System-agnostic by default. The `craft-default` module ships skills for
scene framing, NPC voice, pacing, and the fiction-grounding protocol.
A system can ship an optional `craft-<system>` module that stacks
additively (system-flavored examples, system-specific cues), but the
default craft set is system-independent.

Craft skills reference KG tools by generic names (`recall`,
`search_lore`, `get_entity`) — never by system-specific tool names.
This is what makes the craft layer reusable across systems.

## Tool surface

Per "one tool per query pattern, not per concept" (start-from-scratch).

**KG tools (system-agnostic, in core):**

- `recall(query, kind?, near?, limit?)` — subsumes v0.x
  `search_lore` / `get_npc` / `get_thread` / `search_scenes`
- `record_scene(summary, beats, place_entity, refs)`
- `upsert_entity(kind, name, summary, metadata)` — replaces v0.x
  `upsert_npc` / `upsert_lore`
- `link(from, to, label, metadata?)` — replaces v0.x `link_lore`
- `canonize(entity_id)` / `decanonize(entity_id, into_campaign)`
- `extract_session_lore()` — batch extraction from recent scenes

**Game-system tools (registered by the system module):**

- For Ironsworn: `roll_move`, `take_momentum`, `endure_stress`,
  `progress_track`, `forsake_vow`, etc.

**Retrieval budget:** every read tool declares a max return size. The
typed schema enforces it at the tool boundary, not as advisory in the
description.

## GM context build

Per-session-turn context, layered from cheapest to most retrieval-
expensive:

| Layer | Source | Budget |
|---|---|---|
| World axioms | `world.json` | ~200 tokens |
| Game system briefing | system module's `agentBriefing` | ~500 |
| Active campaign state summary | core, from `character.json` + state journal | ~600 |
| System context sections | system module's `contextSections` | ~800 |
| Recent scenes summary (≤10) | KG | ~1500 |
| Recently referenced entities (≤20) | KG | ~1500 |
| Active threads (≤5) | KG | ~400 |
| Relevant community summaries (0–3) | KG | ~600 |

Total budget target: ~6k tokens. The GM agent pulls more on demand via
`recall(...)`. This is the discipline that makes long campaigns work.

## Campaign state shell

System-agnostic, file-based (still — small data, git-friendly diffs):

```
worlds/<world>/
  world.json              # game system, name, axioms, tone, schema version
  world.db / world.bundle # the KG (file in Path B, container volume in Path A)
  campaigns/
    <campaign>/
      campaign.json       # campaign id, name, system, schema versions
      character.json      # character state (shape from game-system module)
      state-journal.jsonl # append-only audit log of mutations
```

Why not put `character.json` in the KG? Character state isn't world
knowledge — it's the player's mechanical position in the game. It
doesn't need retrieval; it needs to be loaded fresh and modified atomically
every turn. Putting it in the KG would pay the cost of graph storage for
a 2KB document that's read in full every turn anyway.

## Expansion system (carried forward)

Expansions extend a game system. They contribute moves, oracles, assets,
MCP tools, DB migrations, context sections, and skills. The existing
v0.x expansion design (Delve as a CC plugin loaded into the scribe
namespace) carries forward unchanged in spirit. Adjustments:

- Expansions declare which game system they extend (`extends: "ironsworn"`)
- Core refuses to load expansions whose `extends` doesn't match the
  active world's game system
- Migration namespacing extends from system + expansion (Path B) /
  Graphiti group-id scoping (Path A)

See `docs/design/expansion-system.md`.

## The fiction-grounding protocol

Lives in the craft module as a skill. The GM agent must, before
introducing or narrating anything that might be canon, call:

1. `recall(query=<entity-or-concept>, kind?, limit=5)` — does this exist?
2. If multiple matches → disambiguate via aliases, then continue
3. If no match → free to invent, then `upsert_entity(...)` after the
   scene resolves
4. If match → narrate consistent with the recorded summary + relations

This is the single biggest contributor to long-campaign coherence. It's
craft, not mechanics; it lives with skills, not the rules engine.

## What the KG does NOT hold (the explicit boundary)

- Rules data (moves, oracles, assets) — lives in the game-system module
- Craft skills — lives in the craft module
- Character state — lives in `character.json`
- Game-system mechanical facts ("Ironsworn uses 2d10 challenge dice")
  — lives in the system briefing
- Session UI / chat history — Claude Code handles this

The KG holds the setting and the narrative record of what happened in
it. Everything else is elsewhere by design.

## Migration from v0.x

Tracked separately. Major pieces:

1. Refactor the codebase into `core/` + `modules/game-system-ironsworn/`
2. Resolve #166: unify lore.duckdb + scenes.duckdb + npcs/*.json into
   one world DB; introduce `campaign_id` column
3. Implement the Path A vs Path B spike; commit to one
4. Implement the system-canon seed mechanism; ship Ironsworn's seed
5. Move existing skills into a `craft-default` module; verify they don't
   leak system-specific tool names
6. Implement `recall` as the unified retrieval tool; deprecate the v0.x
   split
7. Add per-tool retrieval budgets; tune
8. Implement the canonize slash command; integrate with `extract_session_lore`

## Decisions (settled)

- **D1** Three knowledge stores, not one: game-system, craft, world.
  Only the world is the KG.
- **D2** System canon seeds the world DB at world-init; from then on
  it's just world knowledge.
- **D3** One world DB, campaign as a column (#166). Visibility filter on
  every read. Canon promotion is one column flip.
- **D4** Game-system-agnostic core. Modules declare rules, data,
  character shape, and optional canon seed.
- **D5** Craft is system-agnostic by default. Optional system-flavored
  craft modules stack additively.
- **D6** Tool surface: one tool per query pattern (`recall`, not
  six search tools). Per-tool retrieval budgets enforced at boundary.
- **D7** Character state stays on disk as `character.json`, not in the
  KG.
- **D8** Path A (Graphiti + FalkorDB) vs Path B (SQLite + sqlite-vec)
  decided by spike, not by argument. Default lean: Path A.

## Open questions

- **OQ1** Spike outcome (Path A vs Path B) — decides storage backend.
- **OQ2** Should `world.json` itself live in the KG as a single
  `type='world'` entity? Cleaner uniformity, but adds a special case to
  the visibility filter. Default: stays as a file. Revisit if it accumulates
  enough properties to feel awkward as JSON.
- **OQ3** Cross-world canon (e.g., a shared "fantasy commons" of
  generic tropes some players want pre-loaded). Skipped for v1.0.
  Worlds are isolated.
- **OQ4** Multi-character campaigns (one party, multiple PCs). Adjacent
  to v1.0 but not required — character state shape would need to be
  pluralized. Tracked separately if pursued.
- **OQ5** A canonize ritual UX: slash command, end-of-session prompt,
  or implicit on high-confidence extraction. Probably explicit slash
  command. Settle when implementing.

## Why this is v1.0

v0.x evolved by accretion: each feature was added without challenging
whether it belonged in the layer that grew it. By v0.18 we had three
parallel stores, system-specific names baked into shared retrieval
tools, and ambiguity about whether GraphRAG community detection was
fundamental or speculative.

v1.0 is the version where the system can answer:
- "What does this layer know?" (clean three-way split)
- "How do I run this game system?" (the manifest)
- "What carries to a new campaign?" (the visibility filter)
- "Where does the agent get its craft?" (the craft module)

It's also the version where adding Cairn or Mausritter is a
manifest-and-data exercise, not a fork.
