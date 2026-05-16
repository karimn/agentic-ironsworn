# Endure Stress — Full Workflow

Same skeleton as Endure Harm, applied to spirit. The differences are in the debilities and the oracle.

---

## Sequence

1. **Apply stress.** `suffer_stress` n=`<amount>`. Stress comes from: social betrayal, despair on a journey miss, witnessing horror, broken bond, Pay the Price.
2. **Roll the move.** `resolve_move` move "Endure Stress", stat "heart".
3. **Apply the result.**

---

## Outcome Table

| Result | What happens | Tool sequence |
|---|---|---|
| Strong hit | Choose: Shake it off (+1 spirit, -1 momentum) OR Embrace the darkness (+1 momentum) | `restore_spirit` n=1 + `take_momentum` n=-1, OR `take_momentum` n=1 |
| Weak hit | Press on. | — |
| Miss | -1 momentum; if at 0 spirit, mark shaken or corrupted (if unmarked) OR roll Endure Stress oracle | `take_momentum` n=-1; `inflict_debility` OR `roll_oracle` "Endure Stress" |

### Strong-hit `AskUserQuestion`

```
question: "You hold yourself together. How?"
options:
  - value: "shake"   label: "Shake it off"          description: "+1 spirit, -1 momentum (only if spirit > 0)"
  - value: "embrace" label: "Embrace the darkness"  description: "+1 momentum, no spirit change"
```

---

## 0-Spirit Miss: Debility OR Oracle

When the miss happens *and* the character is at 0 spirit, the rule says: mark **shaken** or **corrupted** (if unmarked) OR roll the Endure Stress oracle.

- Shaken unmarked → `inflict_debility` "shaken".
- Shaken marked, corrupted unmarked → `inflict_debility` "corrupted".
- Both marked → `roll_oracle` "Endure Stress".

Offer the choice via `AskUserQuestion` only if both stress debilities are unmarked.

---

## Endure Stress Oracle (1d100)

| Roll | Outcome |
|---|---|
| 1-10 | You are overwhelmed. **Face Desolation.** |
| 11-25 | You give up. **Forsake Your Vow** (one relevant to your current crisis). |
| 26-50 | You give in to a fear or compulsion, and act against your better instincts. |
| 51-100 | You persevere. |

### The 11-25 Forsake Branch — Most Dangerous Outcome in the Game

This result *forces* a Forsake. The player does not choose; the dice did. Hand off:

1. Identify the relevant vow. If multiple are open, ask the player which is most tied to the current crisis (`AskUserQuestion` with each open vow as an option).
2. Hand off to `ironsworn-progress-tracks` to call `forsake_vow` — the tool applies stress equal to rank automatically. (Yes, the character is about to take *more* stress on top of the stress that triggered the oracle. That is the design.)
3. Narrate: this is not a failed roll — this is the fiction breaking. The character has given up. Let the moment land.

If the player has *no* open vows, the result becomes "you give in to a fear or compulsion" (treat as 26-50) — no Forsake possible.

### The 26-50 Compulsion Branch

The character acts against their better instincts. This is fiction, not a tool call:
- Strike out at an ally
- Flee a fight they could have won
- Speak a truth that breaks a confidence
- Take a drink, embrace a vice, hand over a relic

Anchor it to lore via `search_lore_global` — what compulsion is *this character* prone to? Existing NPCs / threads will hint at the right shape.

---

## Worked Examples

**Example 1 — social betrayal, mid-spirit.** Trusted NPC sells out the character. `suffer_stress` n=2 (spirit 4 → 2). Roll Endure Stress vs heart: weak hit. Press on. The character takes the blow but pushes forward.

**Example 2 — at 0 spirit, miss.** Spirit is 0, shaken marked, corrupted unmarked. New stress event. `suffer_stress` n=1. Roll: miss. `take_momentum` n=-1. Corrupted is unmarked → `inflict_debility` "corrupted". The character is now corrupted: they are starting to make peace with darker thoughts. Narrate it.

**Example 3 — at 0 spirit, both stress debilities marked, miss → oracle 18.** `roll_oracle` "Endure Stress" returns 18. Forsake. Player has two open vows (rank dangerous, rank formidable). Ask which is most tied to the crisis. Player picks formidable. Hand off to `ironsworn-progress-tracks`: `forsake_vow` track_name=`<vow>`. The tool applies 3 stress (formidable = 3). Spirit was already 0; nothing further to lose mechanically — but narratively the vow is dust.

---

## Edge Cases

- **No open vows, oracle 11-25:** treat as 26-50 (compulsion).
- **Already-tormented character:** the cursed/tormented debility has its own clear condition (complete a quest); Endure Stress can still happen and can still inflict shaken or corrupted as normal.
- **Stress and harm in the same beat:** they are separate moves. Pick the one the fiction emphasizes; do not roll both unless the source genuinely inflicts both (e.g., a wraith's touch — physical and mental harm).
