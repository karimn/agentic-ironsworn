# GM Narrative Overreach Fix (Issue #26)

## Problem

The GM agent narrates player character decisions (words, actions, asset directions) and writes through multiple choice points without pausing for player input. This violates Ironsworn's player-driven design.

## Solution

Add behavioral constraints to `plugins/ironsworn/agents/ironsworn-gm.md`:

### 1. New Section: "Player Agency & Turn Pacing"

Placed after "The Fiction-First Protocol" (line ~66), before "What You Must Never Do."

Teaches positive behavior:
- Player owns their character's words, actions, and decisions (including asset/companion direction)
- GM may narrate asset involuntary reactions (growls, shies) but never commits player decisions
- Default to shorter turns; pause after beats that create choice points
- May chain 2-3 NPC/environment reactions only when no player decision is required
- When in doubt, hand back early

### 2. New Bullets in "What You Must Never Do"

Three additions:
1. Never narrate the PC speaking, acting, or making decisions
2. Never direct, dismiss, or endanger a player's companion/asset without their input (involuntary reactions OK)
3. Never write through multiple choice points without pausing

## Scope

Single file change: `plugins/ironsworn/agents/ironsworn-gm.md`. No tool changes, no schema changes, no test changes.
