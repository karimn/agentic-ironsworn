---
name: ironsworn-scene-craft
description: >
  Cross-cutting fiction-craft skill for framing, anchoring, and closing scenes
  in Ironsworn. Activates on type-of-moment, not a specific move. ALWAYS invoke
  this skill the moment a beat warrants a real scene rather than narration —
  arrivals, confrontations, quiet recoveries, ceremonies, reveals — or when the
  player says things like "we cut to...", "describe the room", "set the scene",
  "I walk in", "what does it look like", "we arrive at", "I find them", "back
  at camp", "the next morning", or any phrase that asks the GM to render a
  place, a tableau, or a moment of visible tension. Owns scene framing
  (situation + tension + visible stake), sensory anchoring (three details, not
  five), beat selection (which moment is the scene about — cut the rest), and
  closing on a question, an image, or a decision rather than a summary. Defers
  NPC dialogue and reactions to ironsworn-npc-voice; defers the
  montage-vs-scene zoom decision to ironsworn-pacing. Never improvise GM
  principles from training memory.
---

# Ironsworn Scene Craft

**Fiction Grounding Protocol:** Must invoke before framing any scene that introduces or invokes a place, NPC, faction, or past event — see `agents/ironsworn-gm.md`.

A scene has a place, a moment, a stake, and an exit. This skill is the operational form of the rulebook's *Begin and End with the Fiction* principle (Ch. 7, p. 226). It loads alongside any mechanics skill when the texture of a moment matters more than the dice.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `recall` | Before framing — grounding dossier: entities + scenes + communities (Fiction Grounding #103) |
| `search_lore` | Targeted lookup: name-collision check, type filter, resolving a specific ID |
| `list_threads` | Pick an open thread to surface as visible tension |
| `search_scenes` | Sanity-check tone/sensory choices against prior scenes (continuity) |
| `search_rules` | Re-pull rule text whenever this skill is invoked second-hand |
| `record_scene` | After the scene closes — every recorded scene benefits from this skill |

---

## When to Invoke

- Arrivals, entries, transitions into a place.
- Confrontations, parleys, ambushes, reveals.
- Quiet recoveries (Make Camp, Sojourn, after Endure Stress).
- Ceremonies, oaths, moments of choice.
- The player asks for description ("describe the room", "set the scene", "we cut to...").
- Any time `record_scene` is about to fire.

If the moment is a transition or montage, defer to `ironsworn-pacing` *before* framing anything.

---

## Fiction Grounding Protocol (#103) — non-negotiable

Before the first sentence:

1. `recall` for the place and any faces on stage. Returns entities + their recent scenes + community summaries in one call. Pass `near: { entity: "<place-id>" }` to restrict to entities connected to this place.
2. `list_threads` (k=3–5) — pick one to surface as visible tension.

Never invent against the lore graph. If recall returns nothing, you may invent — then `upsert_entity` so the next scene matches.

Record the canon a beat establishes **on the beat** — `record_beat` with `entities` and `relations`, reusing exact grounded names. Don't leave relations for later extraction.

---

## Framing — open with three things, one short paragraph

1. **Situation.** Where, when, who. Concrete.
2. **Tension.** What is unsettled — from a thread, an NPC drive, or the prior move. Show it; don't name it.
3. **Visible stake.** A thing in frame the player can act on — the sword on the table, the empty chair, the smoke on the horizon.

Missing any of the three = description, not scene. Worked good-vs-bad pairs and the *in media res* model (Ch. 7, p. 198): `references/framing-good-vs-bad.md`.

---

## Sensory anchoring — three details, never five

Pick **three** anchors: one that **places** you (sight/space), one that grounds the **body** (smell, sound, temperature, texture), one that carries **mood** (light, weather, absence). More than three blurs; fewer is a stage set. Lean on smell, sound, and temperature before sight — they are stickier per word.

Ironlands register matters — bog, fen, hinterland, and frostbound coast each have their own palette. Biome+season+time-of-day starting points and the continuity rule (reuse one anchor in returning places, vary the others): `references/sensory-palette.md`.

---

## Beat selection — one beat per scene

Every scene is about one beat — a decision, a reveal, or a cost made visible. **Cut everything not in service of that beat.** The walk to the longhouse is not the scene; the moment the door opens is. If you can't name the beat in one sentence, you don't have a scene — defer to `ironsworn-pacing`.

---

## Closing — exit on a hook, never a summary

End on **one** of: a **question** (explicit or implicit), an **image** that resonates, or a **decision point** that hands the next move to the player. **Never close with a summary** ("the night passes uneventfully") — that's GM voice, not the world. Pair close to beat (reveal → image; confrontation that didn't break → question; arrival before action → decision point). Pairings, examples, and the post-close `record_scene` discipline: `references/closing-beats.md`.

---

## Cross-links — what this skill defers

- **NPC dialogue / reactions / voice** → `ironsworn-npc-voice` (scene-craft places the face; npc-voice gives them a mouth).
- **Zoom-vs-skip, montage decisions** → `ironsworn-pacing`.
- **Complication texture inside a scene** → `ironsworn-complications`.
- **Mechanics of a move resolving in the scene** → the relevant mechanics skill (combat, social, suffer, progress-tracks, oracle).
- **Recording** → `record_scene` after the close.

---

## Common Mistakes

- **Skipping Fiction Grounding.** `recall` first, always.
- **Five sensory details instead of three.** The fourth blunts the first three.
- **Sight-only descriptions.** Smell, sound, and temperature do more work per word.
- **Opening without a visible stake.** That's stage dressing.
- **Naming the tension instead of showing it.** "She is angry" is a label; "She doesn't look up when you enter" is a scene.
- **Closing with a summary.** End on question, image, or decision.
- **Inventing in the gap.** If lore is silent, invent — then `upsert_lore`.
