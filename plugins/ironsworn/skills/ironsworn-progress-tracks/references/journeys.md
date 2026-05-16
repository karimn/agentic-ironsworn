# Journey Workflow Reference

Full procedures for journey play. The main `ironsworn-progress-tracks` SKILL.md links here.

---

## 1. Start the Journey

**First: is this journey even necessary?** Short, safe trips through familiar territory don't get rolled — narrate and move on. Reserve Undertake a Journey for genuinely hazardous or unfamiliar travel.

1. **Determine rank** by distance, danger, and pacing intent:
   - Troublesome — nearby, known region; a short narrative arc
   - Dangerous — significant distance, some hazard
   - Formidable — far lands, real danger
   - Extreme — the edge of the known world
   - Epic — a voyage few have survived

2. `create_progress_track` with `name` (e.g. "Journey to Holtfen"), `rank`, `kind: "journey"`.

3. Narrate the departure — weather, what they carry, who watches them leave.

---

## 2. Pacing the Journey

Before each roll, choose:

- **Montage (zoom out):** Summarize travel in a sentence. Use for legs that serve the narrative clock but aren't intrinsically interesting.
- **Scene (zoom in):** Slow down. Use when a waypoint is a real story beat.

Mix deliberately. Don't zoom in on every leg; don't montage past everything.

**Travel time is fluid.** One roll might be hours or days. Don't lock to "one roll = one day."

**Transport is fiction, not bonus.** A horse/boat/mule changes logistics, not dice — unless an asset says so.

---

## 3. Undertake a Journey (Wits)

Each waypoint is one roll.

**Bond bonus:** Setting off from a community with which the character has a bond → add +1 to the *first* Undertake roll only (`adds: 1` on the first `resolve_move`).

**Roll:** `resolve_move` with move "Undertake a Journey", stat "wits".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | Reach a waypoint. Choose: mark progress, or mark progress + take +1 momentum but suffer -1 supply | `tick_progress` (marks=1); if speed: also `consume_supply` n=1, `take_momentum` n=1 |
| Weak hit | Reach a waypoint, mark progress, suffer -1 supply | `tick_progress` (marks=1); `consume_supply` n=1 |
| Miss | Waylaid. Pay the Price. | No progress; narrate complication |

**On strong hit — offer choice:**
```
question: "You make good progress. How do you push on?"
options:
  - value: "steady"  label: "Steady pace"  description: "Mark progress. Resources intact."
  - value: "speed"   label: "Push hard"    description: "Mark progress. +1 momentum, but -1 supply."
```

**On any match (doubles on challenge dice):** introduce something unexpected. Use `roll_oracle` if unsure.

**On a miss — Pay the Price.** Either play it out (concrete obstacle, resolve with follow-on moves) or fast-forward (apply a consequence directly: −supply, −health, −momentum, debility, or a new threat track). Mix the two over a long journey.

**Complication Diversity:** Before narrating the complication, follow the Complication Diversity Protocol in the GM agent — call `get_recent_complications` and pick a fresh theme.

---

## 4. Mid-Journey Recovery

### Make Camp (Wits)

Optional. Only roll when the player wants mechanical benefit or you want to play out the rest as a scene.

**Roll:** `resolve_move` with move "Make Camp", stat "wits".

- Strong hit: choose **two**
- Weak hit: choose **one**
- Miss: no comfort. Pay the Price.

```
question: "You make camp. What do you tend to?" (+ "Choose two." or "Choose one.")
options:
  - value: "recuperate"  label: "Recuperate"  description: "+1 health for you and companions."
  - value: "partake"     label: "Partake"     description: "−1 supply, +1 health for you and companions."
  - value: "relax"       label: "Relax"       description: "+1 spirit."
  - value: "focus"       label: "Focus"       description: "+1 momentum."
  - value: "prepare"     label: "Prepare"     description: "+1 to your next Undertake a Journey roll."
```

Apply effects with `restore_health` / `restore_spirit` / `take_momentum` / `consume_supply`. If "Prepare" is chosen, remember to add +1 to the *next* Undertake roll (and only the next).

### Resupply (Wits)

**Roll:** `resolve_move` with move "Resupply", stat "wits".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | +2 supply | `restore_supply` n=2 |
| Weak hit | Up to +2 supply, but -1 momentum each | `AskUserQuestion`, then `restore_supply` and `take_momentum` n=−chosen |
| Miss | Pay the Price | |

```
question: "You find something, but the search costs you. How much do you gather?"
options:
  - value: "2"  label: "+2 supply"  description: "Lose 2 momentum."
  - value: "1"  label: "+1 supply"  description: "Lose 1 momentum."
  - value: "0"  label: "Nothing"    description: "Keep your momentum."
```

---

## 5. Reach Your Destination

When the journey track has enough progress and arrival is in sight:

**This is a progress roll, not an action roll.** Use `roll_progress`, not `resolve_move`.

**Roll:** `roll_progress` with `track_name=<journey name>`.

| Result | Effect |
|---|---|
| Strong hit | Destination favors you. Choose: make another move (not a progress move) and add +1, OR take +1 momentum |
| Weak hit | Arrive but face an unforeseen complication. Envision it (use `roll_oracle` if unsure). |
| Miss | Hopelessly astray. Clear all but one filled progress, raise rank by one (epic stays epic). The journey continues. |

**On strong hit — offer choice:**
```
question: "The road has favored you. How do you use the advantage?"
options:
  - value: "move"      label: "Act immediately"  description: "Make another move now and add +1."
  - value: "momentum"  label: "Take momentum"    description: "Take +1 momentum."
```

**After resolution (on a hit):** the journey is over. Call `fulfill_progress` (journeys grant 0 XP regardless). Narrate arrival; use `search_lore` if known. Call `record_scene` for the arrival beat.

---

## 6. Journeys and Vows — Cross-Link

Arrival can be a milestone for a related vow. If the journey directly served a quest, after closing the journey track, **call `reach_milestone` separately on the vow.** Do not double-tick the journey track itself.

Example: Saskia journeys to Cinderhome to save the overseer. On arrival (Reach Your Destination strong hit) → `fulfill_progress` on "Journey to Cinderhome" → `reach_milestone` on "Save the Overseer".

---

## 7. Supply Pressure

Track supply faithfully:
- Weak hit on Undertake → −1 supply
- Speed choice on strong hit → −1 supply
- Partake on Make Camp → −1 supply
- Resupply weak hit → −1 momentum per supply taken

When supply hits 0: `inflict_debility` with "unprepared". The character cannot make progress until they resupply or reach a settlement.

---

## 8. Common Mistakes

- **Never skip `create_progress_track`** at journey start.
- **Never use `resolve_move` for Reach Your Destination** — it's a progress roll.
- **Never narrate "they arrived" without rolling Reach Your Destination.**
- **Always `tick_progress` after each Undertake hit** — progress only accumulates through explicit calls.
- **The Prepare option in Make Camp** gives +1 to the *next* Undertake only — apply once.
- **Don't roll Undertake for mundane travel** — narrate short, safe trips.
- **Don't force Make Camp** — optional; only roll for mechanical benefit or scene.
- **Bond bonus applies once** — only the first Undertake roll of a journey from a bonded community.
- **Journey arrival → vow milestone is a SEPARATE call** — `fulfill_progress` on the journey, then `reach_milestone` on the vow. Don't double-tick.
