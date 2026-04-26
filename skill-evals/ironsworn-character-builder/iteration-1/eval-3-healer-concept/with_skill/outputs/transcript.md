# Eval 3 — Healer Concept: Character Creation Transcript

**Skill:** ironsworn-character-builder  
**Eval Prompt:** "I want to make a character. I know I want to be some kind of healer or herbalist type — bad at fighting, good at helping people. I'm not sure about the vows yet, can we figure those out together?"

---

## Step 0: Concept Check

**GM:** That's a vivid starting point — someone who leans toward mending rather than breaking. Before we get into numbers, let me ask one thing: *who is this healer?* Are they the village midwife who's been forced into the wilds? A wandering apothecary who trades remedies for passage? Someone who watched someone die because they arrived too late and decided never again?

Even a rough image helps. Or if you'd rather let the character emerge as we build, we can do that too.

**PLAYER:** I like the idea of someone who travels between settlements — a wandering healer who people are always glad to see. But there's also something quiet and sad about them. Like they've lost people they couldn't save.

**GM:** I love that — the healer who carries their failures as their compass. Let's build around that. Someone the Ironlands knows to welcome, but who sleeps lightly and thinks about the ones they couldn't reach in time.

---

## Step 1: Name

**GM:** What's your character's name? I can roll on the Ironlander Names oracle if you'd prefer.

**PLAYER:** Let's roll. Two options, please.

```
[TOOL: roll_oracle("Ironlander Names")]
→ Result: "Mira"

[TOOL: roll_oracle("Ironlander Names")]
→ Result: "Dessa"
```

**GM:** The oracle gives us **Mira** and **Dessa**. Mira has something soft and worn to it — like a name people have been calling out from doorways for years. Dessa feels a little more solitary, more road-worn. Which one feels right?

**PLAYER:** Mira. Definitely Mira.

**GM:** Mira it is.

```
[TOOL: override("name", "Mira")]
```

---

## Step 2: Stats

**GM:** Five stats, and they tell the story of who Mira is before we ever play a scene.

- **Edge** — quickness, agility, striking first. The hunter. The runner.
- **Heart** — courage, empathy, willpower. The one who holds the room, who calms the frightened, who doesn't break when everything is falling apart.
- **Iron** — strength, endurance, close combat. The one who goes first through the door.
- **Shadow** — cunning, stealth, deception. The one working the angles.
- **Wits** — knowledge, observation, expertise. The planner. The one who reads symptoms, reads people, reads terrain.

You assign **3, 2, 2, 1, 1** across those five — any order.

You said bad at fighting, good at helping. In Ironsworn terms, that points toward **Heart** as her core — the warmth and will that makes people trust her — and **Wits** to match, because a wandering healer survives by knowing things: what plant grows in what soil, when a fever turns, how to read a crowd before it turns dangerous.

**Iron** should be low — she's not the warrior at the front. **Edge** and **Shadow** might sit somewhere in between. What's your instinct?

**PLAYER:** Heart 3 — that's her. She keeps going because she can't not. Wits 2 because she's learned everything the hard way. Iron 1 obviously. What about the other two?

**GM:** You've got a 2 and a 1 left for Edge and Shadow. Does Mira move quickly — fleet on her feet, good at getting out before things turn bad? Or does she know how to be quiet, how to slip into a hamlet at dusk and slip out before anyone asks too many questions?

**PLAYER:** She's not sneaky exactly, but she does know how to read a room and disappear when she needs to. I'd say Shadow 2, Edge 1.

**GM:** So: Heart 3, Wits 2, Shadow 2, Iron 1, Edge 1. That's a person who leads with warmth and reads the world with hard-won knowledge. She'll be a force when it comes to healing, calming, persuading, reading a situation — and she'll struggle when the world demands she stand and fight. That feels right for Mira.

```
[TOOL: override("stats.heart", 3)]
[TOOL: override("stats.wits", 2)]
[TOOL: override("stats.shadow", 2)]
[TOOL: override("stats.iron", 1)]
[TOOL: override("stats.edge", 1)]
```

---

## Step 3: Starting Resources

**GM:** You start healthy, supplied, and unbroken — 5 health, 5 spirit, 5 supply, +2 momentum. Mira sets out with her satchel stocked, her spirit intact, whatever that quiet grief is still carried somewhere underneath.

```
[TOOL: override("health", 5)]
[TOOL: override("spirit", 5)]
[TOOL: override("supply", 5)]
[TOOL: override("momentum", 2)]
[TOOL: override("momentumReset", 2)]
[TOOL: override("bonds", 0)]
```

---

## Step 4: Assets

**GM:** Three assets. I want to suggest some that fit Mira tightly, because the concept you've described unlocks some really good options. Let me give you a focused list:

**The obvious one:**

- **Herbalist** *(Path)* — When you attempt to Heal using herbal remedies and you have at least +1 supply, add +2 *or* heal an additional +1 health on a hit. This is Mira's core mechanical identity — her hands and her satchel and her knowledge. It would be strange not to have it.

