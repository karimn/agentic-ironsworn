---
name: ironsworn-suffer
description: >
  Governs Ironsworn Suffer moves — every consequence beat where the character
  pays a cost. Covers Endure Harm, Endure Stress, Companion Endure Harm,
  Sacrifice Resources, Out of Action, Face Death, Face Desolation. ALWAYS
  invoke this skill whenever harm, stress, supply loss, debilities, or
  companion injury must resolve, or when the player says things like
  "I take harm", "I'm hit", "endure stress", "out of action", "face death",
  "sacrifice", "I lose supply", "I'm wounded", "shaken", "my companion is
  hurt". Fires from any context — combat hits, journey misses, social
  betrayals, oracle Pay the Price, dramatic fiction. Discipline: a hit that
  costs nothing isn't a hit. Never improvise consequence numbers.
---

# Ironsworn Suffer Moves

Suffer moves apply costs when the world pushes back. This skill is the single source of truth for **applying** consequences. Choosing *which* consequence belongs to `ironsworn-oracle` Pay the Price; this skill takes it from there.

**Fiction Grounding Protocol:** Must invoke before narrating consequence beats that introduce a place, NPC, faction, or past event — see `agents/ironsworn-gm.md`.

**The discipline:** *A hit that costs nothing isn't a hit.* Never narrate "you take a wound" without `suffer_harm`; never narrate "you're rattled" without `suffer_stress`. The journal is how the campaign remembers wounds.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `suffer_harm` | Endure Harm |
| `suffer_stress` | Endure Stress |
| `consume_supply` | Sacrifice Resources / supply loss |
| `inflict_debility` | wounded, shaken, maimed, corrupted, cursed, tormented, battered, encumbered, unprepared |
| `clear_debility` | Recover from a debility |
| `companion_suffer_harm` / `companion_restore_health` | Companion harm and recovery |
| `resolve_move` | Endure Harm / Endure Stress / Companion Endure Harm / Face Death / Face Desolation |
| `roll_oracle` | Endure Harm / Endure Stress consequence tables |

---

## When to Invoke

Any time the fiction inflicts a cost: combat hits (from `ironsworn-combat`), journey misses, social betrayal (from `ironsworn-social`), Pay the Price that names harm/stress/supply/debility (from `ironsworn-oracle`), peril at 0 health/spirit, companion takes a blow.

If a peer skill hands off, **trust their framing** but apply the mechanics here.

---

## Fiction Grounding Protocol (#103)

**Before narrating any consequence beat, pull on existing lore.** A wound has roots: who struck the blow, why, what grudge it settles. Stress has a face: the NPC whose betrayal is finally landing.

1. `search_lore_global` for terms relevant to the consequence (the foe, the location, an open thread).
2. Optionally `get_npc` for the inflicting party, or `search_beats` for prior fiction touching the wound.
3. Tie the cost to *something already in the campaign* — a faction grudge, a community wound, an NPC's history.

Skip only if the source is already loaded mid-scene.

---

## Endure Harm (Iron)

**Apply harm first**, then roll. The roll is whether you press on, not whether you take the wound.

1. `suffer_harm` n=`<harm>`.
2. `resolve_move` move "Endure Harm", stat "iron".

| Result | Effect |
|---|---|
| Strong hit | Choose: Shake it off (+1 health, -1 momentum) OR Embrace the pain (+1 momentum) |
| Weak hit | Press on. |
| Miss | -1 momentum. If at 0 health: mark **wounded** or **maimed** (if unmarked) OR roll Endure Harm oracle |

**Fiction Notes.** A wound is not "you lose 2 health" — it is the spear through your mail, the leg that won't bear weight on stairs. At 0 health you are not dead, but a step from it. *Wounded* slows you; *maimed* lasts.

Full oracle table (1d100, including the Face Death triggers), the strong-hit `AskUserQuestion`, and worked examples → `references/endure-harm.md`.

---

## Endure Stress (Heart)

Apply stress first, then roll.

1. `suffer_stress` n=`<amount>`.
2. `resolve_move` move "Endure Stress", stat "heart".

| Result | Effect |
|---|---|
| Strong hit | Choose: Shake it off (+1 spirit, -1 momentum) OR Embrace the darkness (+1 momentum) |
| Weak hit | Press on. |
| Miss | -1 momentum. If at 0 spirit: mark **shaken** or **corrupted** (if unmarked) OR roll Endure Stress oracle |

**Fiction Notes.** Stress at -2 spirit is not anxiety — it is the silence after a friend's body hits the dirt. *Shaken* is jumping at shadows; *corrupted* is making peace with darker thoughts. The 11-25 oracle that forces a Forsake is the most narratively dangerous outcome in the game.

