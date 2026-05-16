# Escalation Curve — Small → Medium → Large Across a Session

The size of a complication should match the size of the moment. A small early-session miss should not threaten the campaign; a late-session climactic miss should not cost a wineskin. This file is the curve.

Two principles from the rulebook:

- *"Pay the Price"* costs should be appropriate to the move (rulebook p.117): a Strike miss costs less than an End the Fight miss; a Fulfill Your Vow miss costs more than an Undertake a Journey miss.
- *"For dramatic moments and decisive moves, up the stakes"* (p.117).

---

## The Three Sizes

### Small (most misses, most of the time)

**Texture:** flat mechanical cost, one sensory detail, no new threads.

**Costs:**
- −1 supply (wineskin frozen, snares empty)
- −1 momentum (lost the thread, slipped grip)
- Lose progress (ground re-covered, foe shrugs off the wound)
- Minor harm (1 harm — twisted ankle, shallow cut)
- Equipment degraded (chipped blade, slack bowstring, lantern out of oil)
- Time lost (a waypoint of bad weather)

**When:** any non-dramatic miss; weak hits with cost; matches on minor moves; routine Pay the Price. The diversity protocol still applies — rotate categories — but the cost stays small.

### Medium (the session's middle, escalation moves)

**Texture:** escalate an existing thread; introduce friction with a known NPC; force a hard mechanical cost.

**Costs:**
- 2 harm or stress (the wound that doesn't heal cleanly)
- A debility (wounded, shaken, encumbered) via `ironsworn-suffer`
- Lose multiple supply or significant track progress
- A bonded NPC's loyalty cracks (re-enter `ironsworn-npc-voice`, `ironsworn-social`)
- An old enemy reappears (reuse a closed thread, don't invent)
- A factional consequence — a hold closes its gates, a jarl turns, a debt is called
- A vow's situation worsens — milestones harder to reach without addressing the new pressure

**When:** mid-session pressure builds; a major move misses (Battle weak, Compel miss, Forge a Bond miss with a key NPC); a match on a meaningful move.

### Large (climactic, dire, campaign-altering)

**Texture:** the world changes shape. Reserve for end-of-session, decisive misses, matched 10s on a miss (rulebook p.9 — *"as bad as things get"*).

**Costs:**
- Vow goes toward forsake (defer to `ironsworn-progress-tracks`)
- Out of Action / Face Death / Face Desolation (defer to `ironsworn-suffer`)
- A campaign thread breaks open — the secret revealed, the betrayal seen, the truth turned
- A bonded NPC dies, leaves, or turns
- A faction war breaks
- A region of the campaign closes off (the Deep Wilds will not let you back in)

**When:**
- Match on a miss with matched 10s (rulebook p.9)
- Miss on End the Fight against a high-rank foe
- Miss on Fulfill Your Vow at the climax
- Miss on Face Death / Face Desolation
- A 99–00 roll on the Pay the Price d100

---

## A Worked Session Arc

A four-hour session where the player's vow is to recover a stolen relic from a Mire-Holtfolk holdfast.

### Early (small)

- **Undertake a Journey** miss → −1 supply + texture: the wineskin froze and split overnight. (Weather/supply category, no new threads.)
- **Resupply** weak hit at a hunter's camp → −1 supply: the snares are empty; tracks indicate something larger walked through. (Plants the next mid-session beat.)

### Middle (medium)

- **Compel** miss with the holdfast elder → escalate the existing "Debt to the Mire-Holtfolk" thread: the elder produces a tally-stick. The price of help is the price you've been avoiding. (Social/debt category; thread escalation.)
- **Strike** weak hit in a skirmish with a holdfolk warrior → 1 harm + texture: the ally — the bonded one — takes the cut meant for you. Now there are two bodies bleeding on the floor. (Defer mutation to `ironsworn-suffer`; lands on the bonded NPC.)

### Climactic (large)

- **End the Fight** miss with matched dice against the holdfast's champion → Pay the Price *severe* (rulebook p.94, Fight): roll on the Pay the Price d100, get 99–00 (roll twice). The two results layer:
  - The relic shatters in the struggle (something of value lost).
  - The bonded ally Faces Death (defer to `ironsworn-suffer`).

The vow's shape changes. Even if the player survives, the relic is gone; the path forward is to mourn or to invent something new. The session has earned its weight by walking the arc — small → medium → large — instead of stacking apocalypses on small misses.

---

## Anti-Patterns

- **Stacking large complications.** Two large misses in close succession compresses the campaign. Pace them — three small + one medium + one large is a session shape; large + large is an ending.
- **Skipping the small.** If every miss is medium-or-larger, the world feels relentless and the player learns to brace against everything, not feel anything.
- **Ignoring the rank of the move.** A Strike miss is not an End the Fight miss. The rulebook's per-move guidance (e.g., the **Fight** move at p.94) explicitly says *"Make it hurt"* on Fight misses but not on Strike misses. Honor the difference.
- **Climaxing too early.** The first miss of a session shouldn't break the campaign. Save the matched 10s, the Face Death triggers, the thread-breaking revelations for when the fiction has earned them.

---

## Cross-Links

- **Mechanical mutation** — `ironsworn-suffer`. This skill never calls `suffer_harm` directly.
- **Vow-level consequences** — `ironsworn-progress-tracks` (forsake, recommit).
- **Pacing the arc** — `ironsworn-pacing` (when to scene-frame the small cost vs. absorb into montage; large complications usually demand a scene).
- **Texture in scene** — `ironsworn-scene-craft` (one-sense rendering, no "you feel," etc.).
- **NPC-as-complication** — `ironsworn-npc-voice` for delivery when the cost is *who* responds, not *what* happens.
