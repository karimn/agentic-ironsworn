# Face Death & Face Desolation — Full Procedure

These are the dramatic moves. They are rare. They may be the player's epilogue. Treat them with the weight they deserve.

---

## When Face Death Triggers

- Endure Harm oracle 1-10 ("the harm is mortal").
- Endure Harm oracle 11-20 with no Heal in the next hour or two.
- Endure Harm oracle 21-35 *if* the character is vulnerable to a foe disinclined to mercy.
- Direct fictional trigger: a killing blow, a fall from a great height, drowning, poison reaching the heart.

## When Face Desolation Triggers

- Endure Stress oracle 1-10 ("you are overwhelmed").
- Direct fictional trigger: witnessing the unspeakable, watching the world end, crossing into a place that breaks the mind.

---

## Procedure

1. **Pause the table.** Tell the player explicitly: "You are about to Face Death" (or Desolation). This is not a roll to slip past — it is a beat.
2. **Pull lore.** `search_lore_global` for the threads, NPCs, factions tied to the cause of death/desolation. The fiction here must echo the campaign.
3. **Roll.** `resolve_move` move "Face Death" or "Face Desolation", stat "heart".
4. **Apply the outcome** with care.

---

## Face Death Outcomes

| Result | What happens |
|---|---|
| Strong hit | Death rejects you. Cast back into the mortal world. Narrate why — what did Death see that turned it away? |
| Weak hit | **Player chooses.** See below. |
| Miss | Dead. Narrate the ending. Hand off to Write Your Epilogue if appropriate. |

### Weak-hit choice — `AskUserQuestion`

```
question: "Death has come. What do you do?"
options:
  - value: "sacrifice" label: "Make a noble sacrifice"
    description: "You die, but on your terms. Envision your final moments — what did your death buy?"
  - value: "bargain"   label: "Bargain with Death"
    description: "Death wants something. Swear an Iron Vow (formidable or extreme) to deliver. Fail to hit on the Vow → dead. Otherwise return, cursed."
```

### Bargain branch

If "bargain":
1. Decide what Death wants — `roll_oracle` if unsure, anchor it in lore.
2. Hand off to `ironsworn-progress-tracks` `create_progress_track` kind="vow", rank="formidable" or "extreme" (player's choice; extreme is the harder pact).
3. Roll Swear an Iron Vow immediately. Miss → dead. Hit → return.
4. On return: `inflict_debility` "cursed". The cursed debility clears *only* by completing this Vow.

---

## Face Desolation Outcomes

Same shape as Face Death, with spirit instead of body and "tormented" instead of "cursed".

| Result | What happens |
|---|---|
| Strong hit | Resist. Press on. |
| Weak hit | Player chooses: noble sacrifice (sanity breaks — narrate) OR vision-Vow. |
| Miss | Lost to despair or horror. Narrate — they may walk into the wilderness, fall silent forever, or take their own life. |

### Weak-hit vision-Vow

The character sees a dreaded future. `roll_oracle` if unsure what the vision reveals — anchor it in existing lore (a faction's rise, a friend's fall, a community's end). Swear an Iron Vow (formidable or extreme) to prevent it. Same Swear-or-die structure as Face Death.

On return: `inflict_debility` "tormented". Clears only by completing the Vow.

---

## Discipline

- **Never invoke Face Death/Desolation casually.** They are reserved for the brink — when the mortal/spiritual stakes are at maximum.
- **Always pause before rolling.** Confirm with the player. Some players want to play this beat fully; some need a breath.
- **Narrate the outcome with care.** Even a strong hit deserves prose — Death looking at the character and turning away is a gift, and the moment matters.
- **A miss is a miss.** If the dice say dead, the character is dead. Don't soften it. Hand off to whatever closing ritual the campaign uses (Write Your Epilogue if available, a final scene, a scribe of the events).
- **The bargain Vow is sacred.** It is the most narratively important vow the character will ever take. The cursed/tormented debility persists as a constant reminder until it is complete.

---

## Worked Example — Face Death

Character at 0 health, both wound debilities marked. New harm event. Endure Harm oracle returns 6 ("the harm is mortal"). GM pauses; tells player: "You are about to Face Death."

`search_lore_global` "ravager" and "old Holtfen feud" — pulls in the rival the character has been hunting; the wound was theirs.

Roll Face Death: weak hit. `AskUserQuestion`. Player picks "bargain". Asks the oracle: what does Death want? Oracle hint + the Holtfen feud → Death wants the rival's name struck from every stone in the Ironlands; the character must hunt down every grave-marker.

`create_progress_track` name="Erase the Ravager's Name" rank="extreme" kind="vow". Roll Swear an Iron Vow (heart, +1 if bonded to Holtfen): strong hit. +2 momentum. Player returns to the mortal world. `inflict_debility` "cursed". The vow becomes the spine of the next arc.
