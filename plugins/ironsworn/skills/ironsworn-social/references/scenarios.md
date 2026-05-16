# Worked Scenarios

Realistic walk-throughs showing tool sequences and fiction grounding for each move.

---

## Scenario 1: Compel — heart approach, weak hit

**Setup.** The Ironsworn has been turned away at the gates of a logging hamlet. They want the gatekeeper to let them in.

**Ground.**
```
search_lore_global query="logging hamlet gatekeeper"
get_community name="Westwood"     # if known
```
Returns: Westwood is suspicious of outsiders after a raider attack last winter. The gatekeeper, Hild, lost a brother in that raid.

**Roll.**
```
resolve_move move="Compel" stat="heart"
```
Result: weak hit. Action 5+heart 2+adds 0 = 7; challenge dice 6, 9.

**Fiction grounding informs the demand.** Hild lost a brother. She doesn't want a coin or a story; she wants the Ironsworn to **swear they will hunt the raiders if they come back**.

```
roll_oracle table="action+theme"   # confirmation, e.g. "Defend / Family"
open_thread title="Hild's promise: hunt the raiders" kind="debt" \
    notes="If raiders return, Ironsworn must defend Westwood"
take_momentum amount=1
```

The Ironsworn passes the gate. The thread is now durable — if raiders return next session, the GM has the obligation tracked.

---

## Scenario 2: Sojourn — strong hit with focus

**Setup.** Ironsworn arrives at the bonded community of Stonewall after a hard journey. Wounded, low spirit, low supply.

**Ground.** `get_community name="Stonewall"` — Stonewall is a fortified mining town, the Ironsworn forged a bond two sessions ago for defending it from drogs.

**Roll.**
```
resolve_move move="Sojourn" stat="heart"
```
Strong hit. Two picks.

**Player chooses.** Mend (clear wounded, +1 health) and Plan (+2 momentum).

```
clear_debility name="wounded"
restore_health amount=1
take_momentum amount=2
```

**Focus.** Player focuses on Plan. Bonded to Stonewall → +1 to the focused roll.
```
resolve_move move="Sojourn" stat="heart" focused=true adds=1
```
Strong hit on the focus. +2 more momentum on Plan.
```
take_momentum amount=2
```
Net momentum gain: +4. Net health: +1, wounded cleared. Other recovery (spirit, supply) was not picked.

```
record_scene title="Welcomed at Stonewall" \
    summary="Stonewall received the Ironsworn warmly, mended wounds, and shared news of orcish movement. Bond reaffirmed."
```

---

## Scenario 3: Forge a Bond — strong hit

**Setup.** After three sessions traveling and fighting alongside Olaric, a wandering scribe, the Ironsworn formally Forges a Bond.

**Ground.** `get_npc name="Olaric"` — Olaric is a scribe seeking lost histories of the old kingdom; bonded to no one yet.

**Roll.**
```
resolve_move move="Forge a Bond" stat="heart"
```
Strong hit.

```
get_character_digest    # returns bonds: 2
override path="bonds" value=3
take_momentum amount=2  # player's choice over +1 spirit
upsert_npc name="Olaric" impression="bonded — fellow seekers of the old histories"
```

The bond is now persistent — appears in `bonds` count, in Olaric's NPC entry, and influences Sojourn focused-roll bonuses if Olaric represents a community (he doesn't, but the principle holds for community-level bonds).

---

## Scenario 4: Test Your Bond — weak hit, refuse, clear bond

**Setup.** The Ironsworn is bonded to the Wardens, a militia. The Wardens demand the Ironsworn lead a punitive raid on a neighboring village suspected of harboring a thief. The Ironsworn believes the village is innocent.

**Roll.**
```
resolve_move move="Test Your Bond" stat="heart"
```
Weak hit.

`roll_oracle` confirms: the Wardens want the Ironsworn to lead the raid personally — proof of loyalty.

The player **refuses** on principle.

```
get_character_digest    # bonds: 4
override path="bonds" value=3
upsert_npc name="The Wardens" impression="bond broken — refused to raid Greenhill village"
```

Pay the Price (defer to `ironsworn-suffer`). The Wardens are now hostile or distant.

---

## Scenario 5: Aid Your Ally — companion in trouble

**Setup.** Companion Hound is being pulled down by a swamp creature. Player wants to Aid Your Ally.

**Choice.** The Ironsworn fires a warning bolt to give Hound an opening — wits-based feint.

```
resolve_move move="Secure an Advantage" stat="wits"
```
Strong hit, +2 to next roll.

The bonus is given to **Hound's next action**. On Hound's roll (resolve as a companion move or as a contested check), apply +2 adds.

No tool call captures the +adds for "next move on someone else" — track it in conversation and apply at the next `resolve_move` for Hound.

---

## Scenario 6: Write Your Epilogue — campaign close

**Setup.** After 30+ sessions, the Ironsworn (Eira) has fulfilled her background vow and decides to retire. `bonds = 7`.

**Ground.** `search_lore_global query="Eira"` — pulls bonds: Stonewall, Olaric, the Wardens (broken), her brother Aelric, the village of Greenhill, Captain Vrek, and Sister Mira. (7 net after one broken.)

**Roll.**
```
roll_dice spec="2d10"     # challenge dice: e.g. 4 and 9
```
Compare 7 (bonds) vs 4 and 9: 7 > 4 (yes), 7 > 9 (no). **Weak hit.**

**Outcome.** "Your life takes an unexpected turn, but not necessarily for the worse." `roll_oracle` for the new life.

The oracle returns: "Quiet teaching." Eira does not return to Stonewall, nor to Olaric. She becomes a teacher in Greenhill — the very village she once defended from the Wardens. A life she had not foreseen, but earned by her bonds.

```
record_scene title="Epilogue: Eira" \
    summary="Eira retires to Greenhill. She becomes a village teacher, surrounded by children who will never know what she carried."
```

The campaign closes for Eira.
