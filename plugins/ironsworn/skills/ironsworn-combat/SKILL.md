---
name: ironsworn-combat
description: >
  Governs combat as a mode of play in Ironsworn: Enter the Fray, Strike,
  Clash, Battle, Turn the Tide, End the Fight, and the decisive-action
  resolution loop. ALWAYS invoke this skill the moment combat begins or the
  player says things like "I attack", "I strike", "I shoot", "I close with
  them", "clash", "I parry", "stand my ground", "fight them", "battle",
  "end the fight", "kill them", "finish him", "decisive action", "we throw
  down", "draw steel", or any phrase that opens hostilities with a foe.
  Owns initiative, harm tracking, and the combat progress track. Never
  improvise combat resolution — route every beat through this skill.
---

# Ironsworn Combat

Combat is a distinct mode of play. The clock runs faster, the fiction is sharper, and momentum is the difference between winning the exchange and bleeding out. This skill is the single source of truth for combat moves, initiative, harm, and the foe's progress track.

For all progress-track mechanics (ticks, glyphs, fulfill flow), defer to `ironsworn-progress-tracks`. For Endure Harm / Endure Stress / Face Death triggered by a Pay the Price, defer to `ironsworn-suffer`. For oracle prompts during combat, defer to `ironsworn-oracle`.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `create_progress_track` | Open a combat track (kind="combat") at the start of a meaningful fight |
| `resolve_move` | Enter the Fray, Strike, Clash, Battle, Turn the Tide |
| `tick_progress` | Apply harm to the foe — rank-dependent ticks per harm point |
| `roll_progress` | End the Fight (progress roll) |
| `fulfill_progress` | Close out the foe after End the Fight resolves on a hit |
| `close_track` | Combat ended fictionally (foe surrendered, fled offscreen) |
| `burn_momentum` / `take_momentum` | Convert momentum into hits / harvest from outcomes |
| `suffer_harm` / `suffer_stress` | Apply consequences from misses, weak hits, Pay the Price |
| `search_lore_global` | Fiction Grounding Protocol — call before narrating any non-trivial beat |

---

## When to Invoke This Skill

- The player attacks or is attacked: "I attack", "I strike", "I shoot", "I draw steel", "I close in"
- A hostile NPC enters and the player engages
- Initiative is in question or shifting
- Harm needs to be applied to a foe (always `tick_progress`, never `reach_milestone`)
- The player commits to an ending: "end the fight", "finish him", "kill them", "decisive action"
- Any call to the tools listed above
- Even if combat is brief — invoke first, then decide whether to abstract via Battle

---

## Step 1 — Enter the Fray

When fiction crosses into hostilities, open the fight.

1. Decide if a progress track is warranted. **Open one** for any foe meaningful enough to threaten the character. Skip the track only for trivial mooks resolved in a single Strike — narrate, apply harm fictionally, move on.
2. `create_progress_track` with `name` (e.g. "Bandit Captain at the Crossing"), `rank` matching the foe (troublesome to epic), `kind: "combat"`.
3. `resolve_move` "Enter the Fray". Stat is fictional: heart (facing off), shadow (ambushing from cover), wits (ambushed and reacting).

**Fiction Notes.** Enter the Fray is the threshold beat — the moment the conversation ends and dice come out. Establish range, terrain, and stakes. On a miss, the foe's first move lands before the player reacts; on a strong hit, the player is already moving when the foe registers the threat.

Outcomes table → `references/combat-flow.md` ("Enter the Fray").

---

## Step 2 — In the Fight (Strike / Clash)

Initiative dictates which move you roll. Track who has it.

- **Strike** — when YOU have initiative. Iron close, Edge at range. `resolve_move` "Strike".
- **Clash** — when the FOE has initiative. Iron close, Edge at range. `resolve_move` "Clash".

Both inflict harm on hits. **Harm = marks on `tick_progress`.** Base harm is 1 (or 2 from a deadly weapon/asset); strong-hit Strike and the "find an opening" Clash bonus add +1 mark. Pass marks to the tool — never compute ticks yourself; the tool reads rank and converts (troublesome 12, dangerous 8, formidable 4, extreme 2, epic 1 ticks per mark).

**Initiative migrates with results** — strong-hit Strike retains, weak-hit Strike loses; strong-hit Clash takes initiative back, weak/miss Clash leaves it with the foe. Always restate who currently has initiative before the next exchange.

**Fiction Notes — Strike vs Clash.** Strike is the prepared attack: you chose this exchange. Clash is the reaction: you're answering their swing, their volley, their grasp. A weak-hit Strike still lands, but the foe has answered before you can press.

### Turn the Tide

Once per fight, when the player risks it all (low health, dire stakes): `resolve_move` "Turn the Tide". Outcomes are **player-defined** — let the player declare the dramatic stake before rolling. Adjudicate from fiction.

