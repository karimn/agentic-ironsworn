---
name: ironsworn-social
description: >
  Governs Ironsworn social mode of play: Compel, Sojourn, Forge a Bond, Test
  Your Bond, Aid Your Ally, and Write Your Epilogue. ALWAYS invoke this skill
  when the player says things like "I sojourn", "I want to forge a bond",
  "let's test our bond", "I compel them", "I try to persuade", "I aid my ally",
  "I want to write your epilogue", or "I retire", or whenever the GM is about
  to resolve a relationship move, increment bonds, or run a recovery scene in
  a community. Owns the NPC-mutation and thread-management sequences that
  follow social outcomes (promises, debts, retirement). Defers NPC voice and
  reactions to ironsworn-npc-voice; defers vow advancement to
  ironsworn-progress-tracks.
---

# Ironsworn Social Mode of Play

Social moves resolve persuasion, recovery in community, and the relationships that anchor the character to the Ironlands. This skill is the single source of truth for **how** these moves resolve, what tool calls follow each outcome, and where social play hands off to other skills.

**Fiction Grounding Protocol:** Must invoke before narrating NPC voice, bond stakes, or any fiction beat that introduces a place, NPC, faction, or past event — see `agents/ironsworn-gm.md`.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `resolve_move` | Compel, Sojourn, Forge a Bond, Test Your Bond, Aid Your Ally, Write Your Epilogue (action rolls) |
| `roll_progress` | Write Your Epilogue (progress roll on bonds) |
| `override` (path=`bonds`) | Increment / clear `bonds` after Forge a Bond or Test Your Bond outcomes |
| `get_character_digest` | Read current `bonds` value before mutating |
| `upsert_npc` | Record a new NPC, or update impression after a beat |
| `open_thread` (kind=`debt`) | Compel weak hit, Forge a Bond weak hit (they ask for something) |
| `open_thread` (kind=`vow`) | If the price/promise rises to an Iron Vow |
| `close_thread` | Promise fulfilled, or bond cleared |
| `restore_health` / `restore_spirit` / `restore_supply` / `take_momentum` / `clear_debility` | Sojourn recovery actions |
| `search_lore_global`, `get_npc`, `get_community` | Fiction Grounding Protocol — read BEFORE inventing |
| `roll_oracle` | "Envision what they want" / "Envision it" prompts |

---

## When to Invoke This Skill

- One of the six moves above is being triggered.
- The player says "I sojourn", "forge a bond", "test our bond", "compel", "aid my ally", "write your epilogue", or "I retire".
- About to call `override(path="bonds", ...)` — bonds only move on social outcomes.
- A Sojourn recovery menu is needed.
- An NPC has just made a demand or asked a favor (Compel weak, Forge a Bond weak, Test Your Bond weak).

For NPC voice and reactions, defer to `ironsworn-npc-voice`. For vow milestones triggered by a social beat, defer to `ironsworn-progress-tracks`.

---

## Fiction Grounding Protocol (#103)

Before narrating any non-trivial social beat, call `search_lore_global` (and `get_npc` / `get_community` when the entity is named). Pull what is already established — disposition, debts, prior bonds, community truths — and let those facts shape the scene. **Never invent a new fact about a known NPC or community without checking first.** If a fact is missing, `roll_oracle` and then `upsert_npc` / `upsert_lore` so it is durable.

---

## The Six Moves

### Compel
**Trigger:** persuade someone to do something. **Stat:** heart (charm/barter), iron (threaten/incite), or shadow (lie/swindle).

- Strong → they comply or share. `take_momentum amount=1`. Chain into Gather Information at +1 if the player wants.
- Weak → they comply, but want something back. `roll_oracle` for the demand, then `open_thread` (kind=`debt`). `take_momentum amount=1`.
- Miss → refusal or costly demand. **Pay the Price** (defer to `ironsworn-suffer`).

**Fiction Notes.** Compel is leverage, not always charm. The chosen stat is the lens — narrate to match: iron threatens, heart appeals, shadow deceives. A weak-hit debt is a *thread*, not an off-hand promise — track it.

### Sojourn
**Trigger:** spend time in a community seeking assistance. **Stat:** heart.

- Strong → choose **two** menu items.
- Weak → choose **one**.
- Miss → no recovery, **Pay the Price**.

