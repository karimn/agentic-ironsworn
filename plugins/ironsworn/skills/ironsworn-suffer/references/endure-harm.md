# Endure Harm — Full Workflow

The main `SKILL.md` covers the basics. This reference holds the oracle table, the strong-hit choice prompt, and edge cases.

---

## Sequence (always)

1. **Apply the harm.** `suffer_harm` n=`<harm amount>`. Harm comes from:
   - Combat: foe's harm value (rank-based) on a Strike/Clash hit; reduced or amplified by fiction (cover, weakness exposed, etc.)
   - Journey/social: usually 1 harm unless the source is severe
   - Pay the Price: as the oracle directs
2. **Roll the move.** `resolve_move` with move "Endure Harm", stat "iron". (Some assets allow heart instead.)
3. **Apply the result** per the table below.

---

## Outcome Table

| Result | What happens | Tool sequence |
|---|---|---|
| Strong hit | Choose: Shake it off (+1 health, -1 momentum) OR Embrace the pain (+1 momentum) | `restore_health` n=1 + `take_momentum` n=-1, OR `take_momentum` n=1 |
| Weak hit | Press on. No further effect. | — |
| Miss | -1 momentum; if at 0 health, mark wounded or maimed (whichever is unmarked) OR roll Endure Harm oracle | `take_momentum` n=-1; `inflict_debility` OR `roll_oracle` "Endure Harm" |

### Strong-hit `AskUserQuestion`

```
question: "You shrug it off. How?"
options:
  - value: "shake"   label: "Shake it off"      description: "+1 health, -1 momentum (only if health > 0)"
  - value: "embrace" label: "Embrace the pain"  description: "+1 momentum, no health change"
```

If health is 0, "shake it off" is unavailable — only "embrace the pain" is offered.

---

## 0-Health Miss: Debility OR Oracle

When the miss happens *and* the character is already at 0 health, the rule says: **mark wounded or maimed (if unmarked)** OR roll the Endure Harm oracle.

- If wounded is unmarked: `inflict_debility` "wounded".
- If wounded is marked but maimed is unmarked: `inflict_debility` "maimed".
- If both are marked: `roll_oracle` "Endure Harm".

The choice — debility vs oracle — is the player's. Offer it via `AskUserQuestion` only if both wound debilities are unmarked. Otherwise auto-apply the available one; if both marked, go straight to the oracle.

---

## Endure Harm Oracle (1d100)

| Roll | Outcome |
|---|---|
| 1-10 | The harm is mortal. **Face Death.** |
| 11-20 | You are dying. Heal within an hour or two, or **Face Death**. |
| 21-35 | Unconscious and **out of action**. Come back to your senses in an hour or two if left alone. If vulnerable to a foe not inclined to show mercy, **Face Death**. |
| 36-50 | Reeling and fighting to stay conscious. Vigorous activity (running, fighting) before a few minutes of breather → roll on this table again before resolving the other move. |
| 51-100 | Battered but still standing. |

Note the recursive 36-50 result: the next time the character pushes, roll Endure Harm oracle *first*, then resolve the move they were attempting.

---

## Worked Examples

**Example 1 — combat hit, full health.** Foe deals 2 harm. `suffer_harm` n=2 (health 5 → 3). Roll Endure Harm vs iron: strong hit. Player picks Embrace the pain. `take_momentum` n=1.

**Example 2 — at 0 health, miss.** Already 0 health, wounded unmarked. Foe deals 1 harm. `suffer_harm` n=1 (clamps at 0). Roll Endure Harm: miss. `take_momentum` n=-1. Wounded is unmarked → `inflict_debility` "wounded".

**Example 3 — at 0 health with both wound debilities marked, miss.** `roll_oracle` "Endure Harm". Roll = 14 → "You are dying." Hand off: Heal within an hour, or Face Death. The clock is now narrative — the player must act.

---

## Common Edge Cases

- **Harm beyond the 5-health bar:** clamps at 0; surplus does not bleed forward. The cost shows up in the Endure Harm roll, not the health number.
- **Asset modifiers:** some assets (Veteran, Iron Will, etc.) modify Endure Harm. Apply them via `adds` in `resolve_move`.
- **Recurring 36-50 oracle:** track it on the scene — set a reminder that the next move requires an Endure Harm oracle reroll first.
- **Companion present:** companion harm is a separate move; do not roll Companion Endure Harm at the same time as Endure Harm. Each takes their own beat.
