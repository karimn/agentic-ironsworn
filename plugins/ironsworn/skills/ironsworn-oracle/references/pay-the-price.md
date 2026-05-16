# Pay the Price — Discipline & Palette

Full procedures and worked examples. The main `ironsworn-oracle` SKILL.md links here.

---

## The Discipline (preference order)

Run this list **top-down**. Stop at the first option that genuinely serves the fiction.

### 1. Flat mechanical cost (default)

A miss should hurt. Most misses end here. No new plot, no escalation — just a cost paid.

| Cost | Example |
|---|---|
| −1 supply | wineskin froze and split; arrow shafts shattered against frozen ground |
| −1 momentum | wasted effort; lost the thread of an argument; tactical setback |
| Lose progress | ground covered must be re-covered; trust eroded; the foe shrugs off the wound |
| Minor harm (suffer 1) | twisted ankle; shallow cut; deep cold |
| Equipment degraded | bowstring slackened; blade chipped; lantern out of oil |
| Time lost | a waypoint of bad weather; a wasted day waiting out a storm |

Flat costs are **invisible** to the meta-narrative. They accumulate weight without crowding the world with new threads.

**Applying the cost.** Pay the Price picks *what* — `ironsworn-suffer` picks *how*. When the chosen cost is harm, stress, a supply drain, or a debility, defer to `ironsworn-suffer` for the matching tool call (`suffer_harm`, `suffer_stress`, `consume_supply`, `inflict_debility`). Don't apply those mutations from this skill. Note that Face Death / Face Desolation are triggered from the **Endure Harm** / **Endure Stress** oracle tables (the 1–10 result), not directly from Pay the Price — both are owned by `ironsworn-suffer`.

### 2. Escalate an existing thread

Before inventing anything new, scan open threads. The world has unfinished business.

**Scan first:** `list_threads` (open status) or `search_scenes` for recent recurring entities. Pick something the current beat can plausibly worsen.

Examples:
- A forgotten debt comes due (an open thread named "The Bargain at Holtfen" surfaces here).
- An old enemy reappears (the wounded raider from three sessions ago, healed and angrier).
- An ally's loyalty cracks (the bonded NPC's hidden grudge surfaces under stress).
- A condition the character has been ignoring sharpens (the wound that wouldn't heal, the dream that recurs).

Escalation is **richer than invention** because it deepens what already exists. The campaign feels alive because old beats keep coming back.

### 3. Introduce a new narrative hook (rarely)

**Budget: 0–1 new threads per session.** Exceed only when the campaign is genuinely thin (early sessions, or after a major arc resolution).

Before inventing, ask:

1. Did I scan open threads? Was there really *nothing* I could escalate?
2. Would a flat cost be more honest to this fiction?
3. Will I be ready to advance this hook next session, or is it just noise?

If the answer to any is "no" or "yes (flat cost is better)," fall back. New hooks are commitments — they obligate future play.

**Making the new hook durable.** When invention *is* warranted — typically when the oracle (or the fiction) surfaces an implicit promise the player owes someone ("they ask something of you in return," a debt, a half-spoken oath) — make the obligation persistent so it doesn't evaporate in memory. Open a thread: `open_thread` with kind `debt` (favor owed) or `vow` (rises to an Iron Vow). The canonical pattern, including how the social moves (Compel weak, Forge a Bond weak, Test Your Bond weak) instantiate it, lives in `ironsworn-social/references/moves.md` — defer there rather than restating it here.

---

## When to Choose vs. When to Roll

You may **choose** a Pay the Price consequence directly, or `roll_oracle` "Pay the Price" for the random table. Default to choosing — the fiction usually points clearly at one cost.

**Roll the Pay the Price table when:**

- You're stuck — nothing in the fiction clearly suggests a cost.
- You want to surprise yourself — the cost might be sharper than what you'd invent.
- Recent complications have all been your own picks and you want to break out of a rut.

**Choose directly when:**

- The fiction obviously points at one cost (combat miss → harm; journey miss → supply or weather).
- You're escalating an existing thread (the table can't know about your thread).
- You've already decided on flat mechanical cost.