**Other Paths that fit:**

- **Bonded** *(Path)* — Whenever a move would give you a bonus for sharing a bond, add +1 more. Mira is the healer everyone knows. Her life is built on these connections. As those bonds accumulate through play, this makes each one count more.

- **Loyalist** *(Path)* — When you Aid Your Ally, add +1 and take +1 momentum on a hit. The helper's asset — mechanically rewards putting other people first. If Mira travels with others or joins up with people frequently, this is always turning.

- **Lorekeeper** *(Path)* — When you Secure an Advantage or Gather Information using recalled lore, add +1. A healer who knows not just plants but history, symptoms, old remedies, local knowledge. This fits the "she knows things" part of Wits 2.

- **Animal Kin** *(Path)* — When you pacify, calm, aid, or control animals, add +1 and take +1 momentum. A wandering healer might well move through the wilds with an ease around creatures. Optional, but it adds a gentle texture.

**Ritual (if magic exists):**

- **Tether** *(Ritual)* — When you commune with the spirits of a place, roll +heart. On a strong hit, you are soothed — recover spirit, feel anchored. For a healer who carries grief and keeps moving, this has emotional resonance. It's also Heart-based, which means it fires on her best stat.

There's also a **Companion** option worth mentioning:

- **Hound** *(Companion)* — Your hound's keen senses aid you when Gathering Information to track or investigate. Give your dog a name. A wandering healer with a faithful dog is a classic image.

Where does your eye go? Does Herbalist feel certain, and we're picking the other two? Or are any of these surprising you?

**PLAYER:** Herbalist is locked. I really like Bonded too — I want those connections to matter. For the third... I'm torn between Loyalist and Tether. Tether feels more interesting but also a bit magical. Does magic exist in this world?

**GM:** We haven't established that yet — we'd nail it down in world-truths, but for now you can decide for Mira. If you take Tether, it signals that magic is real and Mira has a relationship with it — quiet, private, something she doesn't talk about in every settlement but draws on when the grief gets heavy. If that appeals to you, take it. If you'd rather Mira be purely practical — herbs and hands and heart — then Loyalist grounds her beautifully and means she's at her mechanical best when helping companions.

**PLAYER:** Let's take Tether. That image of her communing with place-spirits to stay sane on the road — that's Mira.

**GM:** Three assets locked: **Herbalist**, **Bonded**, and **Tether**. 

Herbalist says she has spent years learning what grows where, what heals what, what kills quietly and what saves noisily. Bonded says every person she's helped has become a thread in a web she carries with her. Tether says there's a practice she keeps — a circle of stones, a whispered invocation, a listening — and the world whispers back.

```
[TOOL: override("assets", [
  { "name": "Herbalist", "abilities": [true, false, false] },
  { "name": "Bonded", "abilities": [true, false, false] },
  { "name": "Tether", "abilities": [true, false, false] }
])]
```

---

## Step 5: Background Vow

**GM:** The background vow is the oath that defines Mira's life — something she hasn't sworn yet in the story, but something that was always going to be sworn. Epic rank. The kind of promise that takes years.

You said she carries quiet sadness, that she's lost people she couldn't save. Let's sit with that. Was there a specific loss — a person, a village, a moment — where she feels she failed? Not just "someone died" but a particular wrong she's been unable to put down?

**PLAYER:** Hmm. I hadn't thought about it that deeply. Something like... a village that was lost to sickness? And she was the one who was supposed to help but didn't get there in time?

**GM:** That's a real thing to carry. Let's go further: why didn't she get there? Was she too far away? Was she warned and delayed? Did someone prevent her — a warlord blocking roads, a storm, her own hesitation? The "why" shapes the vow.

**PLAYER:** I like the idea that she was warned but delayed by a powerful lord who needed her for his own household. By the time she was allowed to leave, the village was gone. The lord didn't care.

**GM:** That's a wound with a face on it. A name. Power that treated her work as a service for the wealthy and let the poor die for it. That changes what her vow might be.

So here's what I'm hearing: this could be a vow of *reckoning* — she will not let wealth and power decide who receives healing and who doesn't. Or it could be a vow of *memory* — she will learn the names of every person lost in that village and ensure they are remembered. Or it could be a vow of *consequence* — she will see that lord face what he chose that day.

Or it might be something more personal: she will become skilled enough, known enough, that no lord can ever hold her like that again.

Which direction pulls at you? You don't have to choose one directly — tell me what resonates.

**PLAYER:** The last one. She will be so necessary, so trusted, so deeply bonded with communities across the Ironlands, that no lord can hold her against her will. That's the vow.

**GM:** That's beautiful and specific. Let me reflect it back as a formal vow:

*"I will forge bonds with every settlement in the Ironlands, until no lord can hold me captive and no village dies waiting."*

That's an epic vow — the scope is enormous and it means something real. Every bond she forges is a step toward it. Every time she arrives in time, she's honoring it. Does that wording feel right, or do you want to shape it differently?

**PLAYER:** "No village dies waiting" — I love that. Yes, that's it.