Full Strike/Clash/Turn-the-Tide outcomes and tool sequences → `references/combat-flow.md`.

---

## Step 3 — Battle (the abstraction)

Use Battle when the fight is best handled as a single dramatic beat — a blur, a brief skirmish, a montage — not exchange by exchange.

`resolve_move` "Battle", stat per tactic (edge=range/speed, heart=courage/allies, iron=overpower, shadow=trickery, wits=tactics).

Battle does **not** use the combat progress track — it skips past it. If a track already exists, close it with `close_track` after a Battle hit.

**Fiction Notes.** Battle is not "skip the fight." Use it when the granular exchange would slow the story — clearing a hallway, holding a wall, bringing down a beast that doesn't deserve a track. Don't reach for Battle to escape Strike/Clash discipline mid-fight; commit to one mode per encounter.

Outcomes → `references/combat-flow.md` ("Battle").

---

## Step 4 — End the Fight (Take Decisive Action)

When the foe is sufficiently worn down and the player commits to the ending — kill, capture, rout — they take decisive action.

**This is a progress roll, not an action roll.** Use `roll_progress`, never `resolve_move`.

1. The RAW trigger: "When you make a move to take decisive action, and score a strong hit." End the Fight is *unlocked* by a strong-hit Strike, Clash, or another move where the player declares decisive intent. Confirm the player is committing to the ending before rolling.
2. `roll_progress` with `track_name=<foe track name>`.
3. `fulfill_progress` with `track_name`, `outcome`. **Combat tracks award 0 XP** — the reward is in the surviving fiction, not on the sheet.

**On weak hit — always offer the cost choice via `AskUserQuestion`** (six canonical options: Endure Harm, Endure Stress, new danger, collateral damage, objective slips, marked for vengeance). Apply the chosen consequence via the appropriate tool — defer to `ironsworn-suffer` for harm/stress flows.

**Fiction Notes.** Decisive action is the player declaring the ending. The progress roll asks: did the fight earn that ending? A strong-hit Strike followed by `roll_progress` is the canonical sequence — the strong hit unlocks intent, the progress roll spends the marks already on the track. Don't roll End the Fight prematurely; without enough progress, even a strong hit on the d6 may be eaten by the challenge dice.

Full End-the-Fight outcomes, the AskUserQuestion option block, and worked sequences → `references/combat-flow.md`.

---

## After the Fight — Vows

If the combat directly advanced an open vow (defeating a sworn enemy, rescuing a hostage tied to a vow), call `reach_milestone` on that vow **separately** after `fulfill_progress` on the combat track. Do not double-tick. See `ironsworn-progress-tracks` for vow advancement.

---

## Pay the Price in Combat

Combat misses and weak-hit costs trigger Pay the Price. Pay it as: harm (`suffer_harm`), stress (`suffer_stress`), broken gear, ally hit, debility (`inflict_debility`), or fictional setback. **Defer to `ironsworn-oracle` for the Pay the Price discipline (preference order, recent-complication checks) and to `ironsworn-suffer` for the Endure Harm / Endure Stress / Face Death move flows.** Call `get_recent_complications` before narrating to avoid recycling beats.

When End the Fight strong-hit RAW says "Ask the Oracle if unsure" (re: kill / out of action / flees / surrenders), defer to `ironsworn-oracle` for `roll_yes_no` likelihood selection.

---

## Fiction Grounding Protocol (#103)

Before narrating any non-trivial combat beat — the foe's tactics, terrain, an NPC ally's reaction, wider stakes — call `search_lore_global` with relevant terms. Only invent when the search returns nothing. The lore graph is the canon; combat doesn't get a pass.

---

## Common Mistakes

- **Combat tracks tick via `tick_progress`, never `reach_milestone`** — milestones are vows only.
- **End the Fight is a progress roll** — `roll_progress` + `fulfill_progress`, never `resolve_move`.
- **End the Fight requires decisive intent** — confirm the player is committing to the ending.
- **Don't roll End the Fight prematurely** — the marks have to be on the track.
- **Strike vs Clash is initiative-keyed** — always restate who has initiative before each exchange.
- **Pass marks, not ticks, to `tick_progress`** — the tool handles rank conversion.
- **Weak-hit End the Fight requires a player choice** — never auto-pick the cost.
- **Battle skips the track** — if a track already exists, close it with `close_track` after the Battle hit.
- **Combat awards 0 XP from `fulfill_progress`** — XP comes only from related vows, called separately.
- **Ground combat fiction in lore** — `search_lore_global` before improvising terrain, factions, or stakes.

---

## Reference

Full per-move outcome tables, worked sequences, momentum tactics, and the End-the-Fight cost prompt: `references/combat-flow.md`.
