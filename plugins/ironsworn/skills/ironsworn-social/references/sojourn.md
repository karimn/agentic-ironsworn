# Sojourn — Full Reference

**Trigger.** When you spend time in a community seeking assistance.

**Stat.** heart (only).

**Roll.** action roll via `resolve_move` with `move="Sojourn"`, `stat="heart"`.

---

## Initial Outcome

| Result | Effect |
|---|---|
| Strong hit | You and your allies may each choose **two** from the menu below. |
| Weak hit | You and your allies may each choose **one** from the menu below. |
| Miss | The community offers nothing. **Pay the Price.** |

---

## Recovery Menu

Three categories. Each chosen item is one menu pick.

### Clear a Condition

| Option | Effect | Tool |
|---|---|---|
| Mend | Clear `wounded` debility, +1 health | `clear_debility name="wounded"` then `restore_health amount=1` |
| Hearten | Clear `shaken` debility, +1 spirit | `clear_debility name="shaken"` then `restore_spirit amount=1` |
| Equip | Clear `unprepared` debility, +1 supply | `clear_debility name="unprepared"` then `restore_supply amount=1` |

### Recover

| Option | Effect | Tool |
|---|---|---|
| Recuperate | +2 health for self and any companions | `restore_health amount=2`; for each companion: `companion_restore_health companion_name=<n> amount=2` |
| Consort | +2 spirit | `restore_spirit amount=2` |
| Provision | +2 supply | `restore_supply amount=2` |
| Plan | +2 momentum | `take_momentum amount=2` |

### Provide Aid

| Option | Effect | Tool |
|---|---|---|
| Take a quest | Envision community's need (or `roll_oracle`). If you choose to help, **Swear an Iron Vow with +1**. | `open_thread` (kind=`vow`, rank=…), then `resolve_move` "Swear an Iron Vow" with adds=1 |

---

## Focused Option (after the initial roll)

After picking menu items, the player may **focus** on **one** chosen *Recover* action. Re-roll Sojourn with `focused=true`:

```
resolve_move move="Sojourn" stat="heart" focused=true
   adds=<+1 if bonded to this community, else 0>
```

| Focused result | Bonus to that one action |
|---|---|
| Strong hit | +2 more |
| Weak hit | +1 more |
| Miss | Lose ALL benefits for *that focused action only* (other menu picks remain) |

So a strong-hit Sojourn with a strong-hit focus on Plan = +2 momentum + +2 momentum = +4 momentum on the focused pick (the other menu pick is unaffected).

The +1 if bonded to the community: read `bonds`-related lore via `get_community` or `search_lore_global`. The bond bonus applies once, on the focused re-roll only.

---

## Sojourn vs Make Camp — Decision Tree

```
Is the character in a settlement / community asking for help?
├── Yes → SOJOURN (heart). This skill.
└── No → Are they on a journey, resting in the wilds?
        ├── Yes → MAKE CAMP (supply). Defer to ironsworn-progress-tracks.
        └── No → Neither move; narrate a quiet beat or invoke another move.
```

Key differences:

| | Sojourn | Make Camp |
|---|---|---|
| Stat | heart | wits (supply gate) |
| Cost | -1 supply for the visit if relevant fiction; otherwise none | -1 supply automatic |
| Setting | community / settlement / camp of allies | wilderness, on a journey track |
| Recovery menu | health, spirit, supply, momentum, debilities, quests | health, spirit, momentum, prepare for next Undertake |
| Bond bonus | +1 to focused re-roll if bonded to community | +1 to first Undertake roll if bonded community is the start |
| Skill | `ironsworn-social` | `ironsworn-progress-tracks` |

If the player is unclear about which mode they are in, ask: "Are you in a settlement, or out on the trail?"

---

## Tool Sequence (full Sojourn beat)

1. **Ground.** `search_lore_global query="<community name>"` and/or `get_community name="<n>"`. Pull tone, NPCs, prior debts.
2. **Resolve.** `resolve_move move="Sojourn" stat="heart"`.
3. **Apply.** Based on the band, present the menu (1 or 2 picks). For each pick, call the matching tool.
4. **Offer focus.** If at least one Recover action was picked, ask if the player wants to focus on one. If yes, `resolve_move move="Sojourn" stat="heart" focused=true adds=<bond bonus>`.
5. **Apply focused bonus or loss.** Strong/weak adds to the focused action; miss removes its benefits.
6. **Persist fiction.** `upsert_npc` for any new NPCs met; `record_scene` summarizing the visit; `open_thread` for any quest taken or debt incurred.

---

## Fiction Notes (extended)

A Sojourn scene is a *social transaction*, not a vending machine. The recovery menu represents what the community is willing or able to give. Even a strong hit can carry social weight:

- A community at war may give Mend and Equip but with the unspoken expectation the Ironsworn will fight for them.
- A community that distrusts the Ironsworn may grudgingly Provision but refuse Take a quest — narrate the cold welcome.
- A bonded community may offer warmth that exceeds the menu's mechanical benefit; the +1 to focused roll is the mechanical reflection of that.

Always ask: who runs this place? Who greets the Ironsworn at the gate? Who watches them eat? What price — explicit or implicit — comes with hospitality?
