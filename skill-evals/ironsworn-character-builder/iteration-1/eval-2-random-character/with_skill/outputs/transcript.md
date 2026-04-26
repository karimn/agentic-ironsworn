# Ironsworn Character Builder — Random Character Transcript

**Skill:** ironsworn-character-builder  
**Eval:** eval-2-random-character  
**Mode:** Random  
**Prompt:** "Just generate me a random Ironsworn character. Surprise me."  
**Date:** 2026-04-26

---

## Trigger

The player said "Surprise me" — this triggers **Random Mode**. The skill executes all steps in one
sweep and presents a complete character as a fait accompli. No back-and-forth. Just a person.

---

## Step 1 — Name

Rolling on the Ironlander Names oracle twice to find a name with character.

```
[TOOL: roll_oracle("Ironlander Names")] → result: "Keelan"
[TOOL: roll_oracle("Ironlander Names")] → result: "Segura"
```

**Decision:** "Keelan" is soft and a little melancholy. "Segura" carries weight — a name that sounds
like someone who had to earn it. Going with **Segura**.

```
[TOOL: override("name", "Segura")]
```

---

## Step 2 — Stats

Random Mode calls for a thematic distribution. The oracle rolls give us a direction.

Simulating `roll_dice("5d3")` to suggest a spread, then interpreting:

```
[TOOL: roll_dice("5d3")] → results: [3, 1, 2, 2, 1]
```

Mapping to stats in order (edge, heart, iron, shadow, wits):

Raw roll: edge=3, heart=1, iron=2, shadow=2, wits=1

But this is a thematic distribution — the rule is 3/2/2/1/1 in any order. The raw roll
gives us a 3 landing on Edge and the 1s on Heart and Wits. That tells a story: a hunter,
a wary and fast person who reads landscapes rather than people. Let's lean into it.

**Final stat assignment:**

- **Edge 3** — Segura leads with speed and precision. A bow drawn before most people notice the threat.
- **Shadow 2** — Quiet. Patient. Moves through the world at an angle.
- **Iron 2** — Harder than she looks. Not a fighter by calling, but she doesn't fold.
- **Heart 1** — She holds the room by not speaking. Doesn't warm to strangers easily.
- **Wits 1** — She trusts instinct over analysis. Her knowledge is narrow and deep: the wild, not the hall.

```
[TOOL: override("stats.edge", 3)]
[TOOL: override("stats.heart", 1)]
[TOOL: override("stats.iron", 2)]
[TOOL: override("stats.shadow", 2)]
[TOOL: override("stats.wits", 1)]
```

---

## Step 3 — Starting Resources

Set without rolling — every character starts here.

```
[TOOL: override("health", 5)]
[TOOL: override("spirit", 5)]
[TOOL: override("supply", 5)]
[TOOL: override("momentum", 2)]
[TOOL: override("momentumReset", 2)]
[TOOL: override("bonds", 0)]
```

You start healthy, supplied, and unbroken — 5 health, 5 spirit, 5 supply, +2 momentum.

---

## Step 4 — Assets

Random Mode selects 1 Combat Talent + 1 Path + 1 Companion, chosen for thematic coherence.

**The concept emerging:** Segura is a hunter-scout. High edge, shadow 2. Someone who travels
alone, knows the wilds, and keeps a bird. The assets should reinforce and deepen this,
not just mechanically duplicate it.

**Combat Talent — Archer**

Segura uses a bow. Of course she does. Edge 3 with an Archer asset means she's the person
who ends threats before they close the distance. The first ability (when Securing an Advantage
by taking a moment to aim, choose approach and add +1) rewards her patience — she doesn't
rush shots. She waits.

**Path — Wildblood**

She grew up in the deep wood or on the margins, not in settlements. Wildblood's starting
ability — add +1 when using knowledge of tracking, woodcraft, or woodland creatures —
completes the portrait. She reads terrain the way other people read faces.

**Companion — Hawk**

A hawk named **Fen**. Far-seeing: when Segura Undertakes a Journey or Resupplies by hunting
small game, add +1. Fen is her eyes at distance. He's been with her longer than any person.
He doesn't judge. He hunts. She loves him for exactly that.

```
[TOOL: override("assets", [
  { "name": "Archer", "abilities": [true, false, false] },
  { "name": "Wildblood", "abilities": [true, false, false] },
  { "name": "Hawk", "abilities": [true, false, false] }
])]
[TOOL: override("customState", { "companion_name": "Fen" })]
```

**What this triad says about Segura:** She is not a soldier or a wandering sword. She is
someone who hunts — animals, information, people when she must. She works from the outside
in. The hawk keeps her from loneliness without requiring her to be soft.

---

## Step 5 — Background Vow

Rolling Action + Theme oracle to find the seed of Segura's life-defining oath.

```
[TOOL: roll_oracle("Action")] → result: "Avenge"
[TOOL: roll_oracle("Theme")]  → result: "Betrayal"
```

**Oracle result: AVENGE + BETRAYAL**

Interpretation: Someone Segura trusted sold her out — or sold out something she was
sworn to protect. This wasn't a war or a catastrophe. It was a specific person making
a specific choice. And Segura has not let it go.

**Background Vow:**

