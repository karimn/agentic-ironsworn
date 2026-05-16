---
name: ironsworn-npc-voice
description: >
  Governs NPC voice, motivation, reactions, and continuity in Ironsworn fiction.
  ALWAYS invoke this skill whenever an NPC has a non-trivial line of dialogue
  or reaction — when the player narrates or asks things like "<name> says",
  "how does <name> respond", "what does <name> think of this", "I talk to
  <name>", "what does <name> do", "they reply", or whenever the GM is about
  to put words in an NPC's mouth or describe their reaction. Cross-cuts every
  mechanics skill; activates on the *moment of speech or reaction*, not on a
  specific move. Defers bond mechanics to ironsworn-social and initial NPC
  creation to ironsworn-character-builder. Never improvise NPC voice from
  memory alone — always ground in lore first.
---

# Ironsworn NPC Voice

NPCs in Ironsworn have no stats — they exist entirely in fiction (rulebook p. 24, 133). This skill is the craft layer for keeping them **distinctive, motivated, and continuous** across sessions. Every line and reaction must be grounded in the lore record.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `get_npc` | Read full NPC record before generating any dialogue or reaction |
| `search_lore_global` | Pull faction, prior scenes, related entities, debts |
| `search_rules` | Confirm rulebook texture (Compel, NPC drives) before paraphrasing |
| `upsert_npc` | Capture significant development — new disposition, revealed secret, shifted impression |

---

## When to Invoke

- An NPC is about to speak — any quoted line, any "they reply", any "<name> says..."
- The player asks "how does <name> respond / feel / react?"
- An NPC must react under pressure (Compel weak/miss, Test Your Bond, betrayal, reveal)
- The GM is describing tone or body-language in a beat that matters
- A returning NPC steps onstage — voice continuity check is mandatory

Defer bond increments and the social-move outcome tables (Compel, Sojourn, Forge/Test Your Bond) to `ironsworn-social`. Defer first-time NPC scaffolding inside character creation to `ironsworn-character-builder`. This skill teaches *how they sound*, not *what mechanic resolves the beat*.

---

## Fiction Grounding Protocol (#103) — Mandatory Before Speech

Before generating any line, body-language beat, or reaction:

1. `get_npc(name)` — disposition, drives, impressions, bonds.
2. `search_lore_global(query)` for the NPC's faction, community, related entities, recent scenes.
3. If a fact is missing (accent, opinion of player, secret), `roll_oracle` first, then `upsert_npc` so the answer is durable.

**Voice must match what is recorded.** A returning NPC who was "warily curious" last scene cannot suddenly be effusive without an in-fiction reason. If the recorded fact contradicts the moment you want, either play the recorded fact or have the NPC visibly change — and `upsert_npc` to capture the shift.

---

## The Three Pillars

### 1. Voice — how they sound
Three tight constraints per significant NPC, drawn from disposition tags, faction, and rulebook NPC features (p. 146):

- **Vocabulary** — words they use *and words they avoid*
- **Rhythm** — clipped vs flowing, riddled vs blunt, formal vs intimate
- **Negative space** — truths they hide, names they refuse, oaths they will not break

Continuity across sessions comes from re-reading the record every time. Palette in `references/voice-archetypes.md`.

### 2. Motivation — what they want this scene
Three answers held in the moment:

- **Want** — what they are trying to get out of this scene
- **Fear** — what they are trying to avoid or hide
- **Will not budge on** — the line they will pay any cost to defend

These flow from recorded **drives** (rulebook p. 146). Drives are an outline; this scene's want/fear is the shape drives take *now*. If unclear, `roll_oracle("what do they want from this exchange?")` and `upsert_npc`.

### 3. Reaction — how they respond under pressure
Rulebook discipline (p. 80, 146, 148): strong hit → they comply, but *how* reflects drives; weak hit → the ask back echoes want/fear, never a generic favor; miss → refusal or costly demand voiced from what they will not budge on. Under bond strain (Test Your Bond, Compel against a bonded NPC) the recorded bond shapes how loud and how wounded the reaction sounds. NPCs do not roll dice — when next action is unclear, **Ask the Oracle** (rulebook p. 89, 215).

---

## Where Voice Lands in a Scene

Delivered inside `ironsworn-scene-craft`'s structure: the NPC's **scene-want** is usually the **visible-stake** line of framing; a delivered line lands best as the scene's **closing image** or **question** (see `ironsworn-scene-craft/references/closing-beats.md`); reactions under bond strain belong in a *zoomed-in* beat — if the beat can't be named in one sentence, defer to `ironsworn-pacing`.

---

## Capturing Development

When a beat reveals something durable — a secret named, a disposition shifted, a new drive surfaced — call `upsert_npc` with the updated impression and tags. Without this, next session's voice drifts. Bond increments themselves are governed by `ironsworn-social`.

---

## References

- `references/voice-archetypes.md` — voice archetypes as a starting palette
- `references/example-dialogues.md` — worked examples: returning-NPC continuity, bond strain, miss-on-Compel refusal in-voice
