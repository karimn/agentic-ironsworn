# Complication Palette & Pay the Price Translation

This file is the **menu of thematic categories** to rotate through, plus how to translate the rulebook's Pay the Price d100 (page 105/116) into a textured fiction beat. The protocol's enforcement lives in `agents/ironsworn-gm.md`; this is the craft side.

---

## The Palette (rotate among these — none is exhaustive)

The GM agent's master list (lines ~163-175) is the source of truth. Reproduced here for craft reference only — pull from your campaign's world truths to add categories specific to your setting.

| Category | What it draws from | Example beat |
|---|---|---|
| **Weather / cold / exhaustion** | The land as antagonist | A wineskin frozen and split; sleet driving sideways into the hood; the warmth in the limbs draining away faster than expected |
| **Beasts / wildlife** | Natural or corrupted fauna | Tracks in fresh snow that don't match anything you know; a horse refusing to enter a clearing; something following at the treeline that won't be seen |
| **Supernatural threats** | World-truth darkness | A wound that doesn't bleed; words spoken in sleep that aren't yours; iron suddenly cold to the touch where it shouldn't be |
| **Political / factional** | Rival communities, jarls, holds | A rider arrives ahead of you with the news already; a name on a tally-stick in a strongbox; a closed gate that should have been open |
| **Ancient infrastructure** | Old roads, ruins, unstable structures | A bridge that gives under weight that shouldn't have been a problem; a flooded shaft; carvings that move when looked at directly |
| **Plain physical hazard** | Injury, terrain, structural collapse | A turned ankle on scree; a horse going lame; a rope fraying at the knot |
| **Interpersonal / social** | Mistrust, conflicting goals, grudges | The bonded ally going quiet; an old slight surfacing under stress; a kept secret leaking |
| **Supply / resource scarcity** | Hunger, exhaustion, broken gear | Empty snares; arrow shafts shattered; the map page wet through |
| **Isolation / disorientation** | Lost, cut off, no help coming | The trail simply stops; a fog that doesn't lift; a settlement that should be there isn't |

When in doubt, pick the category least-represented in `get_recent_complications` (k=5).

---

## Translating the Pay the Price d100 (rulebook p.105 / p.116)

Each entry in the table is a **category abstraction** — translate through campaign theme and lore. Always pair the translation with `search_lore_global` (theme) and either `search_lore` (specific names) or `list_threads` (open business).

| Roll | Category | Translation pattern |
|---|---|---|
| 1-2 | Worse + roll again | Stack two table results, the second worse than the first. Reserve for genuinely dire moments — combat misses, decisive failures. |
| 3-5 | Trust lost | A bonded NPC, a holdfolk, a faction turns. Pull from `search_lore` for who; `list_threads` for the betrayal that fits. |
| 6-9 | Ally in danger | Companion, bonded NPC, or known third party. Use the actual name from lore — never "an ally." |
| 10-16 | Separated | Lost from the group; cut off from a resource; the path closes behind. Tie to terrain or faction if possible. |
| 17-23 | Unintended effect | The right action with the wrong consequence. The fire kept the cold off but drew something. |
| 24-32 | Something lost or destroyed | An asset, a keepsake, a written record. Make it specific from the character sheet, not generic. |
| 33-41 | Situation worsens | Whatever pressure was already in the scene increases by a step. Storm becomes blizzard; argument becomes accusation. |
| 42-50 | New danger or foe | The hardest box to fill responsibly — `list_threads` first; reuse a foe before inventing one. |
| 51-59 | Delay / disadvantage | Time lost, position lost, posture lost. Translates well into momentum drops or progress not gained. |
| 60-68 | Harmful | Defer mutation to `ironsworn-suffer`. Render the wound — the texture, the wrongness, the cold. Not "you take 1 harm." |
| 69-77 | Stressful | Fear, despair, fatigue. Defer to `ironsworn-suffer`. Show what cracks — the prayer that doesn't come, the hand that won't stop shaking. |
| 78-85 | Surprising development | A revelation that changes the shape of the scene. Best when grounded in lore (`search_lore_global`). |
| 86-90 | Wastes resources | Supply, momentum, gear. Render the loss — the wineskin, the cracked haft, the spilled rations. |
| 91-94 | Acts against intentions | A choice forced by the moment that the character would not have made. Excellent for moral compromise beats. |
| 95-98 | Friend/companion/ally in harm's way | Use a specific name from lore. If alone, it lands on the character — but `search_lore` first for any companion or bonded NPC nearby. |
| 99-00 | Roll twice; both occur | Reserve for matched 10s on a miss (rulebook p.9 — "as bad as things get"). Layer two complications from different categories — diversity built-in. |

