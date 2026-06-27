# Agentic RPG v1.0 — Design Spec

Status: design spec. Replaces ad-hoc evolution from v0.x. Companion to
[`world-db.md`](world-db.md) (the unified world DB as built in #166 /
PR #169) and [`knowledge-graph.md`](knowledge-graph.md) (KG framing).
This is the architectural target; migration from v0.x is tracked
separately, and the "Migration from v0.x" section below marks what has
already landed.

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
- **UI-agnostic runtime.** The CC plugin is one frontend. The runtime
  (Bun/TS, npm packages) is the actual product; alternate frontends
  (web app, desktop app) are anticipated as future work.
- Coherent fiction: every retrieval the GM agent makes is grounded in
  recorded canon, never invented
- Portability: a world can be exported, shared, and resumed elsewhere

## Non-goals

- Multiplayer / synchronous play
- VTT integration, maps, tactical positioning (out of scope, not
  precluded by the architecture)
- Asset generation (images, audio)
- Closed-form replay of pre-written modules
- Mixing game systems within a single world
- **Alternate UI in v1.0.** The runtime is built to allow it; we
  ship via the CC plugin only.
- **Per-module CC plugins or per-module CC plugin discovery.** Modules
  are npm packages; Bun handles dependency resolution. See "Distribution"
  below.

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

## v1 sequencing — coherence is the critical path

The rest of this document describes a target *architecture*. This
section describes the v1 *build order*, and corrects a sequencing
mistake the rest of the doc encodes implicitly.

### The mistake to correct

The doc is heavy on platform: four modularity levels, npm packaging,
licensing boundaries, paid-content stacks, frontend inventories,
hex-crawl extension points. All defensible as "don't preclude it" —
but the actual purpose of the system is **a storyteller that maintains
a coherent knowledge graph of a world**. Platform design is easier to
write down (schemas and packaging are decidable) so it accumulated more
ink. Coherence design is empirical and harder to specify, so it ended
up as carried-forward v0.x code and open questions.

For v1, the order has to invert: storyteller coherence first, platform
work behind it.

### Why coherence is the hard problem

Storage isn't the hard part. The world DB (#166, landed in #169) gives
us a place to put facts — necessary, not sufficient. The actual failure
modes for a storyteller, several already observable in Zura play:

1. **Capture at point of entry.** The highest-leverage fix is *not* better
   extraction — batch extraction is a lossy prose→structure reconstruction that
   lacks the author's knowledge of what is canonical and reliable name grounding.
   The GM, at narration time, has both. Canon (entities **and relations**) should
   be recorded on the beat via `record_beat`; extraction is demoted to optional
   backfill. (Established 2026-06 after measurement: relation recall caps because
   relations were never recorded where known; a two-pass extractor was a measured
   negative result; the dedup regression was largely name fragmentation from
   re-deriving names independently. See
   `docs/superpowers/specs/2026-06-27-point-of-entry-recording-design.md`.)
2. **Temporal truth.** Who's alive *now*? Who holds the post *now*?
   `knowledge-graph.md` explicitly defers bi-temporal validity ("until
   NPC churn forces it"). For a storyteller this is wrong — narrating a
   dead NPC as alive is the canonical coherence failure.
3. **Retrieval at the right moment.** The fiction-grounding protocol
   relies on the agent remembering to ground before invention. The
   harder version — surfacing what the agent didn't know to ask for —
   is unaddressed.
4. **Contradiction detection.** Nothing checks a new claim against
   existing canon at write time. The canonize ritual is the human
   backstop, which is right; the graph itself could flag conflicts
   instead of silently absorbing both versions.

Mechanics is acknowledged as not the hard problem, and we already aren't
reinventing there — #169 ships `gen-assets-from-datasworn.ts`, so rules
come from Datasworn rather than hand-transcription. That's the right
pattern: rules are commodity data plus pure functions.

### v1 priorities, in order

> **Status (as of 2026-06-27):** #1 ✅ done · #2 ✅ done ·
> #3 ❌ not started · #4 🟡 substantially done · #5 ❌ not started ·
> #6 ❌ not started · #7 ❌ deferred by design. Point-of-entry structured
> recording (#2) is the active completed item; the DuckDB substrate is locked.
> Next pickup: #3 (extraction evaluation as backfill-quality measurement).

1. **Graphiti spike (gating decision).** ✅ **Resolved (2026-06-16): Path B.**
   Promote OQ1 from open question
   to the *first* decision. Feed the Zura corpus into Graphiti +
   FalkorDB, evaluate against current scribe on retrieval quality and
   temporal handling. The outcome reshapes everything downstream — so
   it has to land before more is built on the current substrate. See
   "Step 1: Graphiti spike (handoff-ready)" below for a self-contained
   scope another session can run with. **Outcome:** rejected Path A
   storage (FalkorDB is a mandatory server vs. Goal #1; Graphiti's only
   embedded backend, Kuzu, is archived and deprecated by Graphiti) and
   committed to Path B (DuckDB). Graphiti's *extraction approach* was
   adopted into the DuckDB extractor. See `docs/spikes/2026-06-graphiti.md`.
2. **Point-of-entry structured recording.** ✅ **Done (2026-06-27).** The
   highest-leverage coherence improvement is authorial capture at the moment of
   narration, not batch extraction. `record_beat` now carries optional `entities`
   and `relations` payloads; the GM records canon on the beat using exact grounded
   names. Extraction is demoted to optional backfill. See
   `docs/superpowers/specs/2026-06-27-point-of-entry-recording-design.md`.
3. **Extraction evaluation (backfill-quality measurement).** Build a fixed set
   of Zura scenes with known-correct entities and relations, scored on every
   prompt or model change. *This is no longer the primary quality lever* —
   point-of-entry recording is. The harness measures backfill quality and guards
   against regressions in the fallback path.
4. **Temporal truth.** 🟡 **Substantially done (landed 2026-06; spike
   Phases 1–2, preserved through the Path B rollback).** Reverse the
   bi-temporal deferral in `knowledge-graph.md`. If the Graphiti spike
   adopts Graphiti, bi-temporal edges come for free. If it doesn't, add
   lightweight `supersedes` edges (already filed as OQ2 in
   `knowledge-graph.md`) plus an "as-of" filter on grounding reads.
   **Done:** `valid_at`/`invalid_at` columns on relations
   (`migrations/world.ts`, `rag/world-db.ts`), `supersedes`-driven
   `invalidateRelations` in extraction, and a current-fact filter
   (`invalid_at IS NULL`) on all lore grounding reads (`rag/lore.ts`).
   **Remaining:** arbitrary historical "as-of `<timestamp>`" reads —
   reads currently filter to *current* facts only, not a queryable past
   state.
5. **Write-time contradiction surfacing.** On `upsert_entity` /
   `link`, run a similarity check against existing canon and flag
   apparent contradictions (different summary for an existing alias;
   a relation that conflicts with one already on the graph) for the
   canonize ritual to adjudicate. Don't reject — surface.
6. **Retrieval discipline.** Tighten the fiction-grounding protocol
   into a hard tool-use pattern, not a prompt convention. Read tools
   return entity refs plus *what the agent should re-read before
   narrating* (e.g., "you fetched X but didn't fetch X's recent
   scenes — call recall first").
7. **Then the platform work.** System / setting / craft package
   splits, npm distribution, paid stacks, alt-frontend candidates,
   future-proofing extension points. Keep the boundaries the doc
   already establishes (they cost little in code); defer the
   generality (the loaders, the marketplace story, the hex-crawl
   modules). One system, one world, one player. Packaging serves a
   future that storyteller quality has to earn first.

### Step 1: Graphiti spike (handoff-ready)

This is intentionally scoped to be picked up by another session
without further context from this conversation. Briefing:

> **Goal.** Decide whether to replace scribe's `rag/` layer
> (extraction, lore graph, scene retrieval, community detection,
> proximity) with [Graphiti](https://github.com/getzep/graphiti)
> backed by [FalkorDB](https://www.falkordb.com/). Outcome is a
> recommendation with evidence, not a migration.
>
> **Why we're considering it.** Graphiti is purpose-built for
> agent-narrative knowledge graphs: bi-temporal edges, alias
> resolution, group_id partitioning (≈ our `campaign_id`), LLM
> extraction prompts iterated against orders of magnitude more
> transcripts than ours. If retrieval and temporal handling beat
> what we ship today, most of `packages/core/src/rag/` becomes
> deletable and OQ2 (`supersedes` edges) resolves for free.
>
> **Inputs.**
> - The Zura corpus (`/home/karimn/rpg/zura-ironsworn/` or the
>   equivalent — a real, mature world DB with ~hundreds of scenes
>   and entities).
> - Current scribe `rag/` code as the baseline:
>   `packages/core/src/rag/{lore,scenes,extraction,communities,
>   proximity,query}.ts`.
> - `docs/design/world-db.md` for our schema and visibility model.
> - `docs/design/knowledge-graph.md` for the explicit Q1–Q6 the
>   graph must answer.
>
> **Method.**
> 1. Stand up FalkorDB locally (single Docker container).
> 2. Feed Graphiti the Zura scene corpus via its ingestion API,
>    one campaign at a time, using `group_id = <campaign-id>` to
>    mirror our partitioning.
> 3. Implement six representative queries (Q1–Q6 from
>    `knowledge-graph.md`) against both Graphiti and current scribe.
> 4. Score side-by-side on:
>    - Retrieval relevance (human judgment on top-k for the same
>      query, 20 query samples).
>    - Alias resolution (does Graphiti correctly merge "Lona" /
>      "the healer Lona" / "Lona of Caldren"? Does ours?).
>    - Temporal correctness (manufacture a "the Magistrate was
>      deposed in scene 47" case; query "who is the current
>      Magistrate" — does each system answer correctly?).
>    - Extraction quality (Graphiti's prompts vs. ours on the same
>      raw scene text — entity count, relation correctness,
>      false positives).
>    - Operational complexity (install, run, observe, debug).
>
> **Deliverable.** A markdown report at
> `docs/spikes/2026-XX-graphiti.md` with:
> - The scoring matrix
> - 3–5 concrete query examples showing the comparison
> - A recommendation: adopt / hybrid / reject, with reasoning
> - If "adopt": a sketched migration path (which `rag/*.ts`
>   modules become Graphiti calls, which stay; how `world.duckdb`
>   coexists or retires)
> - If "reject": what specifically didn't work, so we don't keep
>   wondering
>
> **Out of scope.** Actually implementing the migration. This is a
> decision-grade spike, not a refactor. Time-box: 1–2 days of
> focused work.

That's the whole brief. Hand it to another session and step 1 starts
without you in the loop.

### What this section does not change

- The world DB design (#166) stays. The Graphiti spike *might*
  recommend replacing it; if so, the schema we built is a clean
  reference for the migration, and the visibility model carries over
  to Graphiti's `group_id`.
- The runtime/frontend split (D20–D21) stays. The storyteller-quality
  improvements all happen inside the runtime.
- Platform sections don't get deleted; they get *demoted*. The
  modularity boundaries (system / setting / craft / world) are sound
  and cost little to maintain. The packaging machinery, marketplace
  story, and hex-crawl extension points wait until storyteller
  quality earns the right to scale.

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

A world declares its system and setting by adding them as dependencies
in `package.json` at world-init:

```jsonc
// worlds/zura/package.json
{
  "name": "zura-world",
  "dependencies": {
    "@agentic-rpg/core":            "^1.0.0",
    "@agentic-rpg/system-ironsworn": "^1.0.0",
    "@agentic-rpg/setting-ironlands": "^1.0.0",
    "@agentic-rpg/craft-default":   "^1.0.0"
  }
}
```

Omitting a setting dependency is a valid choice — a fully emergent
world with no canon seed. Everything grows from play.

(See "Distribution" below for why this lives in `package.json` rather
than a custom manifest file.)

## Architecture

Two layers, cleanly separated:

```
┌─────────────────────────────────────────────────────┐
│ Frontend                                            │
│   - CC plugin (v1.0)                                │
│   - Future: web app, desktop app, mobile app        │
│   Responsibility: user I/O, agent loop, UI surface  │
└─────────────────────────────────────────────────────┘
                          │
                MCP protocol + npm imports
                          ▼
┌─────────────────────────────────────────────────────┐
│ Runtime (npm packages, Bun)                         │
│                                                     │
│   @agentic-rpg/core           scribe MCP server,    │
│                               KG, state, migrations │
│   @agentic-rpg/system-*       game-system rules     │
│   @agentic-rpg/setting-*      setting canon seeds   │
│   @agentic-rpg/craft-*        craft skills          │
│   @publisher/expansion-*      expansions            │
└─────────────────────────────────────────────────────┘
```

The runtime is the product. It's pure Bun/TS, distributed as npm
packages, and is what every frontend consumes. The CC plugin is the
v1.0 frontend; it provides the user-visible chat surface, runs the
agent loop, and starts the scribe MCP server from the runtime. It
contains no business logic of its own.

A world picks one system + zero-or-one setting at init. The runtime
loads whatever modules the world's `package.json` declares (Bun
resolves the actual versions and writes `bun.lock`).

## Runtime vs frontend

The frontend's job is small: render the conversation, dispatch user
input to the agent loop, surface skills the agent might use, and host
the MCP server connection. Today this is CC. Tomorrow it could be a
custom client.

The runtime's job is everything else: the GM agent prompt, the rules
engines, the KG, the migrations, the canonize ritual, the fiction-
grounding protocol, the tool implementations. None of it knows what
frontend is calling it.

This separation is what makes the architecture future-proof. If a
custom UI is built later, **no runtime code changes** — the new
frontend imports the same npm packages, starts the same MCP server,
runs the same agent loop. The CC plugin is, structurally, the
*first reference frontend*; it is not the platform.

Three constraints follow:

1. **No CC-specific assumptions in the runtime.** No reading from CC's
   installed_plugins.json, no calling CC commands, no relying on CC's
   skill-activation heuristics for correctness. All discovery of modules
   goes through Bun's package resolution (the world's `node_modules`).
2. **Skills are content, not behavior.** They're markdown documents
   any frontend can render or surface. CC happens to activate them on
   trigger phrases; another frontend could surface them as a sidebar
   help menu. The runtime never assumes skills will be activated.
3. **Slash commands are frontend ergonomics.** The runtime exports
   *actions* (init world, activate expansion, canonize, migrate). CC
   maps `/agentic-rpg-init-world` to one of those actions; a custom
   UI might use a button. The runtime exports the action surface, not
   the slash command names.

### Frontend inventory — what CC does for us, and what's portable

Concrete enumeration of what the v1.0 CC plugin provides, with the
portability story for each. Any future alternate frontend uses this
list to scope its build.

| Capability | Form | Portable to other frontends? |
|---|---|---|
| MCP server hosting (spawns scribe via `.mcp.json`) | Protocol wiring | **Yes** — MCP is a standard. Spawn the scribe child process; speak MCP over stdio. |
| GM agent prompt (`agents/<name>.md`) | Markdown file in a craft package | **Yes** — read the file; send the body as system prompt to Claude. |
| Skill content (`skills/*/SKILL.md`) | Markdown files in a craft package | **Yes** — pure content, format is ours. |
| Skill activation (deciding when to surface a skill) | CC heuristic on frontmatter triggers | **No** — reimplement or replace. See "Skill activation strategies" below. |
| Slash command targets | Runtime-exported actions (TS functions) | **Yes** — the runtime exports them; CC happens to be one dispatcher. |
| Slash command dispatch (`/foo` → action) | CC behavior | **No** — alternate UI uses buttons, palette, or natural-language detection. |
| `/remember` + memory store | CC skill + `.remember/` directory | **No** — replaced in v1.0 by runtime-owned `preferences.md` files + `remember(scope, note)` tool. See D28. |
| Agent loop (Claude tool-use loop, streaming, context build) | CC behavior | **No** — but Anthropic's Claude Agent SDK is purpose-built for this. ~200 lines of glue, not a rewrite. |
| Anthropic API auth | CC behavior | **No** — alternate UI uses Anthropic SDK with user-provided API key or a hosted approach. |
| Conversation UI (chat rendering, tool-use display) | CC behavior | **No** — entirely custom. The point of building one. |
| Settings, hooks, permissions | CC behavior | **No** — alternate UI has its own settings model. |
| Plugin install/update for the runtime shim | CC plugin manager | **Per-frontend.** Each frontend distributes itself however it wants. CC owns its shim; a custom app handles its own updates. |
| Content package install (`bun add ...`) | Bun, not CC | **Yes** — already portable. Any frontend invokes Bun or wraps it. |

### Skill activation strategies a frontend can choose

Skill *content* is portable (markdown in craft packages). Skill
*activation* — when to surface a skill into the agent's context — is a
frontend decision. Three plausible strategies, all consistent with the
runtime contract:

1. **Always-on.** Concatenate all relevant skills into the system
   prompt. Works if the total token budget is small enough
   (~15 skills × ~600 words ≈ ~9k tokens; fine for Claude). Simplest
   to ship.
2. **Tool-use activation.** Skills become tools the agent calls:
   `load_skill("combat-resolution")` returns the content. Lets the
   agent decide when it needs reference material rather than the
   frontend guessing. Best for a real custom UI.
3. **UI-surfaced.** A sidebar lists available skills; the user clicks
   to pin one into the next prompt. Good for power-user workflows
   where the human GM wants explicit control of what's in context.

CC today uses a frontmatter-driven variant of (3) (heuristic
activation on trigger phrases). The runtime doesn't care which
strategy a frontend uses; it ships the markdown.

### Minimum viable alternate frontend

For reference: the smallest possible custom UI that consumes our
runtime needs five things:

1. Spawn the scribe MCP server (one child process, MCP over stdio)
2. Read the GM agent prompt from a craft package and pass to Claude
3. Read skill markdown from craft packages; pick an activation
   strategy
4. Run a Claude tool-use loop (Claude Agent SDK does this for you)
5. Render conversation; provide input affordances

Everything below this — the runtime, the rules engines, the KG, the
migrations, every content package, the player-directive store — works
unchanged. The CC plugin today does these five things plus its own
UX surface; a custom frontend does the same five things plus
whatever UX it wants.

## Distribution — one CC plugin, many npm packages

The CC plugin and Bun/npm are good at different things. v0.x tried to
make CC plugins coordinate dependency graphs and produced fragility;
v1.0 splits the responsibility so each handles what it's good at.

| Layer | Job | Mechanism |
|---|---|---|
| Frontend distribution | "Install the runtime" | One CC plugin: `agentic-rpg` |
| Content distribution | "Install a game system, setting, craft, expansion" | npm packages, resolved by Bun |
| Licensing boundary | "This content is paid; this is open" | Public vs. private npm registries |

### One CC plugin

The `agentic-rpg` CC plugin ships the frontend. It contains:

- The MCP server wiring (a `.mcp.json` that starts the scribe server)
- The default GM agent prompt
- The default skill set (markdown only)
- Slash commands that wrap runtime actions
- No business logic; no rules; no content

That plugin versions and updates through CC's normal lifecycle. Players
install it once.

### Many npm packages

All content — game systems, settings, craft, expansions — ships as npm
packages under the `@agentic-rpg/*` scope (or a publisher's own scope
for paid content). Conventional package names:

| Conceptual level | npm package name |
|---|---|
| Runtime core | `@agentic-rpg/core` |
| Game system | `@agentic-rpg/system-<name>` (e.g., `@agentic-rpg/system-ironsworn`) |
| Setting | `@agentic-rpg/setting-<name>` (e.g., `@agentic-rpg/setting-ironlands`) |
| Craft | `@agentic-rpg/craft-<name>` (e.g., `@agentic-rpg/craft-default`) |
| Expansion | `@<publisher>/<system>-<name>` (e.g., `@karimn/ironsworn-delve`) |

A world is a Bun project. Its `package.json` declares which content
packages are in play; `bun.lock` records the exact resolved versions;
`node_modules/` holds them. The runtime loads modules by importing from
`node_modules` — standard.

```
~/rpg/my-zura-world/
  package.json        # declares @agentic-rpg/system-ironsworn, @agentic-rpg/setting-ironlands, ...
  bun.lock            # resolved versions, by Bun
  node_modules/       # actual installed packages
  world.json          # game state metadata (schema versions, embedding pin, kgPath)
  world.db            # the KG
  campaigns/<id>/     # per-campaign state
```

### How the user actually interacts with it

Adding content is `bun add`:

```
cd ~/rpg/my-zura-world
bun add @agentic-rpg/system-ironsworn @agentic-rpg/setting-ironlands
bun add @karimn/ironsworn-delve --registry=https://npm.pkg.github.com  # paid
```

Updates are `bun update`. Removal is `bun remove`. Lock file is
`bun.lock`. There are no compat ranges to manage in `world.json`,
no per-module CC plugin install commands, no `installed_plugins.json`
scanning at our layer.

The CC plugin provides slash command wrappers (`/agentic-rpg-add system-ironsworn`)
that shell out to Bun, so players who don't want to type CLI commands
still get a guided experience. The wrappers are thin; Bun does the
work.

### Why this resolves the maze

What goes away vs. the v0.x trajectory:

- ~~Per-module CC plugins~~ → one CC plugin, npm packages for the rest
- ~~`installed_plugins.json` scanning in our loader~~ → Bun resolves; we import
- ~~Compat ranges in `world.json` per module~~ → Bun's `package.json` + `bun.lock`
- ~~`coreCompat`/`systemCompat`/`extends` ranges in manifests~~ → standard `peerDependencies`
- ~~`world.lock.json`~~ → `bun.lock` already does this
- ~~Three version namespaces (CC plugin, TS package, schema)~~ → one (npm) + schema (separate concern)
- ~~Starter meta-plugin pattern~~ → publish a `package.json` template
- ~~Setup wizard for multi-plugin install~~ → `/agentic-rpg-init-world` runs `bun init` + adds starter deps

What stays:

- **Schema versions** on `world.json` and `character.json` — how the
  migration runner knows what shape to read
- **Embedding model pin** in `world.json` — silent correctness issue if
  it drifts
- **KG path pin** in `world.json` — can't switch backends transparently
- **The conceptual four-level modularity** (system, setting, world,
  campaign) — that's content modeling, not packaging
- **Public monorepo vs. private repos for licensing** — same boundary,
  just expressed via npm registry config

### Worked example — paid content stack

A player running Starforged (paid) in the official Forge setting (paid),
with the Sundered Isles expansion (paid), on the open runtime:

```jsonc
// ~/rpg/my-starforged-world/package.json
{
  "dependencies": {
    "@agentic-rpg/core":             "^1.0.0",
    "@ironspike/system-starforged":  "^1.0.0",  // paid, private registry
    "@ironspike/setting-forge":      "^1.0.0",  // paid, private registry
    "@ironspike/sundered-isles":     "^1.0.0",  // paid, private registry
    "@agentic-rpg/craft-default":    "^1.0.0"
  }
}
```

Five packages, two registries (npm public + IronSpike private), one
CC plugin. The user runs `bun install` once; everything resolves.

Where the licensing boundary lives: in the registry config (which
private registries the user has auth for), not in our manifest schema.

### Why the npm package, not the CC plugin, is the unit of content

Bun's package resolver handles transitive dependencies, version conflict
detection, lock files, hoisting, peer dependency checking — every one
of those is a problem CC plugins don't solve. By putting content
distribution on Bun, we get all of that for free.

The CC plugin is just the runtime's installation vehicle.

## The KG layer — two paths, one spike to decide

> **Resolved (2026-06-16): Path B (DuckDB).** The spike rejected Path A
> storage and committed to the embedded store. Graphiti's extraction
> approach was adopted into the DuckDB extractor. The two-path framing
> below is retained as the design record. See
> `docs/spikes/2026-06-graphiti.md`.

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

> **Implemented.** #166 landed in PR #169 on the current DuckDB
> substrate. The detailed design-of-record — concrete schema, the
> visibility predicate, the canonize ritual, the migration path, and
> the tool surface as built — is **[`docs/design/world-db.md`](world-db.md)**.
> The summary below is the high-level shape; `world-db.md` is
> authoritative for implementation detail.

- One world DB per world (one file in Path B; one container volume in
  Path A). The shipped substrate is a single **`world.duckdb`** living
  one level above the campaign folder, with `world.json` alongside it.
- All entities, relations, and scenes in one store. NPCs collapse into
  `entities` with `type='person'`. Threads collapse into `entities`
  with `type='thread'`.
- `campaign_id` (Path B) / `group_id` (Path A's Graphiti) as the
  partition column; NULL = world canon, visible to all campaigns.
- **Visibility filter on every read**: `campaign_id IS NULL OR campaign_id = current`.
  Vector search applies it *before* ranking so a sibling campaign's
  row can't leak into top-k.
- **Promotion to canon is one column flip** — no export pipeline.
  Implemented as `canonize_entity` / `canonize_relation` (and the
  `decanonize_*` inverses) — entities and relations are canonized
  independently.
- Scenes are always campaign-owned; they reference a shared `place_entity`
  so two campaigns can record different scenes at the same location with
  shared geometry (proximity edges, place metadata).
- Per-campaign overlay relations anchor on the **PC entity** (the
  `type='person'` row for the character) — resolves OQ6. The mechanism
  is reserved; #166 does not yet build overlay-producing features.

## Module contracts

Every module is a normal npm package. Inter-module compatibility is
expressed through standard `peerDependencies`. There's no custom
"manifest" format separate from `package.json` — we use the one Bun
already understands.

A module signals its kind via the `agenticRpg` field on `package.json`
(a namespaced extension; npm tooling ignores unknown fields):

### Game-system package

```jsonc
// @agentic-rpg/system-ironsworn/package.json
{
  "name": "@agentic-rpg/system-ironsworn",
  "version": "1.0.0",
  "peerDependencies": {
    "@agentic-rpg/core": "^1.0.0"
  },
  "agenticRpg": {
    "kind": "system",
    "rules":           "./dist/rules.js",
    "data":            ["./data/moves.yaml", "./data/oracles.yaml", "./data/assets.yaml"],
    "tools":           "./dist/mcp-tools.js",
    "characterShape":  "./dist/character.schema.json",
    "contextSections": ["./dist/context-state.js"],
    "agentBriefing":   "./agent-briefing.md"
  }
}
```

The runtime imports the module, reads the `agenticRpg` field,
registers its contributions. Bun ensures `@agentic-rpg/core` is
installed in a compatible version before any of this happens; peer-
dependency resolution is the loader's compat check.

A system does not ship canon. Settings do.

### Setting package

```jsonc
// @agentic-rpg/setting-ironlands/package.json
{
  "name": "@agentic-rpg/setting-ironlands",
  "version": "1.0.0",
  "peerDependencies": {
    "@agentic-rpg/system-ironsworn": "^1.0.0"
  },
  "agenticRpg": {
    "kind": "setting",
    "canon":         "./seed/canon.json",
    "agentBriefing": "./tone-and-themes.md"
  }
}
```

A setting declares which system(s) it targets via `peerDependencies`.
Bun refuses to install a setting whose peer system isn't satisfied;
the error happens at `bun add` time, with a clear message — not at
load time, hidden inside our loader.

A setting ships pure content. No rules, no tools.

### Craft and expansion packages

Both follow the same pattern. Craft packages have
`kind: "craft"` and peer-depend on `@agentic-rpg/core`. Expansion
packages have `kind: "expansion"` and peer-depend on the system they
extend (e.g., `@agentic-rpg/system-ironsworn`). See
`docs/design/expansion-system.md` for expansion-specific contribution
shapes.

### Why peerDependencies, not dependencies

Settings and expansions don't *embed* the system; they *coordinate with*
it. The user installs `@agentic-rpg/system-ironsworn` directly in their
world's `package.json`. The setting and expansion declare that they
need the system to be present, and at a compatible version, but they
don't pull a duplicate copy. Standard npm peer-dep semantics.

This is also what makes one-content-package = one-version a clean
story. No "this package has a system version, that one wants a
different version" conflict — Bun resolves all peer deps to a single
satisfying version or errors out.

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

- `recall(query, kind?, near?, limit?)` — *target.* Subsumes
  `search_lore` / `get_npc` / `get_thread` / `search_scenes`. **Not yet
  built** — #169 kept the separate v0.x grounding reads (now
  visibility-filtered, with an `include_sibling_campaigns` opt-in). The
  `recall` unification is its own follow-up.
- `record_scene(summary, beats, place_entity, refs)` — *shipped (#169):*
  resolves names to entity UUIDs, auto-stubs unknowns as campaign-scoped
  entities, writes `scene_entity_refs`. `record_beat` carries optional
  `entities` and `relations` payloads; canon recorded on the beat via these
  fields is the primary path to the knowledge graph (point-of-entry recording).
- `upsert_entity(kind, name, summary, metadata)` — *shipped (#169);*
  `upsert_npc` / `upsert_lore` kept as one-release aliases.
- `link(from, to, label, metadata?)` — replaces v0.x `link_lore`.
- `canonize_entity(id)` / `canonize_relation(id)` and the
  `decanonize_*(id, into_campaign)` inverses — *shipped (#169).* Entities
  and relations canonize independently.
- `extract_session_lore()` — *optional backfill only.* Batch LLM extraction
  from recent scenes; use if the GM suspects canon was missed. Deduplicates
  against recorded canon via exact-match idempotency. Not the primary
  canon-capture path.

**Player-directive tools (system-agnostic, in core):**

- `remember(scope, note)` — append a free-form player directive to
  either `worlds/<world>/preferences.md` (`scope: "world"`) or
  `campaigns/<id>/preferences.md` (`scope: "campaign"`). Replaces v0.x
  reliance on CC's `/remember` skill + memory store.

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
| World-level player directives | `worlds/<world>/preferences.md` | ~300 |
| Active campaign state summary | core, from `character.json` + state journal | ~600 |
| Campaign-level player directives | `campaigns/<id>/preferences.md` | ~300 |
| System context sections | system module's `contextSections` | ~800 |
| Recent scenes summary (≤10) | KG | ~1500 |
| Recently referenced entities (≤20) | KG | ~1500 |
| Active threads (≤5) | KG | ~400 |
| Relevant community summaries (0–3) | KG | ~600 |

Total budget target: ~6.7k tokens. The GM agent pulls more on demand via
`recall(...)`. This is the discipline that makes long campaigns work.

The two `preferences.md` layers replace the v0.x reliance on CC's
memory feature — see "Player preferences" under Campaign state shell.

## Campaign state shell

A world is a Bun project directory. Layout:

```
worlds/<world>/
  package.json            # declares which content packages are in play  [target; not in #169]
  bun.lock                # exact resolved versions, by Bun              [target; not in #169]
  node_modules/           # installed content packages                   [target; not in #169]
  world.json              # { name, schemaVersion, embedding, kgPath, axioms, tone }
  world.db / world.bundle # the KG (file in Path B, container volume in Path A)
  preferences.md          # world-level player directives ("/remember" target)  [target]
  campaigns/
    <campaign>/
      campaign.json       # campaign id, name, character schema version
      character.json      # character state (shape from the active system package)
      state-journal.jsonl # append-only audit log of mutations
      preferences.md      # campaign-level player directives ("/remember" target)  [target]
```

> **As shipped in #169** the world root holds `world.duckdb` +
> `world.json` (`{ name, schemaVersion, embedding }`) and `campaigns/<id>/`.
> The Bun-project framing (`package.json`, `bun.lock`, `node_modules`),
> `preferences.md`, and the `kgPath` / `axioms` / `tone` keys on
> `world.json` are still target-state — they land with the workspace
> extraction, the `/remember` move, and the Path A/B spike respectively.

`package.json` is the source of truth for what content is loaded. Bun
resolves versions, writes `bun.lock`. The runtime reads `package.json`
and imports the declared packages from `node_modules` — no
`installed_plugins.json` scan, no custom manifest discovery, no compat
ranges in `world.json` to manage.

`world.json` carries only the three things npm can't reasonably express:

- **`schemaVersion`** — what shape `world.json` itself is; the migration
  runner reads this
- **`embedding`** — `{ model, version, dim }` pinned at world-init;
  load fails fast if the active embedding model differs (silent
  retrieval corruption otherwise)
- **`kgPath`** — Path A (Graphiti + FalkorDB) or Path B (SQLite +
  sqlite-vec); not switchable in place

Plus user-facing flavor (`name`, `axioms`, `tone`). That's it.

### Player preferences (`preferences.md`)

A pair of free-form markdown files — one at world scope, one per
campaign — that capture out-of-game player directives: "narrate more
moodily," "always offer me three options before I commit," "this PC
distrusts authority figures, lean into that," etc. This is the
runtime's equivalent of CC's `/remember` + project-memory pattern,
which v0.x has been leaning on but which CC owns rather than us.

In v1.0 the runtime owns it:

- A `remember(scope, note)` MCP tool appends to the world-level or
  campaign-level `preferences.md` with a timestamp
- The GM context builder always loads both files into the system
  prompt
- The frontend chooses how to surface the action — CC dispatches
  `/remember` to it; a custom UI might offer a "pin directive" button

This pulls the behavior into the runtime so any frontend gets it,
and removes the implicit dependency on CC's memory store. CC's
user-level `~/.claude/CLAUDE.md` can still hold cross-tool prefs
("I'm Karim, I prefer terse responses"); per-world play directives
belong in our files.

Migration from v0.x: an `.remember/` directory at world root (or
project-level `CLAUDE.md`) gets read once and written to
`worlds/<world>/preferences.md` under a `## Migrated from CC memory`
heading. One-shot, part of the world DB migration.

Why not put `character.json` in the KG? Character state isn't world
knowledge — it's the player's mechanical position in the game. It
doesn't need retrieval; it needs to be loaded fresh and modified atomically
every turn. Putting it in the KG would pay the cost of graph storage for
a 2KB document that's read in full every turn anyway.

## User journey and version management

The lifecycle. Bun handles the package side; the runtime handles
schema migrations and the few correctness-critical pins.

### Cold install

```
/plugin install karimn/agentic-rpg
```

One CC plugin. The runtime is now available; no content is loaded yet.

### Create a world

```
cd ~/rpg/my-zura-world
claude-code
/agentic-rpg-init-world          # prompts for system, setting, name
```

The command:

1. Runs `bun init` to scaffold a Bun project in the current directory
2. Runs `bun add` for the user's chosen system, setting, and craft
   defaults
3. Writes `world.json` (with `schemaVersion`, `embedding`, `kgPath`,
   plus user-facing flavor)
4. Creates `world.db` (or container) and runs the setting's canon-seed
   merge

The user could equivalently do this by hand with `bun init && bun add ...`
followed by `/agentic-rpg-init-world` invoking only steps 3-4. The
slash command is a convenience over the same Bun commands.

### Add content

```
bun add @karimn/ironsworn-delve --registry=https://npm.pkg.github.com
```

Or with the slash command wrapper:

```
/agentic-rpg-add @karimn/ironsworn-delve
```

Either way: Bun resolves the package, writes to `bun.lock` and
`node_modules`, the next world load picks it up. If a canon seed
ships with the package, the runtime offers to merge it into the world
DB on next load (with provenance tagged so a later removal can
optionally `--purge`).

### Update content

```
bun update
```

Bun handles version resolution against the world's declared ranges.
The next world load uses whatever Bun installed. Patches and minors
land transparently because that's what semver promises; majors that
break compatibility are caught by the schema-version check, not by a
version-range gate.

### Schema migration

If a content package's major version bump changes a data shape, the
runtime detects it on world load (the schema version stamped in
`world.json` or `character.json` is behind what the loaded code
expects) and prompts:

```
/agentic-rpg-migrate-world
```

The migration runner:

- Walks from the world's current schema version to the loaded code's
  current version
- Applies each registered migration in order (same append-only
  contract as v0.x)
- Snapshots the KG before any destructive step; rolls back atomically
  on failure
- Stamps the new schema version when done

Module authors ship migrations alongside any breaking schema change.
This is the only "version contract" the doc commits to — and it's
already the contract v0.x ships.

### Publish a world as a setting

```
/agentic-rpg-export-as-setting zura ./packages/setting-zura
```

Filters the world DB to `campaign_id IS NULL` entities + relations,
strips PC/party state, scaffolds a `setting-zura` npm package:

```
packages/setting-zura/
  package.json     # @karimn/setting-zura, peerDependencies: { @agentic-rpg/system-ironsworn: "^1.0.0" }
  seed/canon.json
  README.md
```

The player publishes to their npm registry of choice. Others install
with `bun add @karimn/setting-zura` and init worlds seeded from it.

### Embedding model — the one silent-corruption guard

If embeddings were written with model X and the active default is now
model Y, vector retrieval silently returns garbage. The runtime pins
`{ model, version, dim }` in `world.json` at init and refuses to load
on mismatch, offering either:

1. **Restore the original model** in the user's environment
2. **Re-embed** — recompute all entity and scene embeddings with the
   new model (one-shot migration; same snapshot-and-rollback discipline)

### KG path migration

Path A (Graphiti + FalkorDB) ↔ Path B (SQLite + sqlite-vec) is not
supported in place. Workflow:

1. `/agentic-rpg-export-world bundle.tar`
2. Init a fresh world on the desired path
3. `/agentic-rpg-import-world bundle.tar`

Bundle format is path-agnostic JSON; round-trip is lossy on backend-
specific features (e.g., bi-temporal edges flatten on Path B import).

### Summary — what's pinned, what's not

| What | Pinned where | Who manages it |
|---|---|---|
| Content package versions | `package.json` + `bun.lock` | Bun |
| `world.json` shape | `world.json.schemaVersion` | Migration runner |
| `character.json` shape | `character.json.schemaVersion` | Migration runner |
| DB schema | `_schema_migrations` table | Migration runner |
| Embedding model | `world.json.embedding` | Runtime (silent-corruption guard) |
| KG backend | `world.json.kgPath` | Runtime (not in-place switchable) |

That's the complete pinning surface. No `world.lock.json` (`bun.lock`
is the lock file). No `coreCompat`/`systemCompat`/`extends` ranges in a
custom manifest (`peerDependencies` is the constraint surface). No
three-namespace version story — just npm versions for packages plus
schema versions for migrations, governed by different concerns.

## Expansion system

Expansions are npm packages with `agenticRpg.kind: "expansion"` and a
`peerDependencies` constraint on the system they extend. They
contribute moves, oracles, assets, MCP tools, DB migrations, context
sections, skills, and optionally a canon seed. The v0.x expansion
design's *integration model* (load contributions into the scribe
namespace) carries forward; only the *discovery mechanism* changes
from `installed_plugins.json` scanning to importing from `node_modules`.

See `docs/design/expansion-system.md` for the contribution shapes and
migration namespacing — both unchanged.

### Licensing boundary

The licensing boundary is preserved end-to-end. **Expansions are rules,
not lore.** They don't go in the KG. They ship as npm packages,
distributed through whichever registry their license demands:

- Open / CC-BY content → public npm
- Paid / proprietary content → private npm registry (GitHub Packages,
  Verdaccio, npm Pro, etc.)

What an expansion contributes, mapped onto the three-store split:

| Contribution | Three-store layer | Where it stays |
|---|---|---|
| Moves, oracles, assets | Game-system (rules) | In the npm package |
| Skills | Craft | In the npm package; runtime surfaces them on activation |
| MCP tools, DB migrations, context sections | Technical | In the npm package; registered at load |
| **Canon seed** | World (after merge) | Merged into the world KG; player owns from then on |

Uninstalling the expansion (`bun remove`) removes the rules and tools.
Merged canon stays in the world DB by default (player owns it); a
`--purge` option removes canon tagged with that expansion's provenance.
Re-installing restores rules and tools without re-merging (idempotent
on entity ID).

A typical paid stack — Starforged + The Forge + Sundered Isles + open
craft + open runtime:

```jsonc
// the world's package.json
{
  "dependencies": {
    "@agentic-rpg/core":            "^1.0.0",   // open
    "@ironspike/system-starforged": "^1.0.0",   // paid, private registry
    "@ironspike/setting-forge":     "^1.0.0",   // paid, private registry
    "@ironspike/sundered-isles":    "^1.0.0",   // paid, private registry
    "@agentic-rpg/craft-default":   "^1.0.0"    // open
  }
}
```

Three packages from a private registry, two from public npm. The
runtime never reads the paid registry's source; Bun handles auth.

### What expansions cannot do

The boundary cuts both ways. An expansion **cannot**:

- Modify the world DB schema outside its namespaced migrations
- Override core retrieval tools (`recall`, `record_scene`, etc.) —
  only add new tools
- Contribute canon scoped to a specific campaign (seeds always merge
  as `campaign_id IS NULL`; per-campaign state is the player's to
  write through play)
- Reach into another expansion's namespace

These constraints keep expansions composable. Two expansions for the
same system should be installable together without contention; that
means neither can claim shared ground.

## The fiction-grounding protocol

Lives in the craft module as a skill. The GM agent must, before
introducing or narrating anything that might be canon, call:

1. `recall(query=<entity-or-concept>, kind?, limit=5)` — does this exist?
2. If multiple matches → disambiguate via aliases, then continue
3. If no match → free to invent; include the new entity in the beat's
   `entities` payload using the exact name chosen here
4. If match → narrate consistent with the recorded summary + relations
5. `record_beat(...)` carrying `entities` (new canon this beat establishes,
   using exact grounded names) and `relations` (links the beat asserts);
   a beat that establishes a new entity or relationship **must** carry it

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

Tracked separately. Major pieces (✅ = landed, 🚧 = partially landed,
❌ = not started). As of 2026-06-21: #2, #3 landed; #1 partial; #4–#11
not started.

1. 🚧 Refactor the public repo into a Bun workspace monorepo:
   `packages/core` + `packages/system-ironsworn` +
   `packages/setting-ironlands` + `packages/craft-default`. The CC
   plugin shrinks to just the runtime shim (MCP wiring, default
   skills, slash commands); all logic and content moves into npm
   packages under the `@agentic-rpg/*` scope.
   *#169 extracted `@agentic-rpg/core` (all persistence + rules logic)
   and reduced the scribe package to an MCP shim. The
   system/setting/craft package splits remain.*
2. ✅ Resolve #166 (PR #169): unify lore.duckdb + scenes.duckdb +
   npcs/*.json into one `world.duckdb`; introduce `campaign_id` column;
   embedding-model pin in `world.json`; CLI-gated migration. See
   `docs/design/world-db.md`.
3. ✅ Implement the Path A vs Path B spike; commit to one. *(#166 shipped
   on the current DuckDB substrate — effectively Path B with DuckDB;
   the spike decides whether to port.)* **Resolved 2026-06-16: committed
   to Path B (DuckDB); Path A storage rejected.**
4. ❌ Implement the setting-seed-at-world-init mechanism; package the
   Ironlands canon as `@agentic-rpg/setting-ironlands`. Verify a fresh
   world with no setting installed boots cleanly with no seed.
5. ❌ Move existing skills into `@agentic-rpg/craft-default`; verify they
   don't leak system-specific tool names.
6. ❌ Implement `recall` as the unified retrieval tool; deprecate the v0.x
   split.
7. ❌ Add per-tool retrieval budgets; tune.
8. ❌ Implement the canonize slash command; integrate with `extract_session_lore`.
9. ❌ Implement the future-proofing extension points (coordinates convention,
   bulk ops, `near` parameter union, `procgen` manifest type, `tick`
   primitive). Each is small individually; together they make v1.0 the
   architecture-stable target.
10. ❌ Repackage the v0.x Delve expansion as `@karimn/ironsworn-delve` (or
    similar) on a private registry; verify install via `bun add` works
    end-to-end with the new contribution mechanism.
11. ❌ Move player-directive content out of CC memory into runtime-owned
    `preferences.md` files (world + per-campaign). Implement
    `remember(scope, note)` MCP tool. Read existing `.remember/`
    directories and project-level `CLAUDE.md` files into
    `worlds/<world>/preferences.md` with a `## Migrated from CC memory`
    heading, one-shot.

## Decisions (settled)

### Knowledge model

- **D1** Three knowledge stores, not one: game-system, craft, world.
  Only the world is the KG.
- **D2** Setting canon seeds the world DB at world-init; from then on
  it's just world knowledge. The system module ships rules; the setting
  module ships canon — never the same package.
- **D3** One world DB, campaign as a column (#166). Visibility filter on
  every read. Canon promotion is one column flip.
- **D7** Character state stays on disk as `character.json`, not in the
  KG.

### Conceptual modularity

- **D4** Four conceptual modularity levels (system, setting, world,
  campaign). The runtime core is system- and setting-agnostic.
- **D4b** Settings are first-class modules, separable from systems.
  Multiple worlds can share a setting. A mature world can be
  re-packaged as a setting for republication.
- **D5** Craft is system-agnostic by default. Optional system-flavored
  craft modules stack additively.
- **D14** A world is bound to its system + setting at init. Mid-life
  swaps are not supported. Worlds are cheap; start a new world if you
  want to switch.

### Runtime vs frontend

- **D20** The runtime is the product. The CC plugin is the v1.0
  frontend, not the platform. No CC-specific assumptions in runtime
  code; skills are content, not behavior; slash commands are frontend
  ergonomics over runtime actions.
- **D21** Alternate frontends (web app, desktop app, mobile app) are
  anticipated but explicitly out of scope for v1.0.

### Distribution and packaging

- **D22** One CC plugin (`agentic-rpg`) ships the runtime. All content
  (systems, settings, craft, expansions) ships as npm packages under
  `@agentic-rpg/*` or a publisher's own scope.
- **D23** A world is a Bun project directory: `package.json` declares
  content, `bun.lock` records resolved versions, `node_modules` holds
  installed packages. The runtime imports from `node_modules` —
  no custom discovery mechanism.
- **D24** Inter-module compatibility is expressed via standard
  `peerDependencies` in each package's `package.json`. No custom
  manifest format, no `coreCompat`/`systemCompat`/`extends` ranges in
  a separate file. Bun's resolver enforces.
- **D25** Licensing boundary is expressed via npm registry
  configuration: public scope on public npm; paid content on private
  registries the user has auth for.

### Tool surface and retrieval

- **D6** One tool per query pattern (`recall`, not six search tools).
  Per-tool retrieval budgets enforced at boundary.

### Storage

- **D8** Path A (Graphiti + FalkorDB) vs Path B (SQLite + sqlite-vec)
  decided by spike, not by argument. **Decided (2026-06-16): Path B**
  (embedded store, shipped as DuckDB). FalkorDB rejected (mandatory
  server vs. Goal #1; Graphiti's embedded Kuzu backend archived &
  deprecated). Graphiti's *extraction approach* adopted into the DuckDB
  extractor; see `docs/spikes/2026-06-graphiti.md`.

### Versioning and migration

- **D26** Three things are pinned in `world.json` because npm can't
  reasonably express them: `schemaVersion`, `embedding` (model name +
  version + dim), and `kgPath`. Everything else (which package
  versions are loaded) is Bun's responsibility.
- **D16** Embedding model mismatch on world load is a hard refuse,
  with a re-embed migration offered. Vector retrieval is silently
  wrong otherwise; this can't be left implicit. *Implemented in #169:
  `world.json` pins `{ model, version, dim }`; the server refuses to
  start on mismatch.*
- **D27** Migrations are the only "compatibility contract" the
  runtime enforces. Each migration is version-tagged
  (`fromVersion`/`toVersion`); the migration runner walks from the
  world's current shape to the loaded code's expected shape; failure
  is rolled back via snapshot. Append-only, never edit existing
  migrations. Same contract as v0.x, carried forward.

### Future-proofing

- **D9** Spatial coordinates are an entity-metadata convention, not a
  first-class column. Core stores them; modules interpret them.
- **D10** Per-campaign overlay state lives as relations with
  `campaign_id = current`, not in a side table.
- **D11** Bulk operations, spatial `near` parameter shape, `procgen`
  manifest type, and `tick` primitive ship in v1.0 as extension
  scaffolding. Cheap now, expensive to retrofit.

### Expansion specifics

- **D17** Expansion canon merged into a world stays after `bun remove`
  by default (player owns it). `--purge` removes only canon tagged
  with that expansion's provenance.

### Player directives

- **D28** Player out-of-game directives ("/remember" content — narration
  preferences, GM behavior cues, table-talk constraints) live in
  runtime-owned `preferences.md` files at world and campaign scope. The
  `remember(scope, note)` MCP tool writes them; the GM context builder
  always loads them. This pulls the behavior out of CC's memory store
  so any frontend gets it.

## Open questions

- **OQ1** Spike outcome (Path A vs Path B) — decides storage backend.
  **Resolved (2026-06-16): Path B.**
- **OQ2** Should `world.json` itself live in the KG as a single
  `type='world'` entity? Cleaner uniformity, but adds a special case to
  the visibility filter. Default: stays as a file. Revisit if it
  accumulates enough properties to feel awkward as JSON.
- **OQ3** Cross-world canon (e.g., a shared "fantasy commons" of
  generic tropes some players want pre-loaded). Skipped for v1.0.
- **OQ4** Multi-character campaigns (one party, multiple PCs).
  Character state shape would need to be pluralized. Tracked
  separately if pursued.
- **OQ5** A canonize ritual UX: slash command, end-of-session prompt,
  or implicit on high-confidence extraction. Probably explicit slash
  command. Settle when implementing.
- ~~**OQ6** Should overlay-state relations anchor on the PC entity or on
  a synthetic `party` entity?~~ **Resolved (#169):** anchors on the PC
  entity. A `party` generalization is deferred with multi-PC support
  (OQ4).
- **OQ7** Should `tick` events be pub/sub or polled? Default to
  polling for v1.0.
- **OQ11** What shape should the future alternate UI take (Electron,
  Tauri, web app, native mobile)? Out of scope for v1.0; flagged so
  that runtime decisions don't accidentally constrain it.
  - **Candidate substrate:** [Hermes Agent](https://hermes-agent.nousresearch.com/)
    (Nous Research, MIT) is a general-purpose agent runtime that solves
    multi-platform dispatch (Discord/Slack/Telegram/WhatsApp/Signal/
    Email/CLI), persistent memory + auto-generated skills, subagent
    parallelization, sandboxed tool execution, and natural-language
    scheduled automations out of the box. Adopting it would be a
    frontend-level decision; our runtime stays domain-pure. Most
    immediately interesting bits for us are multi-platform play
    (Ironsworn over Discord) and scheduled automations (between-session
    world clocks, faction turns — the sandbox-campaign future work).
- **OQ12** Does Bun's `peerDependencies` handling produce clear-enough
  error messages for non-developer users when a peer constraint isn't
  satisfied (e.g., a setting requires a system the user hasn't
  installed)? If not, the `/agentic-rpg-add` wrapper needs to pre-flight
  the install and surface a friendly error before calling `bun add`.

## Why this is v1.0

v0.x evolved by accretion: each feature was added without challenging
whether it belonged in the layer that grew it. By v0.18 we had three
parallel stores, system-specific names baked into shared retrieval
tools, and a versioning story that tried to make CC plugins do
dependency-graph work they aren't built for.

v1.0 cuts cleanly in three places:

1. **Knowledge by kind.** System (rules), craft (skills), world (KG).
   Only the world is dynamic; the others are content shipped with
   modules. The KG's discipline doesn't apply to the others.
2. **Runtime vs frontend.** The runtime is the product. CC is the v1.0
   frontend; alternate frontends are anticipated. The runtime contains
   no CC assumptions.
3. **Bun owns packages; we own schemas.** Content distribution,
   version resolution, lock files, peer-dep enforcement — all Bun.
   The runtime owns the few things npm can't reasonably express
   (schema versions, embedding-model pin, KG backend pin) and the
   migration runner that walks shapes forward when packages bump.

It's the version where:

- Adding Cairn or Trophy Gold is a `package.json` + data exercise
- Publishing a homebrew setting is an export + `npm publish`
- A paid system plus a paid setting plus a paid expansion plus a free
  craft module compose with `bun install`
- Stripping CC from the loop, when that day comes, is a frontend
  rewrite — not a runtime rewrite
