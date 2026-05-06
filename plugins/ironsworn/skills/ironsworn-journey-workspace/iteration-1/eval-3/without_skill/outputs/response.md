# GM Response: Reach Your Destination — Journey to Deepcrag

---

## Tool Call Analysis

To resolve the **Reach Your Destination** move, the correct tool to use would be the progress roll tool — NOT the standard action roll tool. This is because Reach Your Destination is a **progress move**: you roll 2 challenge dice against the journey's progress score (6), with no action die involved.

[TOOL CALL: ironsworn_progress_roll(track_name="Journey to Deepcrag", progress_score=6, move="Reach Your Destination")]

**Why this tool and not an action roll?**
Progress moves ignore the action die entirely. You compare the progress score (6) against two challenge dice. The outcome is:
- **Strong hit:** both challenge dice < 6
- **Weak hit:** one challenge die < 6
- **Miss:** both challenge dice >= 6

**Roll result:** Challenge dice: 4 and 3
- Progress score (6) vs. challenge die 1 (4): 6 > 4 — BEAT
- Progress score (6) vs. challenge die 2 (3): 6 > 3 — BEAT
- **Result: STRONG HIT**

On a strong hit: *You reach your destination. Mark experience (1 for Troublesome, 2 for Dangerous, 3 for Formidable, 4 for Extreme, 5 for Epic). You may clear the journey track.*

Dangerous journey = **mark 2 experience**.

[TOOL CALL: update_journey_track(track_name="Journey to Deepcrag", action="complete", result="strong_hit")]
[TOOL CALL: mark_experience(amount=2, reason="Completed Dangerous journey: Journey to Deepcrag")]

---

## Narrative

The grey ridge country falls behind you at last. For days the path wound through silent moorland and half-frozen streams, the land growing harder and older with every mile. But now the land changes. The hills press closer; the stone beneath your boots is darker, almost black — volcanic, ancient. And there, tucked into a natural bowl where three ridgelines converge, you see it.

**Deepcrag.**

It is smaller than you expected, but more permanent. The buildings here are not the desperate palisade-work of a settlement still unsure of its survival — they are cut stone, low and stubborn, rooted into the hillside as though they grew there. Smoke rises from a dozen fires. The smell of rendered tallow and woodsmoke drifts down to meet you.

Hound presses close to your leg, ears forward, reading the settlement with her nose before you've taken another step. She doesn't growl. That's something.

You pause at the edge of the slope, looking down. The journey was hard — cold camps, a washed-out ford, two days of rain that turned the track to mud — but you are here, whole and unbroken. The iron in your chest feels a little lighter for it.

Whatever Deepcrag holds — whatever thread brought you here — you are ready to find it.

**Mark 2 experience. The journey is complete.**

*The road behind you closes. The work ahead begins.*

---

**Move:** Reach Your Destination (Progress Move)
**Progress Score:** 6 (24 ticks on a Dangerous track)
**Challenge Dice:** 4 and 3
**Outcome:** Strong Hit — destination reached, mark 2 experience
