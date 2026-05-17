---
name: ironsworn-progress-tracks
description: >
  Governs all Ironsworn progress-track play: vows (Swear an Iron Vow, Reach a
  Milestone, Fulfill Your Vow, Forsake Your Vow, recommit on Fulfill miss),
  journeys (Undertake a Journey, Make Camp, Resupply, Reach Your Destination),
  combat tracks, bonds, and scene challenges. ALWAYS invoke this skill whenever
  the GM is about to advance any progress track, or the player says things like
  "swear a vow", "I undertake the journey", "make camp", "resupply", "fulfill
  my vow", "forsake my vow", "I think we've arrived", or any move that ticks,
  fulfills, or abandons a track. Also invoke whenever progress glyphs need to
  be displayed. Never handle progress mechanics from memory alone.
---

# Ironsworn Progress Tracks

Progress tracks are the spine of Ironsworn. Vows, journeys, combats, bonds, and scene challenges all use them. This skill is the single source of truth for how they work, how they are advanced, how they resolve, and how they are displayed.

**Fiction Grounding Protocol:** Must invoke before narrating vow fiction, journey arrivals, or milestone beats that introduce a place, NPC, faction, or past event — see `agents/ironsworn-gm.md`.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `create_progress_track` | Start a vow, journey, combat, or scene challenge |
| `reach_milestone` | Vow milestone (RAW Reach a Milestone) — VOW ONLY |
| `tick_progress` | Journey waypoints, combat harm, scene-challenge progress |
| `roll_progress` | Progress moves: Fulfill Your Vow, Reach Your Destination, End the Fight |
| `fulfill_progress` | After `roll_progress` hits — closes track, awards XP for vows |
| `forsake_vow` | Player abandons a vow (status → forsaken, applies stress) |
| `recommit_vow` | Fulfill miss → recommit branch (clear most progress, raise rank) |
| `close_track` | Wrap up a non-vow track without XP (battle ended fictionally) |
| `override` (path=`bonds`) | Increment `bonds` after Forge a Bond strong hit (no dedicated tool) |

---

## When to Invoke This Skill

Invoke whenever you would otherwise reach for a progress-track rule, including:

- Player swears, advances, fulfills, or abandons a vow
- Player begins, continues, or ends a journey (Undertake, Make Camp, Resupply, Reach Your Destination)
- Combat: Enter the Fray, harm, End the Fight
- Bond moves that say "mark progress on your bonds"
- Scene challenges (progress + countdown)
- Any call to the tools listed above
- Displaying any track's progress glyphs (see `references/display.md`)

---

## Progress Track Fundamentals

A progress track has 10 boxes. Each box holds 4 ticks. Maximum is 40 ticks.

**Ticks-per-mark by rank:**

| Rank | Ticks per mark | Boxes per mark |
|---|---|---|
| Troublesome | 12 | 3 |
| Dangerous | 8 | 2 |
| Formidable | 4 | 1 |
| Extreme | 2 | ½ |
| Epic | 1 | ¼ |

**Progress score** (used by `roll_progress`) = number of *fully filled* boxes only. Partial boxes do not count.

---

## Vows

### 1. Swear an Iron Vow

When the player commits to a quest:

1. `resolve_move` with move "Swear an Iron Vow", stat "heart" (add +1 if vow is to a bonded NPC/community).
2. Set the rank from the player's intent (or `roll_oracle`).
3. `create_progress_track` with `name`, `rank`, `kind: "vow"` — this auto-opens a matching thread.

**Outcomes:**

| Result | Effect |
|---|---|
| Strong hit | +2 momentum; clear next step |
| Weak hit | +1 momentum; begin with questions |
| Miss | A significant obstacle. Choose: press on (-2 momentum) or `forsake_vow`. |

The **background vow** (created at character creation) does not require a Swear roll — just `create_progress_track`. The full background-vow flow lives in `ironsworn-character-builder` (Step 5 — Background Vow); when that skill is in play during character creation, defer to it.

### 2. Reach a Milestone

**RAW trigger:** the player overcomes a critical obstacle, completes a perilous journey, solves a complex mystery, defeats a powerful threat, gains vital support, or acquires a crucial item — *and the success directly advances a vow.*

**Discipline:** after every hit on a move that overcame a meaningful obstacle, ask yourself: did this advance any open vow? If yes:

- Call `reach_milestone` with `track_name=<vow name>`. Default `count=1` (one milestone event).
- The tool reads the rank and applies the canonical amount automatically. Never pass `count > 1` unless the fiction explicitly justifies multiple milestones in one beat (e.g., the rule explicitly notes that a single dramatic moment satisfies two related vows — call `reach_milestone` once per vow, not `count=2`).

**Never use `tick_progress` for vow advancement.** Use `reach_milestone`.

**What does NOT count:**
- A minor success or easy obstacle. Milestones cost something.
- A success unrelated to any vow. Tick nothing.
- Just because a session is ending. Don't patch tracks retroactively — earn them.

### 3. Fulfill Your Vow

When the fiction has reached the climax — the player believes the vow is at its end:

1. `roll_progress` with `track_name=<vow name>` — this returns the outcome and progress score.
2. `fulfill_progress` with `track_name`, `outcome`, optional `resolution` — awards XP and closes the matching thread.

This is a **progress roll, not an action roll.** Do not use `resolve_move`.

**Outcomes (progress roll):**

| Result | Effect |
|---|---|
| Strong hit | Vow fulfilled. XP = troublesome 1, dangerous 2, formidable 3, extreme 4, epic 5. |
| Weak hit | More to be done. XP = troublesome 0, dangerous 1, formidable 2, extreme 3, epic 4. May Swear a new vow to set things right (+1 if so). |
| Miss | Quest is undone. Choose: recommit OR forsake. |

### 4. Miss on Fulfill — Recommit or Forsake

**Always offer the choice via `AskUserQuestion`:**

```
question: "Your quest is undone. What do you do?"
options:
  - value: "recommit"  label: "Recommit"  description: "Clear all but one filled progress, and raise the quest's rank by one (if not already epic). The vow continues."
  - value: "forsake"   label: "Forsake"   description: "Abandon the quest. Endure Stress equal to the rank."
```

- Recommit → `recommit_vow` (clears to one filled box, raises rank one tier).
- Forsake → `forsake_vow` (sets status to forsaken, applies stress, closes thread).

Never auto-decide. The player chooses.

### 5. Forsake Your Vow

When the player abandons a vow (mid-quest or after a Fulfill miss):

- `forsake_vow` with `track_name` and optional `reason`.
- The tool applies stress equal to rank (troublesome=1, dangerous=2, formidable=3, extreme=4, epic=5).
- The matching thread closes with "Forsaken: <reason>" (or just "Forsaken").
- 0 XP awarded. This is failure, not success.

If forsaking a vow central to the character's identity, consider Write Your Epilogue.

---

## Journeys

Journeys are a progress mechanic. The destination is reached by accumulating marks on a journey progress track, then making a progress roll. Supply drain is the primary cost.

**Quick reference:**

| Step | Tool calls |
|---|---|
| Start | `create_progress_track` (kind="journey") |
| Each waypoint | `resolve_move` "Undertake a Journey" (Wits), then `tick_progress` (marks=1) on hits |
| Mid-journey recovery | `resolve_move` "Make Camp" / "Resupply" |
| Arrival | `roll_progress` then `fulfill_progress` (0 XP) |

**Critical rules:**
- **Reach Your Destination is a progress roll, not an action roll** — use `roll_progress`, not `resolve_move`.
- **Always `tick_progress` after each Undertake hit** — 1 mark per hit, rank-dependent ticks.
- **Journey arrival → vow milestone is SEPARATE** — `fulfill_progress` on the journey, then `reach_milestone` on the related vow.

For the full journey workflow (pacing, montage vs scene, all outcome tables, AskUserQuestion option sets, supply pressure rules, common mistakes), see `references/journeys.md`.

---

## Combat Tracks

When combat starts and a progress track is appropriate, `create_progress_track` with `kind: "combat"` and rank matching the foe.

**Ticking combat:** use `tick_progress`, NOT `reach_milestone`. Each point of harm = 1 mark; rank determines ticks per mark.

**End the Fight** is a progress roll: `roll_progress` then `fulfill_progress` (0 XP).

---

## Bonds

`character.bonds` is a plain integer counter, not a progress track. Do NOT call `tick_progress` for bonds.

When a bond move (e.g., Forge a Bond strong hit) says to mark a bond:

1. Read current value via `get_character_digest` (returns `bonds`).
2. Call `override` with `path: "bonds"`, `value: <current + 1>`.

There is no dedicated bond-increment tool; `override` is the supported path.

---

## Scene Challenges

Two tracks together:
- 10-box progress track — rank applies; `tick_progress` adds rank-dependent ticks per mark.
- 4-box countdown track — always one full box at a time.

Resolve via `roll_progress` on the progress track.

---

## Display Format

For glyph rendering of any progress track, see `references/display.md`. It contains the glyph table (`○ ◔ ◑ ◕ ●`), the box-mapping formula, and worked examples.

---

## Common Mistakes

- **Never use `tick_progress` for a vow milestone — use `reach_milestone`.**
- **Fulfill Your Vow is a progress roll, not an action roll** — use `roll_progress`, not `resolve_move`.
- **Miss on Fulfill: ASK the player recommit vs forsake; do not auto-decide.**
- **Forsake applies stress** equal to rank — use the `forsake_vow` tool, never improvise.
- **Never skip `create_progress_track`** at journey or vow start.
- **Never narrate "they arrived" without rolling Reach Your Destination.**
- **Always tick progress after each Undertake hit** — progress only accumulates through explicit `tick_progress` calls.
- **The Prepare option in Make Camp** gives +1 to the *next* Undertake only — apply once.
- **Don't roll Undertake for mundane travel** — narrate short safe trips.
- **Bond bonus on Undertake applies once** — only the first roll of a journey from a bonded community.
- **Journey arrival → vow milestone is a SEPARATE call** — `fulfill_progress` on the journey, then `reach_milestone` on the vow. Don't double-tick.