> *"I will find Davan Ashcroft and make him answer for what he did to the village of Cindermere."*

Davan was once the ironsworn protector of Cindermere — a small village at the forest's edge.
When raiders came, he was paid to look the other way. He did. Segura was hunting three days
from the village when it burned. She returned to ashes and a name. She's been carrying that
name ever since.

This vow is **epic** rank — Davan has vanished into the Hinterlands, likely under protection
of whatever clan he sold himself to. Finding him, proving the betrayal, and making him answer
for it will take years and cross enemies she hasn't made yet.

```
[TOOL: create_progress_track(kind="vow", rank="epic", name="Find Davan Ashcroft and make him answer for the burning of Cindermere")]
[TOOL: open_thread(title="Find Davan Ashcroft and make him answer for the burning of Cindermere", description="The ironsworn protector of Cindermere took coin from raiders and let the village burn. Segura returned to ashes and a name. She has carried that name across the Ironlands for three years. Davan has gone to ground somewhere in the Hinterlands — possibly sheltered by the Gray Wolf clan, who the raiders answered to. This is the oath that won't release her.")]
```

---

## Step 6 — Inciting Incident

Rolling Character Goal oracle to find what forces Segura to move *right now*.

```
[TOOL: roll_oracle("Character Goal")] → result: "Protect a person"
```

**Oracle result: PROTECT A PERSON**

Interpretation: Someone has come to Segura with information — or is in danger because
of what they know. The inciting incident isn't the background vow; it's someone
immediately at risk.

**Inciting Incident:**

> *"A child from the ruins of Cindermere — now grown, maybe fourteen — has found me. She says someone is hunting her. She knows what Davan looked like."*

Mira survived Cindermere by hiding in a root cellar. She's been living with a goat-herding
family in the foothills ever since. Three days ago she noticed a rider watching the farm.
She ran. She followed a rumor to find Segura.

If Mira dies, the last witness to Davan's face dies with her. Segura cannot allow that.
This is **formidable** rank — protecting someone while unknown hunters close in, in unfamiliar
terrain, with no allies.

```
[TOOL: create_progress_track(kind="vow", rank="formidable", name="Protect Mira and learn who sent the hunters")]
[TOOL: open_thread(title="Protect Mira and learn who sent the hunters", description="A girl named Mira — the sole survivor of the Cindermere burning — found Segura three days ago. Someone is hunting her, presumably to silence the last witness to Davan Ashcroft's betrayal. Segura has sworn to keep Mira safe and find out who ordered the hunters and why now.")]
[TOOL: upsert_npc(name="Mira", role="survivor", description="Fourteen years old, last survivor of Cindermere. Witnessed Davan Ashcroft's betrayal as a young child. Now hunted by unknown riders. Found Segura after following rumor for three days. Quiet, frightened, but not broken.")]
```

---

## Step 7 — Background Bonds

Segura doesn't bond easily, but two relationships predate the story:

**Fen** — her hawk. This is already recorded in customState. (No bond increment; bonds
form through play.)

**The goat-herd family (Tomas and Orin Veld)** — the couple who sheltered Mira for years
after Cindermere. They don't know what they were protecting. They're good people who may
now be in danger for it.

```
[TOOL: upsert_npc(name="Tomas Veld", role="farmer", description="Goat-herder in the foothills of the Reach. He and his husband Orin took in Mira after Cindermere without knowing her history. Practical and quiet. Probably has no idea hunters came to his farm.")]
[TOOL: upsert_npc(name="Orin Veld", role="farmer", description="Tomas's husband. Sharp-eyed, cautious with strangers. Might have noticed more than Tomas about the rider watching the farm. Has a gift for reading weather and people both.")]
```

---

## Final Character Summary

```
[TOOL: get_character_full]
```

---

**Name:** Segura  
**Stats:** Edge 3 | Heart 1 | Iron 2 | Shadow 2 | Wits 1  
**Assets:** Archer, Wildblood, Hawk (Fen)  
**Health:** 5 | **Spirit:** 5 | **Supply:** 5 | **Momentum:** +2  
**Bonds:** 0  

**Background Vow:** *"Find Davan Ashcroft and make him answer for the burning of Cindermere."* (epic)  
**Inciting Incident:** *"Protect Mira and learn who sent the hunters."* (formidable)  

---

## Character Sketch

Segura came back from a three-day hunt to find a village that was ash and char and one
pair of boot prints leading away in the snow. She didn't grieve at the time — she catalogued.
She found the name Davan written in someone's scorched ledger, half-legible, still readable.
She's been reading it ever since.

She works the edges of settlements now: taking contracts to scout passes, track animals,
find missing things. She doesn't ask for trust and doesn't offer it. Fen rides on her left
forearm when they walk, on her pack when they camp. Most nights the hawk is better company
than she deserves.

She is not a hero. She is a woman who made an oath over a grave-field that she has not yet
found a way to fulfill. Until she does, she keeps moving — because stopping means thinking
about the faces she can no longer remember clearly enough.

This morning, a girl walked out of the tree line and said: *"Are you Segura? Someone told me
you hated Davan Ashcroft."*

That was three days ago.

The Ironlands are waiting.

---

## Refinement Check

> "Anything you'd like to change?"

*(Player response not recorded — this is the end of the character creation session.)*
