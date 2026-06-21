# Curation principles for `fixtures/golden.yaml`

`golden.yaml` is the **executable spec of "good extraction"** for the Zura
corpus. It was produced by running `bootstrap.ts` over `fixtures/selection.txt`
to get a draft of the current extractor's output, then hand-correcting that
draft. `score.ts` measures the live pipeline against it. This file records the
*judgment calls* behind the labels so the next curator (or a later expansion of
the set) stays consistent instead of drifting.

The corpus is 24 real Zura scenes (`selection.txt`), chosen for scene-shape and
entity-type diversity with a contiguous **supersedes sub-sequence** (the Caldren
arc, scenes 23→35).

## Pruning stance: strict

The golden set contains only **load-bearing narrative entities** — the people,
places, creatures, objects, vows, events, world-truths, and named phenomena the
fiction actually turns on.

**The line that matters:** a *named world phenomenon or truth* is lore even when
it is abstract. `The Answering` (the curse answering broken vows), `Waking
Darkness`, and `Iron-Memory Circle` are KEPT — `The Answering` in particular is
inseparable from the `Broken Ironbinder Vow` truth it manifests through. Do NOT
prune an abstraction just because it has no physical form; prune only what is not
lore at all. What is not lore:

- **Game-mechanic artifacts.** Move names and progress-track bookkeeping. Deleted:
  `Draw the Circle`, `End the Fight` (`Caldren's Duel End`),
  `Caldren's Combat Track Maxed`. The extractor emitting these is over-extraction
  and is *correctly* penalized as false positives against this golden set.
- **Empty phrasings** with no concrete or named referent — a turn of phrase the
  extractor mistook for an entity: `Clean Transfer` ("a clean transfer"),
  `Circuit Breaking` ("breaking the circuit from inside" — a tactic, not a thing),
  `Ashfen Debt` (redundant with `Harvest Debt` / `Ashfen Harvest Vow`).
- **Process-events** with no standalone weight: `Separation at the Track`,
  `Lona and Zura's Northward Ride`, `Circuit Eight Winters Ago`. The underlying
  fact is kept as a *relation* (e.g. `Zura SEPARATED_FROM Arda`) where it matters.
- **Unnamed atmospheric figures**: `Lona's Mother`.

The earlier draft over-pruned here, deleting `The Answering` and `Waking
Darkness` as "vague concepts." That was wrong: a named phenomenon tied to a
world-truth is load-bearing. The test is *named + consequential*, not *concrete*.

A concrete, named event IS kept (`Root-Cellar Fire`, `Caldren's Circle Duel`,
`Caldren's Banishment`, `Joint Iron Vow Fulfilled`, `Birch Stand Assassination`).

## Type judgments

- `Ashfen` and `Holtfen` are **places** (settlements), not people — the draft
  mistyped both as `person`.
- `Grey` is Zura's wolf — a **creature**, not a `person`. The draft also bolted a
  spurious `greyhollow` alias onto Grey; Greyhollow (the cursed homeland) is a
  distinct concept and that alias was removed.
- Vows/objectives → `thread`. World-facts the fiction asserts as true (the broken
  Ironbinder vow, the anchor-network collapse) → `truth`. Named abstractions with
  no physical form (a sword lineage, the debt-signature) → `concept`. Physical
  objects (tags, nails, the iron map, the bone token) → `material`.

## When two mentions are one entity (alias, not a second entity)

Merged in the draft:

- `Lago` + `Lago Rhian` → **Lago Rhian** (aliases `the Hollow One`, `Lago`,
  `Father`). One person: Zura's father.
- `Lago's Companion` + `Serin` → **Serin** — scene 58 states Serin *is* Lago's
  companion.
- `The Hound` + `Grey` → **Grey**.
- `Holtfen` (person) + `Holtfen Settlement` → **Holtfen Settlement**.
- `The Settlement` → folded into **Ashfen** (it is the Ashfen community before
  relocation).

Rule of thumb: merge when the texts clearly co-refer; keep separate when an
overlap is only thematic (e.g. `Captain's Tag` the object vs. `Lona's Captaincy`
the role — kept distinct, both are referenced as separate things).

## The supersedes / temporal case

The whole arc 23→35 exists to exercise temporal correctness. The extractor
**failed to detect it**: the draft had *zero* invalidated relations and never
even created a `Caldren` person (only derived nouns like `Caldren's Wardenship`).
Curation encodes the correct answer:

- Added `Caldren` (person).
- `Caldren HOLDS_TITLE Holtfen Settlement` — `invalidated: true`
- `Caldren LOCATED_IN Holtfen Settlement` — `invalidated: true`
  (both superseded by his banishment in scene 35)

No new `LOCATED_IN` is added for Caldren after banishment: scene 35 has him
"walked west to the old Ashfen road … return on pain of death" — i.e. escorted
to the territory's edge and exiled, not relocated to a new home. An earlier draft
wrongly added `Caldren LOCATED_IN Ashfen`; that was a misreading and was removed.

So the baseline temporal score is expected to be `0/2`: the current pipeline
neither extracts Caldren nor detects the supersedes. That is the point — the eval
documents the weakness and will reward the future change that fixes it.

## Which relations are worth recording

Relations that carry a fact the fiction depends on: who holds a title, who is
located where, who is bound by which vow, parentage, alliances, what an object
does. Incidental adjacency and one-off interactions were dropped. Redundant
relations were collapsed (e.g. the draft's `PARENT_OF` was dropped in favour of
`FATHER_OF`; a duplicate `Lona SEEKS Ewa` folded into `SEEKS_RESTORATION_FOR`).

Label vocabulary is the extractor's own, lightly normalized; `score.ts`'s
`LABEL_SYNONYMS` map handles the few interchangeable pairs (e.g. `SERVES ≈
MEMBER_OF`). Prefer fixing the extractor's labels over widening that map.