**GM:** Then Mira swears it — not today in-game, but it was sworn long before we started playing.

```
[TOOL: create_progress_track({ "kind": "vow", "rank": "epic", "name": "I will forge bonds with every settlement in the Ironlands, until no lord can hold me captive and no village dies waiting." })]

[TOOL: open_thread({ "title": "I will forge bonds with every settlement in the Ironlands, until no lord can hold me captive and no village dies waiting.", "description": "Mira's background vow, rooted in the loss of an unnamed village she could not reach in time. A lord delayed her; the village perished. She will not be caged like that again. Progress comes from forging bonds across the Ironlands and arriving where she is needed." })]
```

---

## Step 6: Inciting Incident

**GM:** The background vow is the long arc. The inciting incident is what kicks the story into motion *right now*. Something that can't wait, something that gets worse if ignored.

Given who Mira is — a wandering healer, deeply bonded to communities, haunted by one failed village — what's the immediate crisis that forces her to move? A few seeds:

- Word reaches her of a sickness spreading in a remote settlement she promised to visit last season. No other healer is closer.
- Someone she has a bond with sends desperate word: a child is dying and nothing the village knows is working.
- She witnesses something she was not supposed to see — a lord's guard disposing of a body, someone who was clearly poisoned, not sick. The cover-up requires her silence or her death.

Or we can roll an oracle for a seed. What draws you?

**PLAYER:** The first one. She promised to visit Thornwall — a small settlement two weeks' travel north — before the cold set in. She's late, and now someone from there has found her on the road with news of a wasting sickness taking the children.

**GM:** A child-killer sickness, a broken promise, and a messenger who's ridden hard to find her. That's a formidable vow — something she can resolve within a handful of sessions if all goes well, but with real consequences if it doesn't.

*"I will reach Thornwall and stop the wasting sickness before the children are beyond help."*

Formidable rank feels right — this is urgent and dangerous but not impossible. Shall I set it there?

**PLAYER:** Yes.

```
[TOOL: create_progress_track({ "kind": "vow", "rank": "formidable", "name": "I will reach Thornwall and stop the wasting sickness before the children are beyond help." })]

[TOOL: open_thread({ "title": "I will reach Thornwall and stop the wasting sickness before the children are beyond help.", "description": "A messenger from Thornwall found Mira on the road. Children are dying of a wasting sickness. Mira promised to visit before the cold season; she is already late. She has not yet sworn this vow in play — that will happen when she formally swears it at the start of session one." })]
```

---

## Step 7: Background Bonds (Optional)

**GM:** Last step: does Mira have anyone she's deeply connected to before the story begins? A mentor who taught her to read fever-signs? A settlement that has always taken her in? Someone she writes letters to, even knowing they may not reach?

These don't go on the bond counter yet — bonds are earned through play — but significant people can be recorded so we don't forget them.

**PLAYER:** Her mentor — an old woman named Asha who taught her everything. Asha is still alive, lives in a place called Ravenmoor, and Mira checks in when she's near. Also, Thornwall itself — she's been there twice and the headwoman, Berta, trusts her.

**GM:** Two anchors. Let's record them.

```
[TOOL: upsert_npc({ "name": "Asha", "description": "Mira's mentor and teacher. An elderly healer living in Ravenmoor. She taught Mira to read fever-signs, identify remedies, and survive the road. Mira returns when she can." })]

[TOOL: upsert_npc({ "name": "Berta", "description": "Headwoman of Thornwall. A pragmatic, capable leader who trusts Mira and has sheltered her on two previous visits. Her settlement is the site of the inciting incident — children are dying of a wasting sickness." })]
```

---

## Finishing Up

**GM:** Let me read Mira back to you.

```
[TOOL: get_character_full()]
```

---

### Final Readback

```
Name: Mira
Stats: Edge 1 | Heart 3 | Iron 1 | Shadow 2 | Wits 2
Assets: Herbalist, Bonded, Tether
Background Vow: "I will forge bonds with every settlement in the Ironlands, until no lord can hold me captive and no village dies waiting." (Epic)
Inciting Incident: "I will reach Thornwall and stop the wasting sickness before the children are beyond help." (Formidable)
Background Bonds: Asha (mentor, Ravenmoor), Berta (headwoman, Thornwall)

Health: 5 | Spirit: 5 | Supply: 5 | Momentum: +2
```

---

### Opening Scene

Mira is on a muddy road heading north, three days out from the last waystation, when the messenger finds her — a young man named Toryn, barely seventeen, who has ridden through the night. He is thin with the cold and his horse is barely walking. He says: *"Berta sent me. She says come fast. The children are wrong — not just sick. Wrong."*

He doesn't know more than that. He was given the message and told to ride until he found the woman with the healer's satchel and the crow-grey braid. He found her.

Mira feeds him from her own supply. She tells him to sleep. She watches the road ahead.

Whatever is happening in Thornwall, it started before she could get there. That's the part she'll carry longest, even if she saves every one of them.

---

**When you're ready, swear your first vow. The Ironlands are waiting.**
