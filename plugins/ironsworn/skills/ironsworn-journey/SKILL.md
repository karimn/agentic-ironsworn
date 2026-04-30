---
name: ironsworn-journey
description: >
  Governs all Ironsworn journey play: starting a journey (Undertake a Journey),
  waypoint narration, mid-journey recovery (Make Camp, Resupply), and arrival
  (Reach Your Destination). ALWAYS invoke this skill whenever the player
  travels across the Ironlands, sets out toward a destination, or any journey
  move is triggered — including the very first step of a journey and the final
  progress roll on arrival. Never handle journey mechanics from memory alone.
---

# Ironsworn Journey Rules

Journeys are a **progress mechanic**. The destination is reached by accumulating marks on a dedicated journey progress track, then making a progress roll. Supply drain is the primary cost.

---

## Step 1 — Start the Journey

When the player sets out toward a destination across hazardous or unfamiliar lands:

**First: is this journey even necessary to roll?** If the character is traveling a relatively short distance through safe, familiar territory, don't make this move. Just narrate the trip and jump to what happens next. Reserve Undertake a Journey for travel that is genuinely hazardous or unfamiliar.

1. **Determine rank** based on distance and danger. Rank is also a pacing choice: a higher rank means more of the story is dedicated to the journey; a lower rank gets the character there faster. Use this as a guide:
   - *Troublesome* — nearby, known region; a short narrative arc
   - *Dangerous* — significant distance, some hazard
   - *Formidable* — far lands, real danger
   - *Extreme* — the edge of the known world
   - *Epic* — a voyage few have survived; a major story arc

2. **Create the progress track** — call `create_progress_track` with:
   - `name`: a short descriptive name (e.g. "Journey to Holtfen")
   - `rank`: the rank determined above
   - `kind: "journey"`

3. **Narrate the departure** — the world doesn't pause while the character packs. Ground the moment: weather, what they carry, who watches them leave, what presses on their mind.

---

## Pacing the Journey

Before each roll, make a deliberate choice about how to frame the leg:

- **Montage (zoom out):** Summarize travel in a sentence or two — a sweep of days, a blur of grey forest and grey sky. Use this for legs that serve the narrative clock but aren't inherently interesting. "Three days of hard riding bring you to the river ford."
- **Scene (zoom in):** Slow down and put the camera on the ground — what the character sees, smells, hears, decides in the moment. Use this when a waypoint is a meaningful story beat, a discovery, a choice.

Mix both modes deliberately. Don't zoom in on every waypoint; don't montage past everything. Vary the texture to match the rank and the story's current tension.

**Travel time is fluid.** One roll might represent hours, another days, depending on terrain and the journey's rank. If it matters to the fiction, make a judgment call or Ask the Oracle. Don't lock yourself to a fixed "one roll = one day" rhythm.

**Transport as fiction, not mechanics.** A horse, boat, or mule affects narrative logistics — what the character can carry, where they can go — but grants no mechanical bonus unless they have a relevant asset (such as the Horse companion). Don't add bonus dice for riding unless an asset explicitly says so.

---

## Step 2 — The Journey Loop (Undertake a Journey)

Each waypoint in the journey is one roll of **Undertake a Journey** (Wits).

**Trigger:** The character moves through the land — each roll represents meaningful travel, not every footstep. One roll per significant leg of the journey.

**Bond bonus:** If the character is setting off from a community with which they share a bond, add +1 to the *first* Undertake a Journey roll of this journey only. Pass `adds: 1` on that first `resolve_move` call.

**Roll:** `resolve_move` with move "Undertake a Journey", stat "wits".

**Outcomes:**

| Result | What happens | Tools |
|--------|-------------|-------|
| **Strong hit** | Reach a waypoint. Choose: mark progress, *or* mark progress + take +1 momentum but suffer -1 supply | `tick_progress` (1 mark); if speed chosen also `consume_supply` n=1, `take_momentum` n=1 |
| **Weak hit** | Reach a waypoint and mark progress, but suffer -1 supply | `tick_progress` (1 mark); `consume_supply` n=1 |
| **Miss** | Waylaid by a perilous event. Pay the Price. | No progress; narrate a complication or threat |

**On a strong hit — offer the choice with `AskUserQuestion`:**
```
question: "You make good progress. How do you push on?"
options:
  - value: "steady"  label: "Steady pace"        description: "Mark progress. Resources intact."
  - value: "speed"   label: "Push hard"           description: "Mark progress. +1 momentum, but -1 supply."
```

**Waypoint narration:** Every hit (strong or weak) means the character reaches a waypoint. Apply the montage/zoom-in choice from Pacing the Journey above. If zooming in, describe specifically — a landmark, a ruin, a river crossing, a forest edge. If zooming out, a vivid sentence is enough. If the waypoint is unknown, use `roll_oracle` on "Place" or "Descriptor + Focus" to give it shape.

**On any match** (doubles on the challenge dice, regardless of hit/miss): introduce something unexpected — an encounter, a dramatic feature of the landscape, or a turn in the current quest. Use `roll_oracle` on Action + Theme if unsure what the twist is.

**On a miss — Pay the Price.** You have two modes; pick one deliberately:

- **Play it out** — the miss introduces a concrete obstacle (a river, an ambush, a lost path). Resolve it with follow-on moves (Secure an Advantage, Face Danger, Battle, etc.).
- **Fast-forward** — summarize the event and apply a consequence directly (−supply, −health, −momentum, a new threat track, or a debility).

