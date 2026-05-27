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
assets). Lives in TS code + YAML data files, distributed via the
game-system module. Retrieved by typed direct lookup, never by
similarity. Note: setting canon (the Ironlands as content) is a
*separate* layer — see the four levels of modularity below.

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

### The bridge: setting as world seed

Settings (the Ironlands, The Forge, a player's homebrew "Zura") are
*static at the setting-package level* but *world canon for any campaign
in a world seeded with that setting*. Two players each starting a fresh
Ironlands world get the same starting canon; from then on their worlds
diverge.

Resolution: a setting module declares its canon as a portable seed
manifest. At world-init time, the seed is loaded into the world DB as
`campaign_id IS NULL` entries. From that moment on, it's world
knowledge, governed by the same rules as emergent canon — including the
ability for a campaign to extend, contradict (per GM blessing), or
canonize new claims around it. The seed is the starting condition; the
world owns it from then on. Re-publishing the setting later does not
retroactively change existing worlds.

This is also the **publish-your-world-as-a-setting** pathway: filter a
mature world DB to `campaign_id IS NULL` entities and relations, strip
PC/party-specific overlay state, package the result as a setting
module. The Zura world that grew from one campaign becomes a setting
others can seed new worlds from.

## Four levels of modularity

v1.0 separates four concerns that v0.x conflated. Each is independently
authored, distributed, and licensed:

| Level | What it is | Examples | Distribution |
|---|---|---|---|
| **Game system** | Rules: dice, moves, oracles, assets, mechanics | Ironsworn, Starforged, Trophy Gold, Cairn | One package per system; public or private |
| **Setting** | Canon seed: a starting world the GM can pour into a fresh DB | Ironlands, The Forge, the player's homebrew "Zura" | One package per setting; declares compatible systems |
| **World** | A persistent KG instance — what setting + play actually produced | "my Zura playthrough", a friend's Ironlands campaign | One DB per world; player-owned |
| **Campaign** | One party's slice of a world's history | "Zura's Saga", "a new sandbox in Zura" | A row partition (`campaign_id`) within a world |

This is the central modularity shape:

- **Systems are reusable across settings.** Ironsworn rules can drive
  the Ironlands setting, a homebrew "Fungal Iron" setting, or no setting
  at all.
- **Settings are reusable across worlds.** Two players both starting
  an Ironlands campaign each get a fresh world DB seeded from the same
  Ironlands setting package. Their worlds diverge from there.
- **Worlds host multiple campaigns.** Per #166, one world DB,
  partitioned by `campaign_id`. World canon survives campaign
  boundaries.

A world declares both its system and its setting at init:

```jsonc
{
  "name": "Zura",
  "system":  "ironsworn@1.0.0",
  "setting": "ironlands@1.0.0",    // or "homebrew-zura@0.3.0", or null
  "schemaVersion": 1
}
```

`setting: null` is a valid choice — a fully emergent world with no
canon seed. Everything grows from play.

## Architecture

```
core/                            # game-system-agnostic
  scribe-server/                 # MCP server, agent runtime, expansion loader
  kg/                            # knowledge graph integration
  state/                         # character state shell, journal, migrations
  agent/                         # GM agent prompt, fiction-grounding protocol

modules/
  game-system-ironsworn/         # rules only — no setting
  game-system-starforged/        # (future, paid)
  game-system-trophy-gold/       # (future)

  setting-ironlands/             # the official Ironsworn setting, ships with Ironsworn
  setting-forge/                 # (future, paid) — for Starforged
  setting-zura/                  # (example) a player-published homebrew

  craft-default/                 # default fiction-crafting skills (system-agnostic)
  craft-ironsworn/               # (optional) Ironsworn-flavored craft tweaks

expansions/
  ironsworn-delve/               # extends a game system (Ironsworn here)
```

The core knows about MCP, the agent, the KG, and the campaign state
shell. It does not know what system or setting is in play; the
respective modules declare that. A world picks one system + zero-or-one
setting at init.

## Distribution and packaging mechanics

The four conceptual modularity levels (system, setting, world, campaign)
are independent from the three distribution mechanisms used to ship
them. The mechanisms compose orthogonally — a single shippable
piece of content is described by *which conceptual level it sits at*
**and** *how each of the three mechanisms is used for it*.

### Three distribution mechanisms

**TS / Bun packages.** Each conceptual module is one TS package. Some
ship code (the game system has TS rules + MCP tools), some ship data
only (a setting is a JSON canon seed with no code), some ship a mix
(an expansion has both). The public monorepo (this repo) uses Bun
workspaces to bundle several packages in one tree. Private packages
live in their own repos and consume the core's public types via npm or
direct path reference.

**Repos.** Where the source lives. The public repo holds the core, the
default game system (Ironsworn — CC-BY), the default setting (Ironlands
— CC-BY), and the default craft module. Anything paid or otherwise
proprietary lives in its own private repo: paid game systems, paid
settings, paid expansions, paid craft modules. Player-published worlds
become their own repos (or downloadable bundles) at publish time.

**Claude Code plugins.** What CC sees and installs. Every shippable
module is its own CC plugin with its own `.claude-plugin/plugin.json`,
its own version, its own install/update lifecycle. Discovery follows
the existing v0.x pattern: the core scribe server reads
`~/.claude/plugins/installed_plugins.json`, finds plugins matching
`agentic-rpg-{system|setting|expansion|craft}-*`, and loads each via
its manifest. Naming convention:

| Conceptual level | CC plugin name pattern |
|---|---|
| Game system | `agentic-rpg-system-<name>` (e.g., `agentic-rpg-system-ironsworn`) |
| Setting | `agentic-rpg-setting-<name>` (e.g., `agentic-rpg-setting-ironlands`) |
| Craft | `agentic-rpg-craft-<name>` (e.g., `agentic-rpg-craft-default`) |
| Expansion | `agentic-rpg-expansion-<system>-<name>` (e.g., `agentic-rpg-expansion-ironsworn-delve`) |

### How the three mechanisms compose

A worked example — a player running Starforged in the official Forge
setting, with the Sundered Isles expansion, plus default craft, on the
public core:

| Conceptual piece | Repo | TS package | CC plugin | License |
|---|---|---|---|---|
| Core | this repo (public) | `packages/core` | `agentic-rpg-core` | open |
| System | private (Shawn Tomkin / IronSpike) | own package | `agentic-rpg-system-starforged` | paid |
| Setting | private (same publisher) | data-only package | `agentic-rpg-setting-forge` | paid |
| Expansion | private | own package | `agentic-rpg-expansion-starforged-sundered-isles` | paid |
| Craft | this repo (public) | `packages/craft-default` | `agentic-rpg-craft-default` | open |

Five conceptual pieces, three repos, five TS packages, five CC plugins,
two distinct license terms. The mechanisms cover the variance
independently:

- **Conceptual level** says *what role the piece plays in the system.*
- **Repo** says *who controls the source and IP.*
- **TS package** says *how the code is organized for the loader.*
- **CC plugin** says *what the player installs and the lifecycle CC
  enforces.*

### Cross-module versioning

Every CC plugin versions independently. The compatibility surface is
declared in each manifest:

- A game system declares `coreCompat: ">=1.0.0"`.
- A setting declares `systemCompat: { "ironsworn": ">=1.0.0" }` —
  often pinned to one system, occasionally to several.
- An expansion declares `extends: "ironsworn"` and a version range
  against the system.
- A craft module declares `coreCompat` and optionally `systemHint:
  "ironsworn"` if it's system-flavored.

The loader refuses to activate a module whose compatibility doesn't
match the active world's system + core. Errors are logged to stderr;
the module is treated as inert (graceful absence — same pattern as v0.x
expansion loading).

### Where the modularity dimensions are *not* free

Two cases where the orthogonality breaks down and that's fine:

1. **Settings are coupled to systems.** A setting package targets one
   or more specific game systems by name. Ironlands is for Ironsworn,
   not for Cairn. This is a content fact, not a tech limitation — the
   canon seed includes entity types and assumptions that only make
   sense in the target system. Cross-system settings (a "generic
   fantasy commons" pack) are out of scope for v1.0; see OQ3.

2. **A world is bound to its system + setting at init.** Changing the
   active game system of an existing world mid-life is not supported.
   The character schema, the system tools, and the seed canon
   collectively determine the world's identity; swapping the system
   would invalidate too much. Worlds are cheap to create; if a player
   wants to "switch system," they start a new world (optionally
   importing a re-published setting bundle from the old one).

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

## Module contracts

### Game-system module

```jsonc
{
  "kind": "system",
  "name": "ironsworn",
  "version": "1.0.0",
  "coreCompat": ">=1.0.0",
  "schemaVersion": 1,
  "contributes": {
    "rules":           "./rules",                  // pure TS, typed
    "data":            ["moves", "oracles", "assets"],
    "tools":           "./mcp-tools",              // game-specific MCP tools
    "characterShape":  "./character.schema.json",  // validates character.json
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

A game system **does not** ship canon. Default settings ship as
sibling packages (see below).

### Setting module

```jsonc
{
  "kind": "setting",
  "name": "ironlands",
  "version": "1.0.0",
  "systemCompat":  { "ironsworn": ">=1.0.0" },
  "contributes": {
    "canon":        "./seed/canon.json",       // entities + relations
    "agentBriefing": "./tone-and-themes.md"    // optional setting-flavor briefing
  }
}
```

At world-init the core:

- Validates that the world's chosen system is in `systemCompat`
- Loads `canon` into the fresh world DB as `campaign_id IS NULL`
  entities and relations
- Appends `agentBriefing` to the GM prompt (after the system's briefing)

A setting **does not** ship rules or tools. Settings are pure content;
mixing in mechanics would couple them to systems in ways the manifest
boundary forbids.

### Craft and expansion module contracts

(Unchanged in structure; both follow the same manifest pattern with
`kind: "craft"` and `kind: "expansion"` respectively. Expansion manifest
includes `extends: "<system-name>"` and a version range. See
`docs/design/expansion-system.md` for the expansion specifics.)

Other systems and settings implement the same contracts. The KG, the
MCP plumbing, the agent runtime, and the campaign state shell stay
system- and setting-agnostic.

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
  world.json              # { name, system, setting, axioms, tone, schemaVersion }
  world.db / world.bundle # the KG (file in Path B, container volume in Path A)
  campaigns/
    <campaign>/
      campaign.json       # campaign id, name, schema versions
      character.json      # character state (shape from game-system module)
      state-journal.jsonl # append-only audit log of mutations
```

`world.json` pins the system and setting versions at world-init. The
loader uses these to load the right CC plugins and to refuse activation
if compatibility no longer holds (e.g., the system has had a breaking
major bump and this world hasn't been migrated).

Why not put `character.json` in the KG? Character state isn't world
knowledge — it's the player's mechanical position in the game. It
doesn't need retrieval; it needs to be loaded fresh and modified atomically
every turn. Putting it in the KG would pay the cost of graph storage for
a 2KB document that's read in full every turn anyway.

## Expansion system (carried forward)

Expansions extend a game system. They contribute moves, oracles,
assets, MCP tools, DB migrations, context sections, skills, and
(optionally) canon seed. The existing v0.x expansion design (Delve as
a CC plugin loaded into the scribe namespace) carries forward unchanged
in spirit. Adjustments for v1.0:

- Expansions declare which game system they extend (`extends: "ironsworn"`)
- Core refuses to load expansions whose `extends` doesn't match the
  active world's game system
- Migration namespacing extends from system + expansion (Path B) /
  Graphiti group-id scoping (Path A)

See `docs/design/expansion-system.md`.

### Licensing boundary — expansions stay in separate repos

The licensing boundary that drives v0.x's expansion design is preserved
in v1.0 and made cleaner by the three-store split. The key insight:
**expansions are rules, not lore.** They don't go in the KG. They ship
as separate packages, public or private, with no contractual link to
this repo other than the loader's manifest contract.

What an expansion contributes, mapped onto the three stores:

| Contribution | Three-store layer | Distribution |
|---|---|---|
| Moves, oracles, assets | Game-system (rules) | Ships with the expansion package |
| Skills | Craft | Ships with the expansion package, loaded by CC |
| MCP tools, DB migrations, context sections | Technical integration | Ships with the expansion package, registered at load |
| **Canon seed** (named NPCs, places, factions shipped as official content) | World (after activation) | Ships with the expansion; **merged into world KG at activation time** |

The first three are static system content — they belong in the
expansion's private repo and never touch the world DB. The fourth is the
only thing that crosses into the player's world DB, and it does so as
`campaign_id IS NULL` entries identical to any other world canon. After
activation, the seed is owned by the world; the expansion's source
repo is no longer involved.

This means a paid expansion's actual copyrighted content (move text,
oracle tables, asset cards, named threats, site themes) lives entirely
in the private repo. Purchasers install the CC plugin; the loader
registers contributions; the seed merges; play resumes. Uninstalling
the expansion removes the rules and tools — the merged canon stays in
the world DB (player owns it now). Re-activating restores rules and
tools without re-merging (idempotent on entity ID).

### What about paid game-system, setting, or craft modules?

The same mechanism works at any conceptual level. A paid game system
(e.g., Starforged), a paid setting (e.g., The Forge), or a paid craft
module (a published "advanced GM techniques" pack) all ship as private
CC plugins discovered the same way. The manifest contract, loader, and
CC plugin discovery are identical across kinds. The only difference is
where the package lives and how it's distributed.

Four independently licensed pieces can stack in one world:

```
public:  agentic-rpg-core                              (scribe server, agent, KG)
private: agentic-rpg-system-starforged                 (paid base rules)
private: agentic-rpg-setting-forge                     (paid setting canon)
private: agentic-rpg-expansion-starforged-sundered-isles (paid expansion)
public:  agentic-rpg-craft-default                     (free GM skills)
```

All five are CC plugins discovered through `installed_plugins.json`.
The player has paid for three of them. The world DB ends up with canon
seed from the paid setting and any seed contributed by the expansion,
owned by the player from activation onward. The public core never sees
the paid content's source.

### What expansions cannot do

The licensing boundary cuts both ways. An expansion **cannot**:

- Modify the world DB schema (only contribute migrations within its
  namespace)
- Override core retrieval tools (`recall`, `record_scene`, etc.) — only
  add new tools
- Contribute canon scoped to a specific campaign (canon seeds always
  merge as world-level `campaign_id IS NULL` — per-campaign overlay
  state is the player's to write through play, not the expansion's)
- Reach into another expansion's namespace

These limits aren't about licensing per se — they keep expansions
composable. Two expansions for the same system should be installable
together without contention, which means neither can claim shared
ground.

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

## Future-proofing — designing for play-style variance

A hex crawl, a megadungeon, a city sandbox, a West Marches campaign,
and Ironsworn's story-driven solo all run on the same agent loop and
the same KG. They vary on:

- **Spatial structure** — none / pointcrawl / hex grid / square grid /
  topological / freeform map
- **Temporal granularity** — scene-paced / turn-paced / day-paced
- **Procedural generation** — none / per-region / per-encounter
- **State tracked** — vows / clocks / hex-discovery / clues / resources
- **Encounter triggering** — oracle / table / clock / spatial

v1.0 doesn't ship most of these. The design constraint is that v1.0
**must not preclude** them: adding a hex-crawl module later should be a
module-and-data exercise, not a fork of the core.

### What's invariant (stays in core)

- Entities + relations + scenes as the universal data model
- Campaign-as-tag partition and the visibility filter
- The canonize ritual
- The fiction-grounding protocol
- `recall`'s shape (query + filters + limit)
- The GM agent's role and prompt structure
- Per-tool retrieval budgets

### What varies (lives in the game-system module)

| Axis | Examples | Where it lives |
|---|---|---|
| Spatial model | hex / grid / pointcrawl | Entity `metadata.coordinates` + module-owned tools |
| Time model | turn / day / encumbrance round | `tick()` primitive + character state fields |
| Procgen | encounter tables / region content | Module's `procgen` contribution |
| State tracked | vows, clocks, rations, light | Character schema + entity overlay relations |
| Encounter triggering | per-hex / per-day / scripted | Module logic, surfacing through MCP tools |

The pattern: variance lives in the module. The core provides primitives;
the module composes them.

### Extension points v1.0 must lock in now

These are cheap to ship as scaffolding in v1.0 and expensive to retrofit
later. Each is a small concession to future flexibility, not a feature.

1. **Coordinates as a metadata convention.** Entities of `type='place'`
   may carry `metadata.coordinates: { x, y, system: 'hex' | 'square' | 'geo', ... }`.
   The core stores coordinates as opaque JSON; it does not interpret
   them. Modules that care about spatial play use them. A hex-crawl
   module's distance function reads them; Ironsworn ignores them.

2. **Per-campaign overlay state as relations.** Discovery state, faction
   disposition shift, "PC has met this NPC," "party has explored this
   hex" — all expressed as relations from the PC entity (or a synthetic
   `party` entity) to the target, with `campaign_id = current`. The
   visibility filter naturally scopes them. No `entity_campaign_state`
   side table needed; the existing schema absorbs it.

3. **Bulk operations.** `upsert_entities(batch)` and `link_batch(batch)`
   ship in v1.0 even though Ironsworn's per-scene drip doesn't need
   them. A hex-crawl module pre-seeding 10,000 hex placeholders does.
   The bulk path means batched embedding calls too — important at
   scale.

4. **Spatial queries in `recall`.** The `near` parameter accepts either
   `{ entity: <id> }` (graph proximity, what we ship in v1.0) or
   `{ coordinates: { x, y }, radius, metric }` (spatial proximity,
   future). The type union is defined from day one; only the first
   branch is implemented in v1.0. Adding the second is purely additive.

5. **Procgen contribution type.** The module manifest gains an optional
   `procgen` block:

   ```jsonc
   "procgen": {
     "region": "./procgen/region.ts",     // generate content for a place
     "encounter": "./procgen/encounter.ts" // generate an encounter on demand
   }
   ```

   v1.0 ships the manifest type and dispatcher; Ironsworn doesn't use
   it. A hex-crawl module would generate hex content lazily on first
   visit, calling `upsert_entity` / `link` to persist results.

6. **Time primitive.** `tick(amount, unit)` is a core MCP tool that
   advances either `world.time` or `campaign.time` (depending on
   caller). Modules choose unit and frequency. Ironsworn ticks rarely
   (per-session); hex-crawl ticks per-hex-of-travel; a clock-driven
   sandbox ticks per real-time day. Core just keeps the counter and
   emits a `tick` event modules can subscribe to.

### Worked example: a hex-crawl module without core changes

What it would take to ship `game-system-hexcrawl`:

1. **Manifest** declares `spatial: { kind: 'hex', size: '6mi', wrap: false }`
   in a module-defined `contributes.config` block (core preserves it
   without interpretation).
2. **Tools** registered: `travel_to_hex(hex_id)`, `explore_hex(hex_id)`,
   `roll_encounter(hex_id)`, `mark_discovered(hex_id)`.
3. **Procgen** generates hex content on first reference — terrain,
   features, encounter tables — and writes to the KG with appropriate
   `campaign_id` (the hex map skeleton is world-canon; specific
   encounter outcomes are campaign-scoped).
4. **Character schema** adds `rations`, `light_remaining`, `mount`,
   `pace`.
5. **Context section** outputs the current hex's coordinates, terrain,
   neighbors, and any party-visible features.
6. **Encounter-triggering** logic lives in the module: `travel_to_hex`
   internally calls `tick(8, 'hours')`, then rolls encounters using
   the module's tables, then calls `record_scene` if an encounter
   fires.
7. **No core changes.**

The core never learns what a hex is. It stores coordinates as opaque
metadata, traverses relations the module wrote, runs `recall` against
the entities the module created, and ticks a counter on request. The
module is the spatial authority; the KG is the persistence and
retrieval substrate.

The same exercise works for a city-sandbox module (no spatial, but
heavy faction state), a megadungeon module (room-graph with
procedural extension), or a West Marches setup (multiple campaigns
in one world, with shared world canon).

### What this section explicitly excludes

- v1.0 does not ship hex-crawl, megadungeon, city-sandbox, or West
  Marches modules.
- v1.0 does not implement spatial-coordinate queries in `recall` — only
  reserves the parameter shape.
- We are not building a generic RPG engine. The core stays minimal;
  variance lives in modules. The extension points above are the
  *complete* set we commit to in v1.0; anything beyond them is a
  future RFC.

## Migration from v0.x

Tracked separately. Major pieces:

1. Refactor the public repo into a Bun workspace monorepo:
   `packages/core` + `packages/game-system-ironsworn` +
   `packages/setting-ironlands` + `packages/craft-default`. Each is a
   separate CC plugin.
2. Resolve #166: unify lore.duckdb + scenes.duckdb + npcs/*.json into
   one world DB; introduce `campaign_id` column
3. Implement the Path A vs Path B spike; commit to one
4. Implement the setting-seed-at-world-init mechanism; package the
   Ironlands canon as `setting-ironlands`. Verify a fresh world with
   `setting: null` boots cleanly with no seed.
5. Move existing skills into a `craft-default` module; verify they don't
   leak system-specific tool names
6. Implement `recall` as the unified retrieval tool; deprecate the v0.x
   split
7. Add per-tool retrieval budgets; tune
8. Implement the canonize slash command; integrate with `extract_session_lore`
9. Implement the future-proofing extension points (coordinates convention,
   bulk ops, `near` parameter union, `procgen` manifest type, `tick`
   primitive). Each is small individually; together they make v1.0 the
   architecture-stable target.

## Decisions (settled)

- **D1** Three knowledge stores, not one: game-system, craft, world.
  Only the world is the KG.
- **D2** Setting canon seeds the world DB at world-init; from then on
  it's just world knowledge. The system module ships rules; the setting
  module ships canon — never the same package.
- **D3** One world DB, campaign as a column (#166). Visibility filter on
  every read. Canon promotion is one column flip.
- **D4** Game-system-agnostic core. Modules declare rules, data,
  character shape via the game-system contract; canon seed via the
  separate setting contract.
- **D4a** Four conceptual modularity levels (system, setting, world,
  campaign) are independent from three distribution mechanisms (TS
  packages, repos, CC plugins). Mechanisms compose orthogonally per
  piece of content.
- **D4b** Settings are first-class modules, separable from systems.
  A game system ships rules; a setting ships canon seed. Multiple
  worlds can share a setting. A mature world can be re-packaged as a
  setting for republication.
- **D5** Craft is system-agnostic by default. Optional system-flavored
  craft modules stack additively.
- **D6** Tool surface: one tool per query pattern (`recall`, not
  six search tools). Per-tool retrieval budgets enforced at boundary.
- **D7** Character state stays on disk as `character.json`, not in the
  KG.
- **D8** Path A (Graphiti + FalkorDB) vs Path B (SQLite + sqlite-vec)
  decided by spike, not by argument. Default lean: Path A.
- **D9** Spatial coordinates are an entity-metadata convention, not a
  first-class column. Core stores them; modules interpret them.
- **D10** Per-campaign overlay state (discovery, faction disposition,
  PC-met-this-NPC) lives as relations with `campaign_id = current`, not
  in a side table. The existing schema absorbs it; the visibility filter
  naturally scopes it.
- **D11** Bulk operations (`upsert_entities`, `link_batch`), spatial
  `near` parameter shape, `procgen` manifest type, and `tick` primitive
  ship in v1.0 as extension scaffolding even though Ironsworn doesn't
  use them. Cheap now, expensive to retrofit.
- **D12** Expansions and paid modules of any kind (system, setting,
  craft) live in separate (public or private) repos and are discovered
  through CC's plugin install mechanism. They contribute according to
  their kind's manifest contract. Only canon (from settings or seed-
  carrying expansions) crosses into the world DB; rules, craft, and
  tools stay packaged with the source. The licensing boundary is
  preserved end-to-end.
- **D13** CC plugin naming convention is
  `agentic-rpg-{system|setting|expansion|craft}-<name>`. The loader
  discovers by prefix; every plugin's manifest declares its `kind`.
  Each plugin versions independently and declares its compatibility
  surface (`coreCompat`, `systemCompat`, `extends`).
- **D14** A world is bound to its system + setting at init.
  Mid-life system or setting swaps are not supported. Worlds are cheap;
  start a new world if you want to switch.

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
- **OQ6** Should overlay-state relations anchor on the PC entity or on
  a synthetic `party` entity? PC is simpler; `party` generalizes to
  multi-PC parties (OQ4). Default to PC; revisit if/when OQ4 is
  pursued.
- **OQ7** Should `tick` events be a true pub/sub the module subscribes
  to, or just a counter the module polls? Pub/sub is more elegant but
  adds runtime complexity; polling is simpler. Default to polling for
  v1.0; revisit if a module wants reactive tick handling.

## Why this is v1.0

v0.x evolved by accretion: each feature was added without challenging
whether it belonged in the layer that grew it. By v0.18 we had three
parallel stores, system-specific names baked into shared retrieval
tools, and ambiguity about whether GraphRAG community detection was
fundamental or speculative.

v1.0 is the version where the system can answer:
- "What does this layer know?" (clean three-way split: system / craft /
  world)
- "How do I run this game system?" (the system manifest)
- "What setting am I playing in?" (the setting manifest, decoupled)
- "What carries to a new campaign?" (the visibility filter)
- "Where does the agent get its craft?" (the craft module)
- "Where does the source live? How is it packaged? What does CC see?"
  (the three orthogonal distribution mechanisms)

It's also the version where:
- Adding Cairn or Trophy Gold is a manifest-and-data exercise
- Publishing a homebrew setting (your Zura world, frozen) is an export
  + repackage operation
- Two players can share a setting and play independent worlds without
  cross-contamination
- A paid system plus a paid setting plus a paid expansion plus a free
  craft module compose cleanly on a free core