After choosing, the player may **focus** one chosen *Recover* action: re-roll +heart (+1 if bonded to the community), strong=+2 to that action, weak=+1, miss=lose all benefits *for that focused action only*. Full menu and tool sequence in `references/sojourn.md`.

**Sojourn vs Make Camp.** Sojourn requires a community and uses heart. Make Camp is wilderness recovery on a journey and uses supply (see `ironsworn-progress-tracks`). If the character is in a settlement asking for help, it's Sojourn; if resting in the wild between waypoints, it's Make Camp.

**Fiction Notes.** Sojourn is *a scene of welcome or grudging tolerance*, not a vending machine. Who greets the Ironsworn? What is the price of hospitality? Even a strong hit can carry social weight — debts, news, oaths.

### Forge a Bond
**Trigger:** significant time, shared hardship, or sacrifice for a person or community. **Stat:** heart.

- Strong → bond made. Read `bonds` via `get_character_digest`, then `override(path="bonds", value=N+1)`. Choose: `+1 spirit` or `+2 momentum`.
- Weak → they ask for one more proof. `roll_oracle`, then either play it out OR `open_thread` (kind=`vow`) and Swear an Iron Vow. Mark the bond on success; **Pay the Price** on refusal/failure.
- Miss → rejected. **Pay the Price.**

**Fiction Notes.** Bonds are slow. The fiction must show *time, hardship, or sacrifice* — narrate the weight. After a strong hit, also `upsert_npc` (or `upsert_lore` for a community) recording the bond. `bonds` is a plain integer, not a progress track.

### Test Your Bond
**Trigger:** a bond is tested by conflict, betrayal, or circumstance. **Stat:** heart.

- Strong → bond strengthened. Choose: `+1 spirit` or `+2 momentum`. **No bond increment** — already counted at forging.
- Weak → bond is fragile. `roll_oracle`, prove loyalty (or Swear). Refuse/fail → **clear the bond** (`override(path="bonds", value=N-1)`) and **Pay the Price**.
- Miss → **clear the bond** and **Pay the Price**.

**Fiction Notes.** Testing surfaces what was always there — whatever the NPC asks for must echo the bond's origin, not a random favor. A cleared bond is a wound; reflect it in fiction and `upsert_npc` impression.

### Aid Your Ally
**Trigger:** Secure an Advantage in direct support of an ally. Resolve **as Secure an Advantage** with the bonus handed to the ally's next move. No separate outcome table.

**Fiction Notes.** Aid is a fiction frame on an existing move. Decide the supporting action (cover, feint, scout, reassure), pick the stat that matches, and resolve as Secure an Advantage — the result modifies the ally's next roll, not yours.

### Write Your Epilogue
**Trigger:** the character retires from the life of the Ironsworn. This is a **progress roll on bonds**, not an action roll: use `roll_progress` (treat each filled bond, up to 10, as a filled progress box).

- Strong → things come to pass as hoped.
- Weak → an unexpected turn — narrate the new life (`roll_oracle` if unsure).
- Miss → fears realized.

After resolution, the campaign closes for that character. **Fiction Notes.** Epilogue is the *cost-benefit ledger of bonds* paying out — few bonds risks isolation, many cashes them in for the life earned. Run it as montage, not scene.

---

## Common Mistakes

- **Forge a Bond strong hit increments the integer `bonds` field**, not a progress track. Read with `get_character_digest`, write with `override(path="bonds", value=N+1)`.
- **Test Your Bond strong hit does NOT increment** — the bond was forged already.
- **A weak-hit promise is a thread.** `open_thread` (debt or vow). Don't trust memory.
- **Don't conflate Sojourn with Make Camp** — community heart vs wilderness supply.
- **Aid Your Ally is not a separate roll table** — it's Secure an Advantage with the bonus given to the ally.
- **Write Your Epilogue uses `roll_progress` on bonds**, not `resolve_move`. It ends the campaign for that character.
- **Ground in lore first** — `search_lore_global` / `get_npc` before inventing motives, debts, or community history.

---

## References

- `references/sojourn.md` — full Sojourn outcome tables, recovery menus, focused option, Sojourn-vs-Make-Camp decision tree, tool sequence.
- `references/moves.md` — full outcome text for Compel, Forge a Bond, Test Your Bond, Aid Your Ally, Write Your Epilogue.
- `references/scenarios.md` — worked examples per move.