Mix the two modes across a long journey. Don't play out every miss; don't hand-wave every miss. Use `roll_yes_no` or `roll_oracle` to determine the nature of the setback if unclear.

---

## Step 3 — Mid-Journey Recovery

When supply is low or the character is battered, two recovery moves are available.

### Make Camp (Wits)

**Make Camp is optional.** The character rests and camps as appropriate without rolling. Only make the move when you want the mechanical benefit (health/spirit/momentum/supply recovery or the +1 Prepare) or when the rest is interesting enough to play out as a scene.

**Trigger:** The player wants mechanical recovery or wants to play out the rest as a scene.

**Roll:** `resolve_move` with move "Make Camp", stat "wits".

**Outcomes:**

- **Strong hit:** Choose **two** from the list below
- **Weak hit:** Choose **one** from the list below
- **Miss:** No comfort. Pay the Price.

**Recovery options — offer via `AskUserQuestion` with appropriate count:**
```
question: "You make camp. What do you tend to?" (+ "Choose two." or "Choose one.")
options:
  - value: "recuperate"  label: "Recuperate"  description: "Take +1 health for you and companions."
  - value: "partake"     label: "Partake"     description: "Suffer -1 supply, take +1 health for you and companions."
  - value: "relax"       label: "Relax"       description: "Take +1 spirit."
  - value: "focus"       label: "Focus"       description: "Take +1 momentum."
  - value: "prepare"     label: "Prepare"     description: "Add +1 to your next Undertake a Journey roll."
```

Apply the chosen effects immediately with the appropriate mutation tools (`restore_health`, `restore_spirit`, `take_momentum`, `consume_supply`). If "Prepare" is chosen, note the +1 add for the next Undertake roll.

### Resupply (Wits)

**Trigger:** The character hunts, forages, or scavenges.

**Roll:** `resolve_move` with move "Resupply", stat "wits".

**Outcomes:**

| Result | Effect | Tools |
|--------|--------|-------|
| **Strong hit** | +2 supply | `restore_supply` n=2 |
| **Weak hit** | Take up to +2 supply, but -1 momentum for each | `AskUserQuestion` to choose 0/1/2, then `restore_supply` and `take_momentum` n=-chosen |
| **Miss** | Nothing helpful. Pay the Price. | |

**On a weak hit — offer the tradeoff:**
```
question: "You find something, but the search costs you. How much do you gather?"
options:
  - value: "2"  label: "+2 supply"  description: "Lose 2 momentum."
  - value: "1"  label: "+1 supply"  description: "Lose 1 momentum."
  - value: "0"  label: "Nothing"    description: "Keep your momentum."
```

---

## Step 4 — Reach Your Destination

When the journey track has enough progress and the destination is in sight (or the player declares arrival), make the **Reach Your Destination** progress roll.

**This is a progress roll, not an action roll.** Do not use `resolve_move` — use `roll_progress` instead.

**Roll:** `roll_progress` with track_name matching the journey track name.

**Outcomes:**

| Result | What happens |
|--------|-------------|
| **Strong hit** | The situation at the destination favors you. Choose: make another move now (not a progress move) and add +1, *or* take +1 momentum |
| **Weak hit** | You arrive but face an unforeseen hazard or complication. Envision it (use `roll_oracle` if unsure). |
| **Miss** | You've gone hopelessly astray, the objective is lost, or you were misled. Clear all but one filled progress mark on the track, and raise the rank by one (if not already epic). The journey continues. |

**On a strong hit — offer the bonus:**
```
question: "The road has favored you. How do you use the advantage?"
options:
  - value: "move"      label: "Act immediately"  description: "Make another move now and add +1."
  - value: "momentum"  label: "Take momentum"    description: "Take +1 momentum."
```

**After resolution (on a hit):** The journey is over. Mark the progress track completed. Narrate arrival with the texture of what the character finds — use `search_lore` if this is a known settlement or landmark, and describe what the journey cost showing in the character's body and supplies. Call `record_scene` to capture the arrival beat.

---

## Supply Pressure

The journey rules use supply as a clock. Track it faithfully:
- Weak hit on Undertake → -1 supply
- Speed choice on strong hit → -1 supply
- Partake on Make Camp → -1 supply
- Resupply weak hit → -1 momentum per supply taken

When supply hits 0, call `inflict_debility` with "unprepared". The character cannot make progress until they resupply or reach a settlement.

---

## Common Mistakes to Avoid

- **Never skip `create_progress_track`** at journey start. Without the track, there's nothing to roll progress against at the destination.
- **Never use `resolve_move` for Reach Your Destination** — it's a progress roll, not an action roll.
- **Never narrate "they arrived" without rolling Reach Your Destination** — arrival requires the roll.
- **Always tick progress after each Undertake hit** — progress only accumulates through explicit `tick_progress` calls.
- **The Prepare option in Make Camp gives +1 add** to the *next* Undertake roll only — don't forget it, and don't apply it twice.
- **Don't roll Undertake for mundane travel** — skip the move for short, safe trips and just narrate.
- **Don't force Make Camp** — it's optional; only roll when the player wants mechanical benefit or a scene.
- **Bond bonus applies once** — only on the first Undertake roll of a journey starting from a bonded community.
