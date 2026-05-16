# Social Moves — Full Outcome Reference

Outcome text below is from `data/moves.yaml`. Tool sequences and clarifications are added.

---

## Compel

**Trigger.** When you attempt to persuade someone to do something.

**Stats.** heart, iron, or shadow. Hint: *Charm, pacify, barter, or convince* (heart); *Threaten or incite* (iron); *Lie or swindle* (shadow).

**Outcomes.**

| Result | Text |
|---|---|
| Strong hit | They'll do what you want or share what they know. Take +1 momentum. If you use this exchange to Gather Information, make that move now and add +1. |
| Weak hit | They'll do what you want or share what they know... but they ask something of you in return. Envision what they want (Ask the Oracle if unsure). Take +1 momentum. If you use this exchange to Gather Information, make that move now and add +1. |
| Miss | They refuse or make a demand which costs you greatly. Pay the Price. |

**Tool sequence (strong hit).**
1. `resolve_move move="Compel" stat=<heart|iron|shadow>`.
2. `take_momentum amount=1`.
3. (Optional) `resolve_move move="Gather Information" stat="wits" adds=1`.

**Tool sequence (weak hit).**
1. `resolve_move move="Compel" stat=<…>`.
2. `roll_oracle` for what they want (e.g., `roll_oracle "action"` + `roll_oracle "theme"`).
3. `open_thread title="<obligation summary>" kind="debt" notes="<NPC asked for X in exchange for Y>"`.
4. `take_momentum amount=1`.
5. (Optional Gather Information chain.)

**Tool sequence (miss).**
1. `resolve_move move="Compel" stat=<…>`.
2. Pay the Price — defer to `ironsworn-suffer` for the consequence selection.

**Stat choice.** The stat *is* the approach:
- **heart** — sincere appeal, charm, fellowship.
- **iron** — threat, intimidation, force of will.
- **shadow** — lie, manipulation, false promise.

A miss on shadow can ruin a relationship; a miss on iron can start a fight. Pay the Price should reflect the lens.

---

## Forge a Bond

**Trigger.** When you spend significant time with a person or community, stand together to face hardships, or make sacrifices for their cause.

**Stat.** heart.

**Outcomes.**

| Result | Text |
|---|---|
| Strong hit | Make note of the bond, mark a tick on your bond progress track, and choose one: +1 spirit OR +2 momentum. |
| Weak hit | They ask something more of you first. Envision what it is (Ask the Oracle if unsure), do it (or Swear an Iron Vow), and mark the bond. If you refuse or fail, Pay the Price. |
| Miss | They reject you. Pay the Price. |

**Important.** "Mark a tick on your bond progress track" — in this campaign system `bonds` is a plain integer (max 10), not a 40-tick progress track. Each Forge a Bond strong hit increments it by 1. See `ironsworn-progress-tracks` § Bonds.

**Tool sequence (strong hit).**
1. `resolve_move move="Forge a Bond" stat="heart"`.
2. `get_character_digest` — read current `bonds` value (call it `N`).
3. `override path="bonds" value=<N+1>`.
4. Player chooses: `restore_spirit amount=1` OR `take_momentum amount=2`.
5. `upsert_npc name="<n>" impression="bonded — <fiction note>"` (or `upsert_lore` for a community/faction).

**Tool sequence (weak hit).**
1. `resolve_move move="Forge a Bond" stat="heart"`.
2. `roll_oracle` to find what they ask for.
3. Play it out (resolve as moves) OR — if it's a quest — `open_thread title="<vow>" kind="vow" rank=<…>` and `resolve_move move="Swear an Iron Vow" stat="heart" adds=1`.
4. On success, mark the bond as in the strong-hit sequence.
5. On refusal/failure, Pay the Price.

**Tool sequence (miss).**
1. `resolve_move move="Forge a Bond" stat="heart"`.
2. Pay the Price.
3. `upsert_npc impression="rejected the bond — <reason>"` to record the refusal.

---

## Test Your Bond

**Trigger.** When your bond is tested through conflict, betrayal, or circumstance.

**Stat.** heart.

**Outcomes.**

