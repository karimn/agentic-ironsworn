# Progress Tracks Skill — Design Spec

**Issue:** #60
**Date:** 2026-05-15
**Goal:** Eliminate vow/journey progress drift during play. Replace fragmented guidance and ambiguous tick semantics with a single unified skill backed by purpose-built MCP tools.

---

## Problem

Three failure modes have appeared in actual play:

1. **Forgotten ticks.** Vow and journey tracks stay at zero while the fiction has clearly earned progress; the GM patches retroactively at session end.
2. **Wrong tick count.** `tick_progress(marks=N)` is overloaded — `marks` means "milestone events," not boxes. A GM passing `marks=2` for a dangerous vow milestone adds 16 ticks (4 boxes) instead of the RAW-correct 8 ticks (2 boxes). Caused over-ticking in session 7.
3. **Inconsistent UI.** Progress display rules live in `ironsworn-gm.md`; tick semantics live in `tools/mutations.ts`; vow milestone discipline lives nowhere. The GM has to reassemble the rules from three places under pressure.

The current `ironsworn-journey` skill covers journey waypoints well but leaves vow milestones unhandled, and the broader rules of progress tracks (combat, bonds, scene challenges) are scattered.

---

## Solution Overview

Three coordinated changes:

1. **One unified skill** — `ironsworn-progress-tracks` — that owns every progress-track interaction (vows, journeys, combat, bonds, scene challenges) including display rules. Replaces `ironsworn-journey`.
2. **Three new MCP tools** — `reach_milestone`, `forsake_vow`, `recommit_vow` — that encode RAW vow mechanics so the GM does not do arithmetic.
3. **One schema change + one-time migration** — `ProgressTrack.completed: boolean` becomes `ProgressTrack.status: "active" | "fulfilled" | "forsaken"`, with a migration script for existing campaign data.

The GM agent gets one paragraph reinforcing the milestone-discipline rule and loses its embedded display table (which moves into the skill).

---

## 1. Schema Change

### `ProgressTrack` type

**Before:**
```ts
export interface ProgressTrack {
  name: string;
  rank: "troublesome" | "dangerous" | "formidable" | "extreme" | "epic";
  kind: "vow" | "combat" | "journey" | "bond" | "other";
  ticks: number;
  completed: boolean;
}
```

**After:**
```ts
export interface ProgressTrack {
  name: string;
  rank: "troublesome" | "dangerous" | "formidable" | "extreme" | "epic";
  kind: "vow" | "combat" | "journey" | "bond" | "other";
  ticks: number;
  status: "active" | "fulfilled" | "forsaken";
}
```

The three states map directly to RAW outcomes: `active` while in play, `fulfilled` after `Fulfill Your Vow` succeeds, `forsaken` after `Forsake Your Vow`. For non-vow tracks, only `active` and `fulfilled` apply (e.g., a journey ends `fulfilled` when the destination is reached).

### Migration script

`plugins/ironsworn/scribe/scripts/migrate-track-status.ts`

- Reads `SCRIBE_CAMPAIGN/character.json`.
- For each `progressTracks[]` entry:
  - If `completed === true`, set `status: "fulfilled"`.
  - Else, set `status: "active"`.
  - Delete the `completed` field.
- Writes back atomically (temp file + rename, mirroring `saveCharacter`).
- Idempotent: if every track already has `status`, no-op and exit.
- Logs each track touched.

Run once per campaign: `bun run plugins/ironsworn/scribe/scripts/migrate-track-status.ts`.

### Loader behavior

`loadCharacter()` validates `progressTracks[].status` is one of the three enum values and throws a clear error if missing — this forces the migration, ensuring the codebase has no fallback paths for the old shape.

### Audit of existing call sites

All references to `track.completed` are updated to `track.status === "fulfilled"` (or the appropriate negation):

- `state/character.ts:354` (auto-close thread on completion) — closes thread on any non-active status.
- `tools/mutations.ts` `fulfill_progress` — sets `status: "fulfilled"`.
- `tools/mutations.ts` `tick_progress` — rejects unless `status === "active"`.
- `tools/mutations.ts` `create_progress_track` — creates with `status: "active"`.
- `tools/read.ts` — `tracks.open` filters `status === "active"`; `tracks.completed` is renamed to `tracks.fulfilled` and filters `"fulfilled"`; new `tracks.forsaken` filters `"forsaken"`.
- `state/threads.test.ts`, `state/character.test.ts`, `tools/mutations.test.ts` — literals updated.

DuckDB stores (`scenes.duckdb`, `lore.duckdb`) do not reference track status; no DuckDB migration needed.

---

## 2. New MCP Tools

All three live in `plugins/ironsworn/scribe/src/tools/mutations.ts` and use the same response shape and error-handling pattern as existing mutation tools.

### 2.1 `reach_milestone(track_name, count?)`

**Purpose:** Apply one or more RAW *Reach a Milestone* events to a vow track. The named, semantic version of "ticking once for a milestone." Vow-only by design — RAW *Reach a Milestone* is a quest move; journey waypoints, combat harm, and bond progress have their own tick semantics handled by `tick_progress`.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `track_name` | string | — | Name of the vow track (case-insensitive). |
| `count` | int positive | 1 | Number of milestone events to apply. |

