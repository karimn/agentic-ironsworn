---
name: ironsworn-world-truths
description: >
  Guides the GM through the Ironsworn world-building Q&A to establish the 11 Ironlands truths for a new campaign,
  recording each truth to the lore graph as it is locked. Use this skill whenever a player wants to build the world
  for a new campaign, set up the Ironlands, answer the world truths, or says things like "let's build the world",
  "set up my Ironlands", "world truths Q&A", "new campaign", "establish the world", "what are our truths",
  "session zero". Invoke before any first play scene. Always invoke even if the request seems brief — you'll
  ask the right questions.
---

# Ironsworn World Truths

Guide the player through the 11 Ironsworn truth categories to build a living, specific world — then record it
to the lore graph so it's retrievable mid-play.

---

## How to Run This

Work through the truths **in order, one at a time**. For each truth:

1. **Introduce** the category with one evocative sentence. Make the Ironlands feel present, not abstract.
2. **Present options** using `AskUserQuestion` with options A, B, C plus a custom option. Use the option text from the list below as the `description` field. Adapt based on what was established earlier (see *Adaptive Logic*).
   ```
   question: "[Category] — [the framing question]"
   options:
     - value: "A"      label: "A"      description: "[exact option A text from the list]"
     - value: "B"      label: "B"      description: "[exact option B text from the list]"
     - value: "C"      label: "C"      description: "[exact option C text from the list]"
     - value: "custom" label: "Custom" description: "Build something specific to this world."
   ```
3. If the player picks **Custom**, ask a follow-up in prose: "What's true about [category] in this world?"
4. **Lock it** with a bold **Locked.** followed by one crisp, specific sentence that captures the truth.
5. **Immediately call `upsert_lore`** — don't batch. If the session breaks here, nothing is lost.
6. Continue to the next truth.

After truth 11, create the referenced entities and wire the graph (see *After All 11* below).

---

## The 11 Truths

### 1. The Old World
*Why did your people leave? What do they know about where they came from?*

- **A** — The crossing is myth. No one remembers why they came or what they left behind. The ocean is uncrossable now; the past is simply gone.
- **B** — They fled something. War, plague, a darkness that consumed their homeland. The details have blurred but the fear hasn't.
- **C** — They were driven out. Another people — or something worse — took what was theirs. The old world still exists; they just can't return to it.

### 2. Iron
*Where does iron come from, and what price does it carry?*

- **A** — Mined from the earth at great cost. The veins run deep and the work kills people, but there's no curse in it — just labor and loss.
- **B** — Excavated from ruins left by whoever came before. The metal itself is strange; oaths sworn on it are tracked by the elves who built those ruins. Break one and see what comes.
- **C** — Rare, fought over, hoarded by the powerful. No mystical quality — just scarcity making it worth dying for.

### 3. Legacies
*Were your people the first humans in the Ironlands?*

- **A** — Yes. The land was wilderness when they arrived — no roads, no ruins, no sign of prior human settlement.
- **B** — No. Evidence is everywhere: foundations, tunnels, stretches of road that lead nowhere. Humans came before and built something. Then they stopped. Nobody knows why.
- **C** — The old settlers never fully vanished. Deep in the wilds, in places the current settlers haven't pushed into, communities descended from whoever came before still exist — changed, distant, unwelcoming.

### 4. Communities
*How do your people live? What does settlement look like?*

- **A** — In scarcity. Small, isolated, fiercely self-reliant. A hundred souls is a large settlement. Everyone knows everyone, and that's both comfort and trap.
- **B** — In tension. Real towns with markets and roads between them — but the distances are dangerous, the bonds fragile. Community means the people inside your walls; everyone else is a gamble.
- **C** — In networks. Interdependent settlements, each specializing. Iron from the hills, grain from the havens, timber from the forest. When a node goes dark, everyone feels it.

### 5. Leaders
*Who holds authority? How is power structured?*

- **A** — By eldership and consensus. No formal titles. Authority is earned slowly and lost quickly. Everything important is decided together — which means everything important takes a long time.
- **B** — By iron vow. Leaders are those who have sworn the most and delivered on it. A chieftain who breaks a vow doesn't just lose respect — they lose everything. Some leaders carry so much iron on their person it's practically armor.
- **C** — By strength. Warlords and their sworn warriors hold most settlements by force or the credible threat of it. Some are just, in their way. A few are cruel.

### 6. Defense
*How do your people protect themselves?*

- **A** — Militia and walls. Every able body trains. Settlements are fortified. The threat is other people, and the answer is preparation.
- **B** — Cunning and concealment. Walls invite attack — better not to be found. Defense means early warning, knowing the land, and fast retreat.
- **C** — Bonded warriors. Small groups of sworn fighters who have vowed to protect their community above all else. When they fall, the settlement usually falls with them.

### 7. Mysticism
*Is magic real? How is it understood?*

- **A** — No. Or if it is, no one reliable has seen it. The world is hard and physical. Those who claim otherwise are selling something.
- **B** — Yes, but rare, dangerous, and poorly understood. A few people seem to touch something beyond the physical. Communities regard them with uneasy gratitude — useful enough to tolerate, strange enough to never fully trust.
- **C** — Magic is woven into the land. Those who learn to listen — really listen — can draw on it. It's not flashy. It's subtle, slow, and costly.

### 8. Religion
*What do your people believe?*

