# Combat Flow Reference

Full procedures for combat play. The main `ironsworn-combat` SKILL.md links here.

---

## 1. Choosing the foe's rank

Set rank from the foe's threat, not just hit points:

| Rank | Use for |
|---|---|
| Troublesome | A single bandit, a wild dog, a panicked stranger with a knife |
| Dangerous | A trained soldier, a small predator, a desperate hunter |
| Formidable | A skilled warrior, a large beast, a bonded duo |
| Extreme | A champion, an elite predator, a small monstrous thing |
| Epic | A legendary foe, a great beast, a horror out of myth |

Lone, brief threats may not need a track at all — narrate, apply harm fictionally, and resolve in a single Strike. **Open a track** the moment the fiction asks "how long does this take to bring down?"

---

## 2. Enter the Fray (action — heart / shadow / wits)

`resolve_move` "Enter the Fray".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | +2 momentum. You have initiative. | `take_momentum` n=2 |
| Weak hit | Choose: bolster (+2 momentum) OR seize initiative. | `AskUserQuestion`; then `take_momentum` n=2 if bolster |
| Miss | Combat begins at disadvantage. Pay the Price. Foe has initiative. | See Pay the Price |

**Stat choice prompt:**
```
question: "How do you enter the fight?"
options:
  - value: "heart"   label: "Face them down"   description: "Heart — squaring off, eyes locked."
  - value: "shadow"  label: "Strike unseen"    description: "Shadow — moving on an unaware foe, or hitting without warning."
  - value: "wits"    label: "React fast"       description: "Wits — ambushed, scrambling for advantage."
```

**Weak-hit choice prompt:**
```
question: "You have a moment. What do you do with it?"
options:
  - value: "bolster"   label: "Bolster your position"  description: "+2 momentum."
  - value: "initiative" label: "Prepare to act"        description: "Take initiative."
```

---

## 3. Strike (action — iron / edge) — when YOU have initiative

`resolve_move` "Strike".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | Inflict +1 harm. You retain initiative. | `tick_progress` (marks = base harm + 1) |
| Weak hit | Inflict harm. Lose initiative. | `tick_progress` (marks = base harm) |
| Miss | Attack fails. Pay the Price. Foe has initiative. | No tick. See Pay the Price |

**Base harm** is 1 by default. Deadly weapons or assets may set it to 2 — read it from the character sheet, don't guess.

**Stat choice prompt (if range is ambiguous):**
```
question: "How do you strike?"
options:
  - value: "iron"  label: "Close in"  description: "Iron — close quarters, blade on blade."
  - value: "edge"  label: "At range"  description: "Edge — bow, throwing axe, distance."
```

---

## 4. Clash (action — iron / edge) — when the FOE has initiative

`resolve_move` "Clash".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | Inflict harm + choose: bolster (+1 momentum) OR find an opening (+1 harm). You take initiative. | `tick_progress` (marks = base harm; +1 if opening); `take_momentum` n=1 if bolster |
| Weak hit | Inflict harm, then Pay the Price. Foe keeps initiative. | `tick_progress` (marks = base harm); see Pay the Price |
| Miss | Outmatched. Pay the Price. Foe keeps initiative. | No tick. |

**Strong-hit choice prompt:**
```
question: "You hit hard — and now?"
options:
  - value: "bolster" label: "Bolster your position"  description: "+1 momentum."
  - value: "opening" label: "Find an opening"        description: "Inflict +1 harm."
```

---

## 5. Turn the Tide (action — once per fight)

`resolve_move` "Turn the Tide" when the player risks it all. Outcomes are not preset by RAW — let the player declare what they're risking and what success looks like before rolling. Adjudicate from fiction.

Typical use: low health, last-ditch leap, gambling everything on one swing. Do not invoke for routine moments.

---

## 6. Battle (action — any stat per tactic)

Use Battle to abstract a fight into one beat. Skips the combat track entirely.

`resolve_move` "Battle".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | Achieve objective unconditionally. +2 momentum. | `take_momentum` n=2; `close_track` if a track existed |
| Weak hit | Achieve objective, but not without cost. Pay the Price. | `close_track`; see Pay the Price |
| Miss | Defeated. Objective lost. Pay the Price. | No close — fiction continues; see Pay the Price |

**Stat choice prompt:**
```
question: "How do you fight this battle?"
options:
  - value: "edge"   label: "Range and speed"  description: "Edge — terrain, mobility, distance."
  - value: "heart"  label: "Courage / allies" description: "Heart — companions, conviction."
  - value: "iron"   label: "Overpower"        description: "Iron — close in, break them."
  - value: "shadow" label: "Trickery"         description: "Shadow — befuddle, deceive, cheat."
  - value: "wits"   label: "Tactics"          description: "Wits — outsmart, outmaneuver."
```

---

