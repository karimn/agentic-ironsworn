---
name: ironsworn-complications
description: >
  Cross-cutting fiction-craft skill for choosing, texturing, and delivering
  complications — the texture work behind every Pay the Price miss, every
  match, every "the world pushes back" beat. Covers palette diversity (weather,
  terrain, beasts, factions, internal, social, supply, supernatural), tying
  complications to open threads and lore, sensory delivery (show, don't tell),
  and the small → medium → large escalation curve across a session. ALWAYS
  invoke this skill on every miss with consequences, every match (strong-hit
  twist or miss complication), and every "things get worse" beat — when the
  player or GM says things like "and then things get worse", "what's the
  cost", "pay the price", "the dice say miss", "a twist", "matched dice",
  "what does the world do", "they got unlucky". The Complication Diversity
  Protocol's mechanical enforcement (`get_recent_complications`) lives in the
  GM agent — this skill is the **craft layer on top**. Defers Pay the Price
  *decision* (which consequence applies) to `ironsworn-oracle`. Never let a
  miss cost nothing; never let a complication be generic.
---

# Ironsworn Complications — Craft Layer

A miss without a cost is a lie. A complication without texture is paperwork. This skill is the craft layer between "a cost is owed" and "the player feels it."

It does **not** own the diversity protocol — `agents/ironsworn-gm.md` enforces that via `get_recent_complications`. It does **not** own which Pay the Price consequence applies — `ironsworn-oracle` does. It owns *texture*: how the cost lands in the senses, in the lore, in the campaign's weight.

---

## Tools This Skill Governs

| Tool | When |
|---|---|
| `get_recent_complications` | Before narrating any complication — diversity check (k=5). Honors the GM-agent protocol. |
| `search_lore_global` | Before invention — thematic clusters so the complication grows from the world (Fiction Grounding #103). |
| `search_lore` | Entity/name resolution: which NPC, faction, or place surfaces. |
| `list_threads` (open) | Scan for an existing thread to escalate before inventing a new one. |
| `search_rules` | Pay the Price table (p.105/116), match handling (p.9, p.117), region flavor. |
| `record_scene` | After narration, tag with `complication_theme` so the protocol can see it. |

Handoffs: `ironsworn-oracle` (which consequence), `ironsworn-suffer` (the harm/stress/supply mutation), `ironsworn-scene-craft` (sensory framing), `ironsworn-pacing` (scene vs. montage), `ironsworn-npc-voice` (when the complication is *who*).

---

## When to Invoke

- Any miss whose outcome reads "Pay the Price" — combat, journey, social, scene challenge.
- A **match** on the challenge dice — strong-hit twist or miss-heightened complication (p.9, p.117). Matched 10s on a miss = "as bad as things get."
- A weak-hit "victory comes at a cost" beat.
- The GM volunteers a complication to escalate stakes outside a specific roll.
- The player narrates "things get worse" or asks "what does the world do."

If the fiction obviously points at one cost (combat miss → harm; storm scene → freeze), skip to texture — but never skip the diversity check.

---

## The Discipline

1. **Ground first.** `search_lore_global` + `list_threads`. The world has unfinished business — complications grown from existing threads, NPC grudges, or world truths land harder than invention.
2. **Diversity check.** `get_recent_complications` (k=5). Pick a category not dominating recent history. Palette menu in `references/palette.md`.
3. **Choose the consequence type** — defer to `ironsworn-oracle`'s Pay the Price discipline (flat cost → escalate existing thread → invent rarely, 0–1/session).
4. **Texture.** One sensory beat — sound, smell, weight, cold, posture. No "you feel," "you notice," "perhaps."
5. **Apply the mutation.** Defer to `ironsworn-suffer` for `suffer_harm` / `suffer_stress` / `consume_supply` / `inflict_debility`. Never narrate harm without the tool call.
6. **Tag the scene.** `record_scene` with `complication_theme` set.

---

## Four Texture Rules

- **One sense, one detail.** The bowstring sounds like a snapped bone. The wind is suddenly inside the hood. The map page is wet and tearing.
- **Inevitable in retrospect.** The world catching up, not the GM punishing. *"Of course the snares were empty — something larger walked through."*
- **Land it on something the player cares about.** The bonded NPC, the cherished asset, the open vow — not the cheapest item on the menu.
- **Match size to moment.** Small misses cost supply or time; climactic misses change the campaign's shape. Curve in `references/escalation.md`.

---

## Cross-Links

- **Pay the Price decision** (which d100 category) → `ironsworn-oracle`. Not duplicated here; `references/palette.md` is craft translation only.
- **Diversity Protocol enforcement** → `agents/ironsworn-gm.md`. This skill honors it; the agent prompt is the source of truth.
- **Mechanical mutation** (−1 supply, suffered harm) → `ironsworn-suffer`.
- **Region/biome archetypes** → `references/by-region.md`. **Escalation curve** → `references/escalation.md`.

---

## Common Mistakes

- **A miss that costs nothing.** A hit that costs nothing isn't a hit (rulebook p.117). Always extract a price.
- **Skipping `get_recent_complications`.** Three weather-misses in a row dulls the world.
- **Inventing when an old thread fits.** `list_threads` first; escalate before invention.
- **Generic texture.** *"It is harmful"* → *"you take harm"* is paperwork. Render the wound.
- **Treating the d100 as a script.** It is a prompt — translate through campaign theme.
- **Re-rolling for a softer result.** The oracle has spoken.
- **Forgetting `record_scene`'s `complication_theme`.** The protocol can't enforce diversity it can't see.
