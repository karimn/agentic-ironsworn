# GM Response — Journey to Deepcrag

---

## Setting the Scene

The name sits in your mouth like cold iron: *Deepcrag.*

You've heard it spoken in Stillwater the way people speak of graves — quietly, and only when they must. Three days north across the Mirefen, past the place where the reeds grow black and the fog never fully lifts, past whatever it is that the marsh-folk say walks the old causeway after dark. The ruined fortress has stood since before the memory of any living soul in this village. Whatever you need there, it has waited long enough to wait a little more.

But now it's your turn to go.

The morning is grey and close. Stillwater's single dirt road ends at the treeline where the ground turns soft, and you stand at that edge. The few people who have reason to be awake this early find somewhere else to look.

---

## Determining Journey Rank

Three days of travel across haunted marshland to a known-dangerous destination.

This is **Dangerous** rank. The distance is significant — multiple days — and the hazard is real (haunted marsh, hostile or unknown terrain). It isn't the edge of the world, but it isn't a stroll between villages either. A Dangerous rank means the journey occupies a meaningful stretch of story — perhaps three or four waypoints — without consuming the whole campaign arc.

---

## Creating the Progress Track

[TOOL CALL: create_progress_track(
  name: "Journey to Deepcrag",
  rank: "dangerous",
  kind: "journey"
)]

The track is created: 10 empty boxes, each requiring 2 ticks to fill (Dangerous rank = 2 ticks per tick_progress call).

Current track: `○○○○○○○○○○`

---

## Departure Narration

You turn your back on Stillwater.

The ground gives slightly underfoot the moment you leave the road — a slow yielding, like the marsh is already deciding how much of you it wants to keep. The reeds ahead stand taller than your head in places, their edges sharp enough to cut. A thin mist clings to the water between the tussocks, not thick enough to be dangerous yet, but present, like something watching from just below the surface of the air.

The fortress is out there. Three days. You begin.

---

## First Roll — Undertake a Journey (Wits)

The first leg: pushing north through the outer edge of the Mirefen, where the ground is soft but the paths are still half-visible beneath the silt.

[TOOL CALL: resolve_move(
  move: "Undertake a Journey",
  stat: "wits",
  adds: 0
)]

Note: No bond bonus applied. We do not have confirmation that Zura holds a bond with Stillwater. If the player confirms a bond with the community, add +1 to this roll retroactively.

---

**Roll result: WEAK HIT** (action score beats one challenge die, not both)

---

## Weak Hit Result

*You reach a waypoint, but it costs you.*

[TOOL CALL: tick_progress(track_name: "Journey to Deepcrag", times: 1)]
[TOOL CALL: consume_supply(n: 1)]

**Updated track** (2 ticks = 1 filled box on a Dangerous journey):
`●○○○○○○○○○`

Supply: reduced by 1. The marsh is thirsty work — waterlogged boots, a misstep into knee-deep silt, a long detour around a collapsed section of the old causeway. You burn through more than you intended.

---

## Waypoint Narration (Zoom In)

You reach what the old maps, if anyone still had them, would call the Breakwater: a crumbled stone embankment that once held back the deeper marsh. Now it's more moss than masonry, half-swallowed by the fen. From the top of the lowest intact section you can see the landscape ahead change — the reeds thicken, the water between them takes on a darker, stiller quality, and the mist does not move even when the wind does.

There's something scratched onto one of the stones — quick marks made by someone in a hurry. You recognize the rough shape of a warning glyph the marsh-folk use: *do not camp here after dark.*

The sky is still pale. You have hours yet. But you note it.

---

## What Happens Next

The journey has begun. One leg complete, the track reads `●○○○○○○○○○`. Supply has taken its first nick. Deepcrag is out there — probably two or three more waypoints at this rank before you can attempt the Reach Your Destination progress roll.

When you're ready to press on, say the word and we'll roll the next leg of Undertake a Journey. If supply gets low, we can look for a chance to Make Camp or Resupply. The marsh will keep offering complications either way.

**The road north is open, Zura. What do you do?**
