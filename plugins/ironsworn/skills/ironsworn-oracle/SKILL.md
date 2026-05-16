---
name: ironsworn-oracle
description: >
  Governs all Fate moves and oracle-driven inspiration: Ask the Oracle (yes/no
  questions, descriptor prompts, random events) and Pay the Price (consequence
  selection on a miss). Centralizes how to set odds, when to ask versus when to
  decide, how to interpret "action+theme" and other prompt rolls, when "no" is
  more interesting than "yes," and how to choose a Pay the Price consequence
  from the palette. ALWAYS invoke this skill whenever the GM is about to call
  `roll_yes_no` or `roll_oracle`, when the player says things like "ask the
  oracle", "is there", "do they", "what does", "what happens", "pay the price",
  "what's here", "roll for it", or any time a miss outcome reads "Pay the
  Price." Other mechanics skills (combat, social, suffer, progress-tracks)
  defer here for oracle and consequence interpretation. Never improvise odds
  or fabricate oracle results from memory.
---

# Ironsworn Oracle & Pay the Price

The oracle is the engine of surprise. Anything you don't already know, the dice can tell you. This skill is the single source of truth for the two Fate moves — **Ask the Oracle** and **Pay the Price** — and for how every other skill should reach for `roll_yes_no` and `roll_oracle`.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `roll_yes_no` | Any binary question to the world: "is there...", "do they...", "does it..." |
| `roll_oracle` | Any named oracle table (Action, Theme, Pay the Price, Region, Settlement Trouble, etc.) |
| `search_lore_global` | **Before interpreting** any oracle result — Fiction Grounding Protocol (#103) |
| `search_lore` | Entity/name resolution before naming a place, NPC, or faction the oracle suggests |
| `get_recent_complications` | **Before** Pay the Price narration (Complication Diversity Protocol — owned by GM agent) |
| `record_scene` | After Pay the Price, tag with `complication_theme` |

---

## When to Invoke This Skill

- A miss outcome whose effect reads "Pay the Price"
- A player asks a yes/no question about the world ("Is there a path down?")
- Fiction needs detail you don't have (NPC motive, what's around the bend, what the storm brings)
- A move outcome says "Envision what you find (Ask the Oracle if unsure)"
- Any other skill is about to call `roll_yes_no` or `roll_oracle`

If you already know the answer from established lore, **don't roll** — narrate. Oracles are for genuine uncertainty.

---

## Ask the Oracle

**RAW trigger:** When you seek to resolve questions, discover details in the world, determine how other characters respond, or trigger encounters or events.

Two flavors. Pick by what you need.

### Yes/No — `roll_yes_no`

Use for any binary world-question. Set odds honestly, **before** the roll, based on the established fiction.

| Likelihood | "Yes" range (d100) | When to pick it |
|---|---|---|
| `almost_certain` | 11–100 | Strongly supported by fiction; narrating "no" would be perverse |
| `likely` | 26–100 | The fiction tilts this way |
| `50_50` | 51–100 | Genuinely uncertain — the most common choice |
| `unlikely` | 1–25 | The fiction tilts against it |
| `small_chance` | 1–10 | Would be a real surprise; narrating "yes" would feel like a gift |

**A "no" is often more interesting than a "yes."** A yes resolves; a no forces invention. If both answers feel boring, your question is wrong — ask a sharper one.

**Twist (matched digits, e.g. 33, 77, 00):** the result is true *but* with an unexpected wrinkle. Narrate the answer, then introduce the twist. A "yes, with a twist" is not the same as a "no" — the underlying fact stands.

### Prompt rolls — `roll_oracle`

For open-ended uncertainty, roll on a named table. The most flexible pair is **Action + Theme**: roll both, treat as an evocative prompt, **then ground the interpretation in lore**. Other useful tables: `Pay the Price`, `Region`, `Location`, `Settlement Trouble`, `Settlement Name`, `Character Role`, `Character Goal`, `Character Descriptor`, `Major Plot Twist`, `Mystic Backlash`.

Full interpretation patterns, worked examples, and the "when to ask vs. decide" decision flow → `references/oracle-prompts.md`.

### Fiction Notes — Ask the Oracle

The oracle never tells you *what happens* — it tells you *what is true*. Your job is to make that truth land inside the established world. Before narrating any oracle interpretation, call `search_lore_global` (and `search_lore` if a name/place is implicated) to anchor the result. Treat odd or contradictory rolls as gifts: the world is stranger than your plan. Never re-roll for a "better" answer.

---

## Pay the Price

**RAW trigger:** When you suffer the outcome of a move (almost always a miss).

Pay the Price is a *menu*, not a mandate. You may **choose** a consequence that fits the fiction, **or** `roll_oracle` "Pay the Price" when you're stuck or want surprise.

### The Discipline (preference order)

1. **Flat mechanical cost (default).** −1 supply, −1 momentum, harm, lost progress, broken gear. Has teeth without spawning plot.
2. **Escalate an existing thread.** Worsen, resurface, or complicate something already open. The world has unfinished business — use it before inventing.
3. **Introduce a new narrative hook (rarely).** Budget: 0–1 per session.

Full discipline, palette interpretation, and worked examples → `references/pay-the-price.md`.

### Complication Diversity Protocol (cross-link)

Before narrating ANY Pay the Price outcome:

1. `get_recent_complications` (k=5)
2. Pick a *different* thematic category than what dominates recent history
3. After narrating, `record_scene` with `complication_theme` set

The full protocol and complication palette live in the GM agent system prompt (`agents/ironsworn-gm.md`). **Do not duplicate** — this skill defers to that source.

### Fiction Notes — Pay the Price

The price is paid by the *fiction*, not the spreadsheet. A −1 supply is "your wineskin froze and split." A new danger isn't a stat block — it's a smell, a sound, a presence at the edge of the firelight. Whatever you choose, it should feel inevitable in retrospect: of course this happened. The campaign earns its weight from accumulating small costs, not from compounding crises.

---

## Common Mistakes

- **Don't roll when you know.** Oracles are for genuine uncertainty.
- **Don't bias the odds.** Set likelihood from the fiction, not from what you want.
- **Don't skip Fiction Grounding.** `search_lore_global` before you interpret — every time.
- **Don't ignore twists.** Matched digits on `roll_yes_no` are a feature; narrate them.
- **Don't always invent on Pay the Price.** Default to flat mechanical cost. New hooks are rare.
- **Don't skip `get_recent_complications`** before a Pay the Price narration, or `record_scene` with `complication_theme` after.
- **Don't re-roll oracles you don't like.** The oracle has spoken.
