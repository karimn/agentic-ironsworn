# GM Complication Diversity — Design Spec

**Issue:** #25
**Date:** 2026-05-05
**Goal:** Diversify the sources of complication the GM agent draws from, so misses and oracle results pull from a broader thematic palette rather than gravitating toward a single dominant storyline.

---

## Overview

The GM agent tends to route all complications through whichever campaign lore element is most prominent, producing thematic flatness and repetitive vocabulary. This design introduces a **Complication Diversity Protocol** that forces the GM to review recent complications before narrating a new one, and consciously select a different thematic category.

Three changes work together:

1. **Schema addition** — `record_scene` gains an optional `complication_theme` field
2. **New tool** — `get_recent_complications` retrieves recent complication-tagged scenes
3. **Prompt additions** — the GM agent gets a Complication Diversity Protocol and a Complication Palette

---

## 1. Schema Change: `record_scene`

Add an optional `complication_theme` parameter:

```typescript
complication_theme: z.string().optional()
  .describe("Freeform thematic category of the complication (e.g. 'weather', 'beasts', 'fungal-network', 'bandits', 'physical-hazard'). Set only when the scene involves a miss/complication.")
```

- Freeform string, not an enum — new themes emerge organically
- Persisted alongside the scene summary in the scene store
- Only set when the scene involves a complication; null for non-complication scenes

---

## 2. New Tool: `get_recent_complications`

**Location:** `plugins/ironsworn/scribe/src/tools/read.ts` (alongside `search_scenes`)

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `k` | number (int, positive, optional) | 5 | Number of recent complications to return |

**Behavior:**

- Query the scene store for scenes where `complication_theme IS NOT NULL`
- Order by recency (newest first)
- Return the top k results

**Return shape:**

```json
[
  {
    "summary": "A river crossing collapsed under Zura's weight...",
    "complication_theme": "physical-hazard",
    "kind": "exploration",
    "timestamp": "2026-05-04T..."
  }
]
```

---

## 3. GM Agent Prompt: Complication Diversity Protocol

### 3a. New Section: "Complication Diversity Protocol"

Placed after "Oracle Interpretation" in the Tone and Voice area of `ironsworn-gm.md`.

**Protocol (triggered before narrating any miss / Pay the Price):**

1. Call `get_recent_complications` (k=5)
2. Note which `complication_theme` values appear — especially any that repeat
3. Choose a *different* thematic category for this complication
4. If the fiction genuinely demands the same theme (the character is literally inside the threat's domain), it's allowed — but find a fresh angle within that theme
5. After narrating, call `record_scene` with `complication_theme` set

### 3b. New Subsection: "Complication Palette"

A non-exhaustive list of thematic levers:

- Weather / cold / exhaustion — the land itself as antagonist
- Beasts / wildlife — natural or corrupted
- Supernatural threats — whatever darkness the world truths established
- Political / factional tension — rival settlements, power struggles
- Ancient infrastructure — ruins, old roads, unstable structures
- Plain physical hazard — injury, terrain, structural collapse
- Interpersonal / social friction — mistrust, conflicting goals, old grudges
- Supply / resource scarcity
- Isolation / disorientation — lost, cut off, no help coming

Closing note: *"This list is not closed. Pull from your campaign's world truths to discover categories specific to this setting — but rotate among them."*

---

## 4. Journey Skill Cross-Reference

Add a one-line reminder in the journey skill's "On a miss — Pay the Price" section:

> **Before narrating the complication, follow the Complication Diversity Protocol** — call `get_recent_complications` and choose a theme that hasn't dominated recent play.

The GM agent owns the full protocol; the journey skill just reminds the GM to follow it at this trigger point.

---

## Non-Goals

- Do not remove or weaken any existing campaign lore — dominant themes should still carry weight when contextually appropriate
- Do not enforce a rigid rotation — variety should feel natural
- Do not add vocabulary ban-lists or cooldown timers — the diversity protocol is a heuristic check, not a hard rule

---

## Implementation Notes

- The scene store already supports freeform fields — `complication_theme` should be straightforward to add
- `get_recent_complications` is a simple filter + sort query, no semantic search needed
- The prompt changes are self-contained in two files: `ironsworn-gm.md` and `ironsworn-journey/SKILL.md`
