---
name: ironsworn-npc-backstory
description: >
  Scaffolds NPC background, wound, silent vow, and the line they will not cross.
  Invoke this skill when you want to give an NPC real depth before they appear on
  stage — or when a significant NPC who has been present needs to be fleshed out
  because they are about to matter. Use Full scaffolding for recurring NPCs who
  will drive or complicate the campaign. Use Quick for significant one-scene NPCs
  who may return. Use Stub for background characters who might become significant.
  This skill sits upstream of ironsworn-npc-voice: voice consumes what this produces.
---

# Ironsworn NPC Backstory

This skill generates the **interior architecture** of an NPC — who they were before the player met them, what broke them, what they quietly swore afterward, and where they will not go no matter the cost. The output is a backstory record that `ironsworn-npc-voice` reads when that NPC speaks.

**Upstream of voice.** Voice is expression; backstory is source. You can run `ironsworn-npc-voice` without a backstory record, but not the other way around. When a backstory record exists, `ironsworn-npc-voice` skips its own introduction protocol and reads this record instead.

**Fiction Grounding Protocol:** Call `search_lore_global` before generating anything — does this NPC or their community already have entries? Does the role contradict or rhyme with established factions? Ground first, then scaffold.

---

## Three Scaffolding Modes

Choose the mode that fits how much this NPC matters to the campaign.

---

### Full Scaffolding — Recurring or Pivotal NPC

Use for NPCs who will recur, drive plot, or represent a significant relationship with the player. Six steps, all six oracle rolls.

**Step 1: Role** — `roll_oracle("Character Role")`
Who are they in the world, structurally? Their role is not their personality — it's their position. A "Healer" who is also a "broken veteran" is not a healer anymore; they're someone who used to believe healing was possible.

**Step 2: Descriptor** — `roll_oracle("Character Descriptor")`
Single dominant trait. This is the surface — the first impression, the word that follows their name in rumor. Bitter. Driven. Wary. It should create friction or sympathy with the Role.

**Step 3: Disposition** — `roll_oracle("Character Disposition")`
Emotional/relational stance toward the player. This is how they enter the scene — not who they are at depth, but the lens through which they filter the player. Disposition can shift; it is the first read, not the final one.

**Step 4: Wound** — `roll_oracle("Character Wound")`
The formative event or loss that shaped who they became. This is the load-bearing fact — everything else is built on top of it. The Wound is not backstory decoration; it is the source of the Silent Vow, the shape of the Line, and the reason the Descriptor is what it is.

**Step 5: Silent Vow** — synthesize from Wound
Do not roll. Derive. The Silent Vow is what the NPC promised themselves after the Wound — never stated aloud, possibly not even acknowledged consciously, but present in every choice they make. Phrase it as a first-person "I will..." statement:

- Wound: "Failed to protect someone who depended on them" → Silent Vow: "I will never be the reason someone is left behind."
- Wound: "Was cast out by a community they gave everything to" → Silent Vow: "I will not belong to anything that can take itself back."
- Wound: "Chose safety over the right thing once" → Silent Vow: "I will not make that calculation again."

The Silent Vow is the NPC's private vow — their Ironsworn oath to themselves. It may be impossible to keep. That is often the point.

**Step 6: The Line** — synthesize from Silent Vow + Wound
The one thing they will not do, no matter what is offered or threatened. Phrase it in the negative:
- "Will not leave someone behind in a fight, even if ordered to."
- "Will not name the community that cast them out, even to defend themselves."
- "Will not choose safety again when someone else is paying the cost."

The Line is where a miss on Compel lands. It is the thing that, if violated, breaks the character — or breaks the NPC's relationship with the player permanently.

**After all six steps:**

1. `search_lore_global(name + " " + role)` — does this backstory create any contradictions or resonances with established lore?
2. `upsert_npc` with:
   - `disposition` tags from Step 3 result
   - `drives` containing the Wound (one sentence) and the Silent Vow ("I will...")
   - `impression` line: the Line they will not cross (phrased as "Will not: [the Line]")
3. Output the NPC record in the standard format (see below).

---

### Quick Scaffolding — Significant One-Scene NPC

Use for NPCs who matter in this scene and may return, but whose full interior life does not need to be established yet. Three rolls; Silent Vow derived; no Line unless the scene demands one.

**Step 1:** `roll_oracle("Character Role")`
**Step 2:** `roll_oracle("Character Disposition")`
**Step 3:** Synthesize a Silent Vow from the Role + Disposition combination. The vow does not need a Wound yet — it can be implied. A "Desperate" Pilgrim's silent vow might be "I will reach the end of this road or it will bury me." That's enough.

`upsert_npc` with disposition tags, drives (the Silent Vow), and a one-line impression.

If this NPC returns and matters more, run Full Scaffolding at that point — adding the Wound and the Line retroactively.

---

### Stub Scaffolding — Background Character

Use for NPCs who exist in the scene's texture but have not yet earned full development. Two rolls; no Vow; no Line; a single-line record.

**Step 1:** `roll_oracle("Character Role")`
**Step 2:** `roll_oracle("Character Disposition")`

`upsert_npc` with disposition tags and a one-line impression. Nothing more. If this character steps forward, upgrade to Quick or Full.

---

## Standard NPC Record Output Format

After Full or Quick scaffolding, write the NPC record in this format:

```
**Description:** [Role] who [characteristic behavior derived from Descriptor + Wound]
**Impression:** [Disposition] toward outsiders. Silent vow: "[I will...]". Will not: [the Line].
**Wound:** [The formative event, one sentence]
```

Example:
```
**Description:** Healer who avoids patients who remind her of the ones she lost — keeps her hands moving so she doesn't have to look at their faces.
**Impression:** Warily open toward outsiders. Silent vow: "I will not be the last one who could have helped." Will not: abandon a patient mid-treatment, even at cost to herself.
**Wound:** Was not there when it mattered most — arrived hours after the village burned, found what was left.
```

This output is what `ironsworn-npc-voice` reads. Keep it dense and specific. Avoid adjectives that do not do work.

---

## Lore Grounding

Before synthesizing anything, call `search_lore_global` with the NPC's name and role. The oracle results are raw material — campaign texture shapes them. A "Resigned" disposition on a "Trader" in a campaign where the trade routes have collapsed is not the same as in a campaign of plenty. The Wound must land in the world that already exists.

If the lore search returns relevant entries — a faction this NPC could belong to, an event they might have survived, a community they could have been cast out of — incorporate those. The Wound is more powerful when it is *this campaign's* wound, not a generic backstory beat.

---

## Relationship to Other Skills

- **`ironsworn-npc-voice`** — reads the backstory record to generate voice. If a backstory record exists, voice skips its own introduction protocol.
- **`ironsworn-social`** — before Compel or Forge a Bond, if the NPC has a Silent Vow and a Line recorded, those must inform how the ask is framed and what a miss costs.
- **`ironsworn-character-builder`** — Step 7 (Background Bonds) may invoke this skill for bond NPCs the player wants depth on.

---

## When Not to Use This Skill

- A named NPC who has already been fully established through play — use `get_npc` and `ironsworn-npc-voice` instead.
- A crowd, a faction, or an unnamed background figure — `upsert_lore` with a brief description is sufficient.
- Right in the middle of a scene where the NPC is speaking — this is a pre-scene or between-scene tool. If the NPC is already on stage and speaking, use `ironsworn-npc-voice` directly, then backstory-fill after the scene.