Full oracle and the Forsake handoff to `ironsworn-progress-tracks` → `references/endure-stress.md`.

---

## Companion Endure Harm (Heart)

1. `companion_suffer_harm` companion_name=`<name>` amount=`<n>`.
2. `resolve_move` move "Companion Endure Harm", stat "heart".

| Result | Effect |
|---|---|
| Strong hit | Companion rallies. `companion_restore_health` n=1. |
| Weak hit | Battered. If at 0 health, cannot assist until ≥1. |
| Miss | -1 momentum. If companion at 0: gravely wounded, **out of action**; without aid, dies in an hour or two. |
| Miss + action die = 1, companion at 0 | Companion **dead**. 1 XP per marked ability; remove the asset. |

**Out of action ≠ dead.** Heal or fictional aid can save them. Always pause for the player before applying death.

**Fiction Notes.** A companion is the second voice in a hard scene. *Battered* is a beat to play; *gravely wounded* is a clock; *dead* is an epilogue beat for that bond.

---

## Sacrifice Resources

Not a roll — a cost. Triggered by Face Danger weak hits, Pay the Price, Sacrifice a Resource asset.

- Supply: `consume_supply` n=`<amount>`. At 0 supply, the next loss triggers **Out of Supply** — apply a separate consequence (mark unprepared, lose an asset, journey halts) instead of going negative.
- Other resources (a relic given up, a name owed) live in lore. Update via `upsert_lore` or close a thread.

**Fiction Notes.** Supply is the cold camp without flint, the sword that finally broke. When supply hits 0, *something* breaks; do not silently clamp.

---

## Out of Action

Fiction status, not a tool call. Triggered by Endure Harm oracle 21-35 (player unconscious) or Companion Endure Harm miss at 0 health.

The character cannot act, assist, or move until restored. For the player, the scene continues *around* them — the GM may invoke Face Death if they are vulnerable. For a companion, the clock is ticking toward death.

---

## Face Death (Heart) — rare, dramatic

| Result | Effect |
|---|---|
| Strong hit | Death rejects you. Cast back into the mortal world. |
| Weak hit | Choose: noble sacrifice (you die) OR Death demands a Vow (formidable/extreme). Fail or refuse → dead. Otherwise return, **cursed**. |
| Miss | You are dead. |

Use `AskUserQuestion` for the weak-hit choice. Vow path → `ironsworn-progress-tracks` `create_progress_track`, then `inflict_debility` "cursed". Clear cursed only by completing the quest.

**Fiction Notes.** Face Death may be the player's epilogue — pause; never rush. If they pick noble sacrifice, work with them on a closing scene worthy of the campaign.

Full procedure → `references/face-death-desolation.md`.

---

## Face Desolation (Heart) — rare, dramatic

| Result | Effect |
|---|---|
| Strong hit | Resist and press on. |
| Weak hit | Choose: noble sacrifice (sanity breaks) OR vision-Vow (formidable/extreme) to prevent a dreaded future. Fail/refuse → lost. Otherwise return, **tormented**. |
| Miss | Lost to despair or horror. |

Same shape as Face Death, applied to spirit. `inflict_debility` "tormented"; clear only by completing the quest.

**Fiction Notes.** Face Desolation is the quiet apocalypse — death of the will. The vision in the weak-hit branch must pull on lore the campaign already cares about; invoke the Fiction Grounding Protocol before narrating it.

---

## Cross-Skill Handoffs

- **Combat hits** → `ironsworn-combat` rolls Strike/Clash/Battle, then hands here for `suffer_harm`. Combat does not own the harm number; this skill does.
- **Pay the Price** → `ironsworn-oracle` decides *what* the cost is, then hands here for application.
- **Vow forsake from Endure Stress (11-25)** → `ironsworn-progress-tracks` `forsake_vow`.
- **Face Death / Desolation Vow path** → `ironsworn-progress-tracks` `create_progress_track`.

---

## Common Mistakes

- **Narrating harm without `suffer_harm`.** The journal must record it.
- **Rolling Endure Harm before applying the harm.** Apply first; roll second.
- **Skipping the 0-health miss branch.** It forces a debility OR oracle, not just -1 momentum.
- **Treating Out of Action as dead.** It is unconscious / gravely wounded.
- **Auto-applying Face Death/Desolation weak hit.** Use `AskUserQuestion`.
- **Inventing consequence severity.** Amounts come from rules or the move's effect.
- **Narrating a wound without lore grounding.** Pull on the lore graph first.