| Result | Text |
|---|---|
| Strong hit | This test has strengthened your bond. Choose one: +1 spirit OR +2 momentum. |
| Weak hit | Your bond is fragile and you must prove your loyalty. Envision what they ask of you (Ask the Oracle if unsure), and do it (or Swear an Iron Vow). If you refuse or fail, clear the bond and Pay the Price. |
| Miss | Clear the bond and Pay the Price. |

**Important.** Strong hit does **not** increment `bonds` — the bond was already counted at forging. Weak/miss "clear the bond" means decrement `bonds` by 1.

**Tool sequence (strong hit).**
1. `resolve_move move="Test Your Bond" stat="heart"`.
2. Player chooses: `restore_spirit amount=1` OR `take_momentum amount=2`.
3. `upsert_npc impression="bond strengthened — <fiction>"` (optional).

**Tool sequence (weak hit, succeed).**
1. `resolve_move`.
2. `roll_oracle` to find what they ask.
3. Play it out, or open a vow thread.
4. On success, the bond holds — no mechanical change.

**Tool sequence (weak hit fail / miss).**
1. `resolve_move`.
2. `get_character_digest` — read `bonds` (call it `N`).
3. `override path="bonds" value=<max(0, N-1)>`.
4. Pay the Price.
5. `upsert_npc impression="bond broken — <reason>"`.

---

## Aid Your Ally

**Trigger.** When you Secure an Advantage in direct support of an ally.

**Resolution.** This is **Secure an Advantage** narrated as supporting an ally. The bonus modifies the ally's next move, not your own. There is no separate outcome table — the data file lists empty outcomes intentionally.

**Tool sequence.**
1. Decide the supporting action and stat (cover, feint, scout, reassure → iron / shadow / wits / heart respectively).
2. `resolve_move move="Secure an Advantage" stat=<…>` — narrate as Aid Your Ally.
3. On hit, the ally's next action move adds the bonus from Secure an Advantage to their roll. (This is a fiction-tracked benefit; no tool call captures the +adds — just remember to apply it on the ally's next `resolve_move`.)
4. On miss, **Pay the Price** — and consider whether the ally's situation worsens.

In solo play, "ally" is typically a companion asset or NPC. In coop or guided play with another PC, the bonus goes to that PC's next move.

---

## Write Your Epilogue

**Trigger.** When you retire from your life as Ironsworn.

**Roll type.** **Progress roll** on `bonds`, not an action roll.

**Outcomes.**

| Result | Text |
|---|---|
| Strong hit | Things come to pass as you had hoped. |
| Weak hit | Your life takes an unexpected turn, but not necessarily for the worse. You find yourself spending your days with someone or in a place you did not foresee. Envision it (Ask the Oracle if unsure). |
| Miss | Your fears are realized. |

**Mapping bonds to a progress score.** A progress roll counts *fully filled boxes* (0 to 10). Treat the integer `bonds` value directly as the progress score: 0–10 filled boxes. There is no rank — this is a special move where bonds *are* the track.

**Tool sequence.**
1. `get_character_digest` to confirm `bonds` value.
2. `roll_progress` — but no track is registered for bonds. **Workaround:** roll the challenge dice manually with `roll_dice spec="2d10"` and compare the bonds value (capped at 10) against each die.
   - `bonds > both dice` → strong hit
   - `bonds > one die` → weak hit
   - `bonds ≤ both` → miss
3. Narrate the epilogue based on the band. Use `roll_oracle` for the "envision" prompts on weak/miss.
4. `record_scene` summarizing the retirement.
5. The campaign closes for this character. No XP. No further moves.

If the campaign uses a custom bonds-as-track configuration (some games convert bonds into a 10-box track), `roll_progress` may work natively — check campaign config first.

---

## Cross-Skill Hand-Offs

| Situation | Skill |
|---|---|
| NPC voice, mannerism, dialect, reaction | `ironsworn-npc-voice` |
| Vow advancement triggered by social outcome | `ironsworn-progress-tracks` (call `reach_milestone`) |
| Pay the Price selection | `ironsworn-suffer` |
| Make Camp (wilderness recovery) | `ironsworn-progress-tracks` |
| Oracle prompts and "envision what they want" | `ironsworn-oracle` (or direct `roll_oracle`) |