## 7. End the Fight (progress roll)

When the foe is worn down and the player commits to the ending — kill, capture, rout — they take decisive action.

**Sequence:**
1. The player declares decisive intent on a Strike, Clash, or other contextual move.
2. That move scores a strong hit (RAW trigger).
3. `roll_progress` with `track_name=<foe track name>`.
4. `fulfill_progress` with `track_name`, `outcome`. **Combat tracks award 0 XP.**

**Outcomes (progress roll):**

| Result | Effect |
|---|---|
| Strong hit | Foe is killed, out of action, flees, or surrenders — player choice fitting the fiction. |
| Weak hit | Foe is finished, but choose one cost (see prompt below). |
| Miss | You have lost this fight. Pay the Price. |

**Weak-hit cost prompt — always ask:**
```
question: "You finish them — but at what cost?"
options:
  - value: "harm"        label: "It's worse than you thought"  description: "Endure Harm."
  - value: "stress"      label: "You are overcome"             description: "Endure Stress."
  - value: "new_danger"  label: "Victory is short-lived"       description: "A new danger or foe appears, or an existing danger worsens."
  - value: "collateral"  label: "Collateral damage"            description: "Something of value is lost or broken, or someone important must pay the cost."
  - value: "objective"   label: "You'll pay for it"            description: "An objective falls out of reach."
  - value: "vengeance"   label: "Others won't forget"          description: "You are marked for vengeance."
```

Apply the chosen consequence with the appropriate tool — `suffer_harm` / `suffer_stress` / new threat track / `inflict_debility` / narrative — defer to `ironsworn-suffer` for harm and stress flows.

**On miss:** the foe is not down. Pay the Price (likely Endure Harm or Face Death). The fight may continue, or the player may break off, retreat, surrender. Don't auto-end the scene.

---

## 8. Momentum Tactics

- **Burn momentum on a Strike or Clash miss/weak-hit** when momentum exceeds the lower (miss) or higher (weak-hit) challenge die, to upgrade the result. The scribe surfaces `burnOffered: true` on the move outcome — pass the offer to the player.
- **Strong-hit Clash with bolster** is the cleanest momentum source in a sustained fight. Suggest it when the player is low on the meter.
- **Negative momentum** cancels your action die. If the player drops to negative momentum mid-fight, narrate the spiral; the next Strike/Clash is fragile.
- **Take Decisive Action thrives on momentum** — burn before End the Fight if momentum > both challenge dice. The scribe will offer it; accept on the player's behalf only if they pre-authorized.

---

## 9. Worked example

**Foe:** Bandit Captain (dangerous, 8 ticks per mark).

1. `create_progress_track` name="Bandit Captain at the Crossing", rank="dangerous", kind="combat".
2. `resolve_move` "Enter the Fray", stat="heart". Strong hit. `take_momentum` n=2. Player has initiative. Track: `○○○○○○○○○○`.
3. `resolve_move` "Strike", stat="iron". Strong hit. Inflict 1+1=2 harm. `tick_progress` marks=2 → 16 ticks. Track: `●●○○○○○○○○`. Player retains initiative.
4. `resolve_move` "Strike", stat="iron". Weak hit. Inflict 1 harm. `tick_progress` marks=1 → 24 ticks. Track: `●●●○○○○○○○`. Foe takes initiative.
5. `resolve_move` "Clash", stat="iron". Strong hit, choose "find an opening". Inflict 1+1=2 harm. `tick_progress` marks=2 → 40 ticks. Track: `●●●●●●●●●●`. Player takes initiative back. Player declares decisive intent: "I drive the blade home."
6. `roll_progress` track_name="Bandit Captain at the Crossing". Strong hit (10 progress score, low challenge dice). `fulfill_progress` outcome="strong_hit", resolution="killed". 0 XP.
7. If the captain was tied to an open vow ("Avenge Mara"), call `reach_milestone` track_name="Avenge Mara" — separately, after `fulfill_progress`.

---

## 10. Common Pitfalls

- **Trying to roll End the Fight without progress.** A progress score of 0–2 is a near-guaranteed miss; the player must earn the marks first.
- **Using `reach_milestone` on a combat track.** Wrong tool. `tick_progress` always.
- **Auto-picking the weak-hit cost.** Always `AskUserQuestion`.
- **Computing ticks manually.** Pass marks; the tool reads rank.
- **Letting Battle escape Strike/Clash mid-fight.** Pick one mode and commit.
- **Forgetting `close_track` after a Battle hit on an existing track.** The track remains open otherwise.
- **Skipping `search_lore_global`.** Combat fiction must be grounded; the foe, the terrain, and the stakes are all in the lore.
- **Treating combat XP as automatic.** Combat tracks award 0 XP from `fulfill_progress`. Vow XP is a separate `reach_milestone` call, only if the foe was bound to a vow.