**Behavior:**

- Look up track by name (case-insensitive). Error if not found.
- Reject unless `track.kind === "vow"` — error message guides the GM: "reach_milestone applies to vow tracks only. For journey waypoints, combat harm, or bonds, use tick_progress."
- Reject if `track.status !== "active"`.
- Compute `ticks_added = count × TICKS_PER_MARK[track.rank]` using the canonical table (troublesome=12, dangerous=8, formidable=4, extreme=2, epic=1).
- Internally calls the existing `tickProgress` helper — `reach_milestone` is the named alias for "1 milestone event," not new math.
- Clamps at 40 ticks; returns `clamped: true` and a warning if exceeded.
- Writes a journal entry with `kind: "reachMilestone"` (distinct from `tickProgress` so the audit log is unambiguous).

**Response:**

```json
{
  "ok": true,
  "track": { ... },
  "applied": {
    "milestones_applied": 1,
    "prior_ticks": 0,
    "ticks_added": 8,
    "clamped": false
  }
}
```

### 2.2 `forsake_vow(track_name, reason?)`

**Purpose:** Atomically execute the RAW `Forsake Your Vow` move: clear the vow, apply Endure Stress equal to rank, close the thread.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `track_name` | string | — | Name of the vow track. |
| `reason` | string | — | Optional narrative reason recorded in the thread closure note. |

**Behavior:**

- Look up track. Reject if not found, not `kind === "vow"`, or `status !== "active"`.
- Set `track.status = "forsaken"`.
- Apply stress equal to rank (troublesome=1, dangerous=2, formidable=3, extreme=4, epic=5) by invoking the existing stress logic. Propagates resulting spirit value, debility, and death flags into the response payload so the GM sees them.
- Auto-close the matching thread with `resolution: "Forsaken: <reason>"` (or `"Forsaken"` if no reason provided), using the same lookup pattern as `fulfill_progress`.
- Award 0 XP. This is a failure outcome, not a fulfillment.
- Journal entry `kind: "forsakeVow"`.

### 2.3 `recommit_vow(track_name)`

**Purpose:** Encode the RAW recommit branch of a Fulfill miss: clear all but one filled box, raise rank by one tier.

**Parameters:**

| Name | Type | Description |
|------|------|---|
| `track_name` | string | Name of the vow track. |

**Behavior:**

- Look up track. Reject if not found, not `kind === "vow"`, or `status !== "active"`.
- If any boxes are fully filled (`ticks >= 4`), set `ticks = 4` (one filled box). Else set `ticks = 0`.
- Bump rank to next tier: `troublesome → dangerous → formidable → extreme → epic`. No-op at `epic`.
- Track remains `status: "active"` — the vow continues.
- Journal entry `kind: "recommitVow"`.

### 2.4 `tick_progress` — documentation update only

No behavior change. The description tightens to clarify scope:

> Use `reach_milestone` for vow advancement (RAW Reach a Milestone). Use `tick_progress` for: journey waypoints (1 mark per Undertake hit), combat harm (rank-dependent ticks per harm point), bond progress (1 raw tick), and scene-challenge progress.

`marks` is not renamed — that would break existing callers and the journey skill.

---

## 3. New Skill: `ironsworn-progress-tracks`

**Location:** `plugins/ironsworn/skills/ironsworn-progress-tracks/SKILL.md`

**Replaces:** `ironsworn-journey` (deleted in the same PR).

### Front-matter

```yaml
name: ironsworn-progress-tracks
description: >
  Governs all Ironsworn progress-track play: vows (Swear, Reach a Milestone,
  Fulfill, Forsake, Recommit), journeys (Undertake, Make Camp, Resupply, Reach
  Your Destination), combat tracks, bonds, and scene challenges. ALWAYS invoke
  this skill whenever the player swears, advances, fulfills, or abandons a vow;
  travels across the Ironlands or makes any journey move; ticks any progress
  track; or displays a track's progress glyphs. Never handle progress mechanics
  from memory alone.
```

### Section outline

1. **When to invoke** — explicit trigger list (every quest move, every journey move, every combat that creates a track, every bond fulfillment, every scene challenge, any tick request).
2. **Progress Track Fundamentals** — what a track is (10 boxes × 4 ticks = 40); rank → ticks-per-mark table; progress score = filled boxes only.
3. **Vows**
   1. Swear an Iron Vow (`resolve_move` + `create_progress_track` + auto-thread)
   2. Reach a Milestone — what counts (rules-grounded checklist), `reach_milestone` tool, GM discipline ("after every hit on a move that overcame an obstacle related to a vow")
   3. Fulfill Your Vow — `roll_progress` then `fulfill_progress`; outcome tables
   4. Miss on Fulfill — `AskUserQuestion` for recommit vs forsake; never auto-decide
   5. Forsake Your Vow — `forsake_vow` tool; stress consequences