**Rule of thumb:** translate the abstract into one specific sensory detail tied to a named entity from lore. *"It is harmful"* is paperwork; *"the bonded ally, exhausted, lashes out — a wounding word that sticks"* is play.

---

## Match Handling (rulebook p.9, p.117)

Matched challenge dice on:

- **Strong hit** → twist, opportunity, unexpected turn. Not always a complication — sometimes a gift with a hook.
- **Weak hit / miss** → heightened complication, new danger, *worse* than a normal miss. The rulebook recommends **rolling on the Pay the Price table** (rather than choosing) to surface a result you wouldn't have picked.
- **Matched 10s on a miss** → *"as bad as things get"* (p.9). A campaign-altering complication: a vow goes toward forsake, Face Death triggers, a major thread breaks open.

If matches feel routine, the rulebook's optional rule (p.231) restricts match-effects to even-numbered matches. Note this preference once and stay consistent.

---

## Worked Translations

**Example 1 — Undertake a Journey miss, d100 = 64 ("It is harmful"), recent complications: weather, weather, beast.**

- `search_lore_global` returns a cluster on oath-debt and corrupted fauna.
- `list_threads` returns "Debt to the Mire-Holtfolk" (open, 3 sessions old) — not what the harm is *about*, but in scope.
- Diversity check: weather is over-used; beast is recent. Pick **supernatural-corruption** (a category from world truths).
- Translation: the cold isn't cold — it's *wrong* cold. The fingers go numb in the wrong order. A scratch from a thorn doesn't bleed.
- Mechanical: defer to `ironsworn-suffer` → `suffer_harm(1)`.
- `record_scene` `complication_theme: "supernatural-corruption"`.

**Example 2 — Compel miss, d100 = 03 ("trust lost"), recent complications: weather, supply, supply.**

- `search_lore` for the elder being compelled returns a long history with the character.
- `list_threads` shows "Debt to the Mire-Holtfolk" — same thread can carry this beat.
- Diversity check: supply is over-used; social is fresh. Use **interpersonal**.
- Translation: the elder doesn't refuse — she sets a tally-stick on the table, your name on it. The price of her help is the price you've been avoiding.
- Mechanical: no direct mutation; the open thread escalates.
- `record_scene` `complication_theme: "debt-economy"`.

**Example 3 — Strike miss with matched 10s, d100 = 99 ("roll twice; both occur").**

- This is the dire-moment branch. Roll twice → 47 (new danger) and 67 (harmful).
- `search_lore` surfaces a foe from a closed thread three sessions ago, never definitively killed.
- Diversity check: combine categories — the new danger is **factional**, the harm is **physical** but *also* signals supernatural-corruption (the foe should be dead).
- Translation: the blade slips past your guard — a shallow cut that burns wrong. From the trees, a second figure steps out: the raider you thought you'd buried, walking again.
- Mechanical: `ironsworn-suffer` → `suffer_harm(1)`; reopen the thread; consider rank escalation on the foe.
- `record_scene` with the dominant theme — likely `complication_theme: "supernatural-corruption"`, with a secondary note in the scene body about factional reappearance.

---

## NPC-as-Consequence (when an NPC is onstage)

When the missed move is *aimed at an NPC* (Compel, Forge a Bond, Test Your Bond, Aid Your Ally), the NPC's drives often *are* the complication shape — reach there before the abstract palette. `ironsworn-npc-voice` is the source of truth for drive-shaped delivery; this skill names the discipline.

**Example — Compel miss against a holdfast diplomat whose drive is "preserve appearances at any cost."**

- `search_lore` returns the diplomat (drive: preserve appearances) and a closed thread "The Holtfen Compromise" — half-spoken, never settled.
- `get_recent_complications`: factional, factional, weather. Social is fresh.
- The consequence shape *is* the drive: the diplomat does not refuse, does not yield, does not budge. The form they take is itself the cost — every hour spent here is an hour your vow doesn't progress, and they will let you sit through it.
- Mechanical: defer to `ironsworn-suffer` → `suffer_stress(2)` (the slow grind of unmoved formality), and open a debt thread for the favor implicit in the room.
- `record_scene` `complication_theme: "interpersonal"`.

The d100 table is *not* the first place to look here. The drive is. Texture follows from voice (`ironsworn-npc-voice`) before it follows from category.

**Weak-hit "ask in return" (rulebook p.80) follows the same rule.** A Compel weak hit where the NPC asks a favor must echo their drives — a war-jarl asks for steel, a holtfen elder asks for a tally settled, a bonded healer asks for the truth told. Generic asks ("they want a favor, TBD") are paperwork. Open the debt thread; close the loop in the next scene.