When you do roll, treat the result as a *prompt*, not a literal command — the table speaks in abstractions ("It is harmful," "It causes a delay") that you translate into concrete fiction.

---

## Pay the Price Table — Interpretation

The d100 table (in `roll_oracle` "Pay the Price") gives outcomes like:

- *"A new danger or foe is revealed"*
- *"It is harmful"*
- *"The current situation worsens"*
- *"It wastes resources"*
- *"A friend, companion, or ally is put in harm's way"*

Each is a **category**, not a script. Translate through the campaign's themes:

1. Roll → category.
2. Call `search_lore_global` for thematic context.
3. Call `get_recent_complications` for diversity check.
4. Pick a fresh angle within the category — and within an under-used theme from the palette.
5. Narrate.

Example: roll 60–68 *"It is harmful."* Recent complications have been weather-heavy; the GM agent's palette suggests rotating to interpersonal/social or supernatural. Lore search surfaces the bonded NPC and an unresolved tension. The "harm" lands as: the bonded ally, exhausted from the journey, lashes out — a wounding word that sticks. Mechanical cost: suffer 1 stress. Narrative cost: a thread to revisit, not a new one created from scratch.

---

## Complication Diversity Protocol (cross-link)

The protocol and palette live in `agents/ironsworn-gm.md`. **Do not duplicate** the palette here.

Required steps before narration:

1. `get_recent_complications` (k=5) — note repeated `complication_theme` values.
2. Pick a category from the palette that has *not* dominated recent history.
3. Narrate.
4. `record_scene` with `complication_theme` set to the category you used.

The palette is open — it grows from world truths. Use the truths your campaign established, not a generic list.

---

## Worked Examples

**Example 1 — Resupply miss in deep wilds.**
- Recent complications: weather, weather, beast.
- Lore: campaign emphasizes oath-debt and corrupted wildlife.
- Choice: flat cost — −1 supply (already implicit in the move's miss).
- Narration: "The snares are sprung but empty. Something larger walked through and took your catch — tracks deep, wrong-shaped. You don't follow."
- `record_scene` with `complication_theme: "supernatural-corruption"` (a category drawn from world truths, not on the default palette).

**Example 2 — Compel miss against a holtfolk elder.**
- Open threads: "Debt to the Mire-Holtfolk" (3 sessions old).
- Choice: escalate the existing thread.
- Narration: "The elder doesn't refuse you. She walks to a strongbox, sets a tally-stick on the table — your name, your debt — and waits. The price of her help is the price you've been avoiding."
- Mechanical cost: none directly; but the thread now demands resolution.
- `record_scene` with `complication_theme: "debt-economy"`.

**Example 3 — Combat miss, wounded raider.**
- Recent complications: social, debt, social.
- Lore: corrupted-beast theme is under-used.
- Choice: flat cost + light fictional escalation.
- Narration: "Their blade slips past your guard — a shallow cut, but the wound burns wrong, like cold and rot at once."
- Mechanical: suffer 1 harm + open question of whether the foe is corrupted (next scene's discovery).
- `record_scene` with `complication_theme: "supernatural-corruption"`.

---

## Common Mistakes

- **Inventing a new thread when an old one fits.** Always scan threads first.
- **Stacking misses with major plot.** Misses should hurt and move on, not pile up cosmic stakes.
- **Forgetting the diversity check.** `get_recent_complications` is mandatory before narration.
- **Forgetting to tag the scene.** `record_scene` with `complication_theme` is what makes the protocol work.
- **Treating the Pay the Price table as a script.** It's a prompt — the campaign supplies the texture.
- **Choosing a consequence the player would clearly prefer.** Pay the Price should cost something the player cares about, not the cheapest item on the menu.
