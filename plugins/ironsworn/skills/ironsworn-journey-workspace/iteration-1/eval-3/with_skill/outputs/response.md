# GM Response — Reach Your Destination (Journey to Deepcrag)

---

The grey ridgeline you've been tracking for two days finally breaks apart ahead of you, and through the gap you can make out the dark cluster of Deepcrag's rooftops pressed against the cliffside. The road has been hard but you've read it well, Zura. Time to see if fortune holds.

---

## The Roll

This is **Reach Your Destination** — a *progress move*, not an action move. That distinction matters.

**Why `roll_progress` and not `resolve_move`:**
`resolve_move` is for action rolls, where you roll 2d6 + a stat and compare against challenge dice. `Reach Your Destination` is a *progress roll* — you compare the filled progress score (no stat added, no modifier) directly against the challenge dice. Using `resolve_move` would incorrectly add a stat bonus and apply action roll logic. The skill rules are explicit: *"This is a progress roll, not an action roll. Do NOT use `resolve_move` — use `roll_progress` instead."*

**Tool call:**

[TOOL CALL: roll_progress(track_name="Journey to Deepcrag")]

**Result:** Progress score **6** vs. challenge dice **4** and **3**.

6 beats both. That is a **Strong Hit.**

---

## Strong Hit — The Road Has Favored You

The last mile into Deepcrag is almost easy. The trail widens, the wind dies, and your hound Bryn picks up her pace like she knows the worst is behind you. The gates — such as they are, iron-banded timber bleached pale by salt air — stand open. A watchman raises a hand. You've arrived, and arrived well.

Now the road offers you one more gift.

[TOOL CALL: AskUserQuestion(
  question="The road has favored you. How do you use the advantage?",
  options=[
    {
      "value": "move",
      "label": "Act immediately",
      "description": "Make another move now and add +1."
    },
    {
      "value": "momentum",
      "label": "Take momentum",
      "description": "Take +1 momentum."
    }
  ]
)]

---

## Scene Record

[TOOL CALL: record_scene(
  summary="Zura Rhian completed the Journey to Deepcrag with a strong hit on Reach Your Destination (progress 6 vs. 4/3). Arrived at Deepcrag without complication. Strong hit bonus pending player choice: act immediately with +1, or take +1 momentum.",
  tags=["journey", "deepcrag", "arrival", "strong-hit"]
)]

---

*The journey track for 'Journey to Deepcrag' is now closed. Whatever brought you to Deepcrag — that story starts here.*