4. **Journeys** — absorbs current `ironsworn-journey` content; cross-link section explicitly notes that arrival can be a milestone for a related vow, requiring a separate `reach_milestone` call.
5. **Combat tracks** — created on Enter the Fray; ticked by harm via `tick_progress` (rank-dependent ticks per harm point); `End the Fight` is a `roll_progress`.
6. **Bonds** — rank-less; `tick_progress` with `marks=1` adds 1 raw tick when a bond move says to mark progress.
7. **Scene challenges** — 10-box progress + 4-box countdown; rank applies normally; countdown ticks one full box at a time.
8. **Display Format** — moved from `ironsworn-gm.md`. Glyph mapping (○ ◔ ◑ ◕ ●), formula, examples.
9. **Common Mistakes** — keeps existing journey list; adds:
   - Never use `tick_progress` for a vow milestone — use `reach_milestone`.
   - Fulfill Your Vow is a progress roll, not an action roll.
   - Miss on Fulfill: ASK the player recommit vs forsake; do not auto-forsake.
   - Forsake applies stress; do not skip it.

### GM agent edits (`plugins/ironsworn/agents/ironsworn-gm.md`)

- Replace existing "Journeys" section (lines 326–334) with a "Progress Tracks" section that points to `ironsworn-progress-tracks` for *any* progress mechanic.
- Add discipline rule under "Useful Reminders": *"After every hit on a move that overcame a critical obstacle, ask: did this advance any open vow? If yes, invoke `ironsworn-progress-tracks` and call `reach_milestone` for that vow before continuing."*
- Remove the embedded "Progress Track Display" section (lines 336–365). The skill is the single source of truth.

---

## 4. Testing

### Unit tests (`tools/mutations.test.ts`)

`reach_milestone`:
- Applies correct ticks for `count=1` across all five ranks (12/8/4/2/1).
- Applies `count=2` correctly.
- Rejects on non-vow tracks (journey, combat, bond, other) with guidance message.
- Rejects on non-active tracks (`fulfilled`/`forsaken`).
- Clamps at 40 with warning.
- Journal entry has `kind: "reachMilestone"`.

`forsake_vow`:
- Sets `status: "forsaken"`.
- Applies stress equal to rank (5 cases).
- Closes matching thread with `"Forsaken: <reason>"`.
- Awards 0 XP.
- Rejects non-vow tracks.
- Rejects already-completed/forsaken tracks.
- Propagates stress side effects (debility, death) into response.

`recommit_vow`:
- Clears to 4 ticks if any boxes were filled.
- Clears to 0 if no boxes were filled.
- Raises rank by one tier; no-op at epic.
- Track remains `status: "active"`.
- Rejects non-vow / non-active tracks.

Existing `tick_progress` tests continue to pass with the doc update.

### Schema migration test

`scripts/migrate-track-status.test.ts`:
- Pre-migration `character.json` with `completed: true` → post-migration `status: "fulfilled"`, no `completed` field.
- Pre-migration `completed: false` → `status: "active"`.
- Idempotency: running twice is a no-op.

### Manual smoke test (documented in spec, not automated)

1. Start fresh campaign, swear a dangerous vow.
2. Call `reach_milestone` once → verify `ticks === 8`, glyphs `●●○○○○○○○○`.
3. Call `reach_milestone` again → verify `ticks === 16`, glyphs `●●●●○○○○○○`.
4. Force a Fulfill miss; verify the GM agent (with the new skill loaded) presents recommit/forsake as an `AskUserQuestion` and does not auto-decide.
5. Choose forsake → verify spirit drops by rank and thread closes with "Forsaken" resolution.

---

## 5. Plugin versioning

Per `CLAUDE.md`, every PR bumps `plugins/ironsworn/.claude-plugin/plugin.json`. This is a feature change (new skill, new tools, schema migration) — bump **minor**.

---

## 6. Out of scope

- **Tool-side `open_vows` nudge in `resolve_move`/`roll_progress` responses.** Considered, deferred. Skill discipline + agent prompt is the chosen mechanism. If field testing shows GMs still miss milestones, revisit.
- **Player-facing AskUserQuestion on every potential milestone.** Considered, deferred. Adds friction for what should be a GM judgment call. The skill teaches the GM to *ask* the player when ambiguous, not to require confirmation on every hit.
- **Renaming `tick_progress`'s `marks` parameter.** Would break existing callers; the documentation tightening is sufficient now that vow advancement uses `reach_milestone`.
- **`combat`-track auto-creation discipline** (Enter the Fray flow). The skill documents the existing behavior; refactoring combat is its own initiative.

---

## 7. Acceptance criteria

- A new vow earns the correct number of boxes per milestone for every rank, with one tool call per milestone event.
- Forsaking a vow applies the correct stress, closes the thread, and is visible in the audit log as a distinct event.
- A Fulfill miss prompts the player for recommit-vs-forsake; recommit clears to one filled box and raises rank.
- The unified skill is the only place a GM (or future maintainer) needs to look for any progress-track rule, including display.
- Existing campaign data loads without error after the migration script runs.
- Plugin version bumped; all tests pass; no calls to deleted/renamed APIs remain.