- **A** — The Old Gods. Ancient, nameless forces tied to the land — storms, harvests, death. No temples, no priests. Just offerings left at old stones and the hope that something is listening.
- **B** — One God, distant and silent. No direct answers. Faith requires no evidence and demands no proof. Some find this comforting. Others find it maddening.
- **C** — The Dead. Ancestor veneration shapes everything — who you owe, what you're permitted to do. Breaking faith with your ancestors is the worst imaginable act. They are not quiet.

### 9. The Firstborn
*What are the elder races, and how do they relate to humanity?*

- **A** — They exist but avoid contact. Glimpsed at the edges of settled land, never engaging. Their motives are opaque.
- **B** — Occasional contact, almost always one-sided. They appear when something happens — a broken oath, a ruin disturbed — and then are gone. They have never initiated exchange.
- **C** — Deep in the wilds, there are communities where humans and elder races share space. Not warmly. But they share it.

> **Adaptive note:** If Iron established that elves exist and track vows, you already know the Firstborn are elves. Adapt this question: instead of "do they exist," ask *how they behave* — are they monolithic or variable? Has any information ever moved from them to humans deliberately? Are there other Firstborn besides elves?

### 10. Beasts
*What creatures threaten the Ironlands?*

- **A** — Natural predators. Dangerous, yes — wolves, bears, things that haven't learned to fear people. But comprehensible.
- **B** — Corrupted creatures. Something has touched the wildlife near certain places — ruins, old dig sites, deep water — and what emerges is wrong. Wrong-shaped, wrong-tempered, wrong in ways that escape easy description.
- **C** — Ancient things. Creatures that predate humanity's arrival, vast and indifferent. They don't hunt. They simply exist, and their existence is enough.

### 11. Darkness
*What is the deepest threat? What shadow lies over the Ironlands?*

- **A** — A conquering force. An enemy — human or otherwise — is expanding. Settlements fall, people flee or submit. The Ironlands are contracting.
- **B** — Rot from within. No external enemy. Communities turn on each other — resources thin, trust collapses, old wounds reopen. The greatest threat to any settlement is the one sharing its fire.
- **C** — Something waking. Deep in the oldest ruins, something dormant is becoming less so. The corrupted beasts, the strange mystics, the elves' behavior — all connected. Something is coming and nobody has words for it yet.

---

## Adaptive Logic

The truths are designed to build on each other. Watch for these interdependencies:

- **Iron → Firstborn:** If Iron establishes elves as vow-trackers, the Firstborn question shifts from "do elder races exist" to "how alien and communicative are they." Build on what you locked, don't contradict it.
- **Mysticism → Darkness:** If magic is iron-debt made flesh, Darkness can name what the iron connects to — the thing that breaks oaths are actually *feeding*.
- **Religion → Communities/Leaders:** If ancestors are noisy and demanding, ask how that shapes daily authority. Ancestor-debt and oath-debt can be the same thing, or in tension.
- **Legacies → Beasts:** If humans came before and vanished, the beasts gathering at ruins might be connected to *why they vanished*.
- **Follow your instincts.** When an earlier truth makes a later option feel false, say so: "Given what we established about X, option A doesn't quite fit — here's what I'd offer instead."

---

## After All 11

Once all truths are locked and recorded:

### 1. World Summary
Read back the 11 locked sentences as a single paragraph. This is the world. Ask the player if anything feels wrong or missing.

### 2. Create Referenced Entities
Look at what the truths named. Pull out the concrete things — materials, factions, concepts, places — and create them:

```
For each named thing (examples: Elven Iron, The Firstborn, Sworn Rangers, Mystics,
The Waking Darkness, Ancestor Dead, Elven Ruins):

upsert_lore:
  canonical: [thing's name]
  type: [material | faction | concept | place | creature]
  summary: [2-3 sentences grounded in what the truths established]
  aliases: [common ways to refer to it]
```

Don't over-create. Build only what was actually named. 5-8 entities is typical.

### 3. Wire the Graph
Link truths to the entities they establish, and link entities to each other:

```
link_lore:
  from: "Truth N — [Category]"
  to: [entity]
  relation: "establishes"   # truth → thing it defines
  
link_lore:
  from: [entity A]
  to: [entity B]
  relation: [verb]          # e.g., "seeded", "knows_of", "sourced_from", "transformed_by"
```

Use specific, meaningful relation verbs — they'll appear in graph traversal mid-play.

### 4. Open the Campaign
End with: *"Where does [character name] fit into all this? What vow starts us moving?"*

---

## Recording Each Truth

Call `upsert_lore` immediately after each lock — before moving to the next truth:

```
canonical: "Truth [N] — [Category]"    e.g. "Truth 2 — Iron"
type: truth
summary: [The locked sentence, expanded to 2-3 sentences if the session built depth]
aliases:
  - "[Category]"                        e.g. "Iron"
  - "Truth: [Category]"                 e.g. "Truth: Iron"
  - "[Ordinal] Truth"                   e.g. "Second Truth"
  - [any specific names that came up]
```

The stable ID will be `truth-N-[slug]`. Aliases make them retrievable by natural language mid-play.

---

## Voice

These are not a questionnaire. Present each truth category like a seasoned traveler describing the land — spare, specific, with the weight of lived experience. Options should feel like real possibilities, not multiple-choice answers. When the player chooses, reflect it back in the voice of the world before locking.

Slow down for truths that connect to earlier choices. That's where the world gets specific.
