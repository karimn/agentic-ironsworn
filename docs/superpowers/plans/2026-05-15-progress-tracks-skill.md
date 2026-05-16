# Progress Tracks Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ProgressTrack.completed: boolean` with a 3-state `status` enum, add three new MCP tools (`reach_milestone`, `forsake_vow`, `recommit_vow`), unify journey/vow/combat/bond/scene-challenge guidance into a single `ironsworn-progress-tracks` skill, and migrate existing campaign data once.

**Architecture:** Schema-first migration: change the type, write a one-time campaign-data migration script, audit and update every call site to use `status`, then add the three new vow-mechanic tools that build on the existing `tickProgress` / `sufferStress` / `closeThread` primitives. Replace `ironsworn-journey` skill with the broader `ironsworn-progress-tracks` skill and prune the GM agent's now-redundant display section.

**Tech Stack:** Bun runtime, TypeScript, Zod for tool schemas, MCP SDK (`@modelcontextprotocol/sdk`), DuckDB (untouched here), bun:test.

**Spec:** `docs/superpowers/specs/2026-05-15-progress-tracks-skill-design.md`

---

## File Structure

**New files:**
- `plugins/ironsworn/scribe/scripts/migrate-track-status.ts` — one-time data migration
- `plugins/ironsworn/scribe/scripts/migrate-track-status.test.ts` — migration tests
- `plugins/ironsworn/skills/ironsworn-progress-tracks/SKILL.md` — unified skill

**Modified files:**
- `plugins/ironsworn/scribe/src/state/character.ts` — `ProgressTrack` interface, `closeTrack` helper
- `plugins/ironsworn/scribe/src/tools/mutations.ts` — new tools, `tick_progress` doc tightening, schema usage
- `plugins/ironsworn/scribe/src/tools/read.ts` — filter logic, briefing field rename
- `plugins/ironsworn/scribe/src/tools/narrative.ts` — implicit vow track creation
- `plugins/ironsworn/scribe/src/state/threads.test.ts` — fixture updates
- `plugins/ironsworn/scribe/src/state/character.test.ts` — fixture updates (if any)
- `plugins/ironsworn/scribe/src/tools/mutations.test.ts` — fixture updates + new test suites
- `plugins/ironsworn/scribe/src/tools/read.test.ts` — fixture updates + briefing rename
- `plugins/ironsworn/scribe/src/rules/ironsworn/progress.test.ts` — fixture update
- `plugins/ironsworn/agents/ironsworn-gm.md` — replace Journeys section, drop Display section, add discipline rule
- `plugins/ironsworn/.claude-plugin/plugin.json` — version bump

**Deleted files:**
- `plugins/ironsworn/skills/ironsworn-journey/SKILL.md` (and the empty dir)

---

## Task 1: Add `status` field to ProgressTrack type

**Files:**
- Modify: `plugins/ironsworn/scribe/src/state/character.ts:19-25`

This is the foundational schema change. The new field is required (not optional) — the migration script in Task 3 brings existing data forward; the loader in Task 4 enforces it. We do this first so subsequent tasks can rely on the new shape.

- [ ] **Step 1: Update the interface**

In `plugins/ironsworn/scribe/src/state/character.ts`, replace the `ProgressTrack` interface (around line 19) with:

```ts
export interface ProgressTrack {
  name: string;
  rank: "troublesome" | "dangerous" | "formidable" | "extreme" | "epic";
  kind: "vow" | "combat" | "journey" | "bond" | "other";
  ticks: number; // 0..40
  status: "active" | "fulfilled" | "forsaken";
}
```

- [ ] **Step 2: Run typecheck — expect many failures**

Run from `plugins/ironsworn/scribe/`:
```bash
bun run tsc --noEmit
```
Expected: many errors referencing `.completed` on `ProgressTrack`. This confirms the type change is propagating. Don't fix them yet — Tasks 5–10 do that in coordinated edits.

- [ ] **Step 3: Commit the type change**

```bash
git add plugins/ironsworn/scribe/src/state/character.ts
git commit -m "refactor(state): replace ProgressTrack.completed with status enum"
```

---

## Task 2: Update `closeTrack` helper to use `status`

**Files:**
- Modify: `plugins/ironsworn/scribe/src/state/character.ts:349-362`

`closeTrack` is the lowest-level mutation that sets a track to a terminal state. Updating it first means any tool calling it gets the right behavior automatically.

- [ ] **Step 1: Update the helper**

Replace the `closeTrack` function body (around lines 349–362) with:

```ts
export async function closeTrack(
  campaignPath: string,
  trackName: string,
): Promise<MutationResult> {
  return mutate(campaignPath, "closeTrack", (char) => {
    const track = char.progressTracks.find(
      (t) => t.name.toLowerCase() === trackName.toLowerCase(),
    );
    if (!track) {
      throw new Error(`Progress track not found: "${trackName}"`);
    }
    track.status = "fulfilled";
  });
}
```

(The existing `close_track` MCP tool is for narrative wrap-up of unresolved tracks, e.g., a battle that ended fictionally. RAW-wise these are "the matter is settled," so `fulfilled` is the right terminal state — `forsaken` is reserved for the explicit `forsake_vow` move.)

- [ ] **Step 2: No commit yet** — this depends on Task 3+ to compile cleanly. We will commit Tasks 2–10 together at the end of Task 10.

---

## Task 3: Write the migration script (test first)

**Files:**
- Create: `plugins/ironsworn/scribe/scripts/migrate-track-status.test.ts`
- Create: `plugins/ironsworn/scribe/scripts/migrate-track-status.ts`

The migration runs once per campaign to convert `completed: boolean` → `status: enum`. We write the test first because the migration must be idempotent and must handle three input shapes (legacy with `completed`, new with `status`, mixed).

- [ ] **Step 1: Write the failing test**

Create `plugins/ironsworn/scribe/scripts/migrate-track-status.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateTrackStatus } from "./migrate-track-status";

describe("migrate-track-status", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migrate-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCharacter(tracks: unknown[]): string {
    const path = join(dir, "character.json");
    const character = {
      name: "Test",
      stats: { edge: 1, heart: 1, iron: 1, shadow: 1, wits: 1 },
      momentum: 2,
      momentumReset: 2,
      health: 5,
      spirit: 5,
      supply: 5,
      debilities: {},
      assets: [],
      progressTracks: tracks,
      companions: [],
      bonds: 0,
      experience: 0,
      customState: {},
    };
    writeFileSync(path, JSON.stringify(character, null, 2));
    return path;
  }

  function readCharacter(path: string): { progressTracks: Record<string, unknown>[] } {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  it("converts completed:true to status:fulfilled", async () => {
    const path = writeCharacter([
      { name: "Old Vow", rank: "epic", kind: "vow", ticks: 30, completed: true },
    ]);
    const result = await migrateTrackStatus(dir);
    expect(result.touched).toBe(1);
    const after = readCharacter(path);
    expect(after.progressTracks[0]).toEqual({
      name: "Old Vow", rank: "epic", kind: "vow", ticks: 30, status: "fulfilled",
    });
    expect(after.progressTracks[0]!.completed).toBeUndefined();
  });

  it("converts completed:false to status:active", async () => {
    const path = writeCharacter([
      { name: "Active Vow", rank: "dangerous", kind: "vow", ticks: 16, completed: false },
    ]);
    await migrateTrackStatus(dir);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
    expect(after.progressTracks[0]!.completed).toBeUndefined();
  });

  it("is idempotent — running twice is a no-op", async () => {
    const path = writeCharacter([
      { name: "Already Migrated", rank: "epic", kind: "vow", ticks: 0, status: "active" },
    ]);
    const r1 = await migrateTrackStatus(dir);
    expect(r1.touched).toBe(0);
    const r2 = await migrateTrackStatus(dir);
    expect(r2.touched).toBe(0);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
  });

  it("handles mixed shapes (some migrated, some legacy)", async () => {
    const path = writeCharacter([
      { name: "Already Migrated", rank: "epic", kind: "vow", ticks: 0, status: "active" },
      { name: "Legacy", rank: "dangerous", kind: "vow", ticks: 8, completed: false },
    ]);
    const result = await migrateTrackStatus(dir);
    expect(result.touched).toBe(1);
    const after = readCharacter(path);
    expect(after.progressTracks[0]!.status).toBe("active");
    expect(after.progressTracks[1]!.status).toBe("active");
    expect(after.progressTracks[1]!.completed).toBeUndefined();
  });

  it("throws if character.json is missing", async () => {
    expect(migrateTrackStatus(dir)).rejects.toThrow(/character\.json/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd plugins/ironsworn/scribe
bun test src/../scripts/migrate-track-status.test.ts
```
Expected: FAIL with "Cannot find module './migrate-track-status'".

- [ ] **Step 3: Implement the migration**

Create `plugins/ironsworn/scribe/scripts/migrate-track-status.ts`:

```ts
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

interface MigrationResult {
  touched: number;
}

export async function migrateTrackStatus(campaignPath: string): Promise<MigrationResult> {
  const charPath = join(campaignPath, "character.json");
  if (!existsSync(charPath)) {
    throw new Error(`character.json not found at ${charPath}`);
  }
  const raw = readFileSync(charPath, "utf8");
  const character: { progressTracks: Record<string, unknown>[] } = JSON.parse(raw);

  let touched = 0;
  for (const track of character.progressTracks) {
    if ("status" in track && track.status !== undefined) {
      // already migrated
      continue;
    }
    track.status = track.completed === true ? "fulfilled" : "active";
    delete track.completed;
    touched++;
  }

  if (touched === 0) {
    return { touched };
  }

  // Atomic write: temp file + rename
  const tempPath = `${charPath}.migrate.tmp`;
  writeFileSync(tempPath, JSON.stringify(character, null, 2));
  renameSync(tempPath, charPath);
  console.log(`[migrate-track-status] migrated ${touched} track(s) in ${charPath}`);
  return { touched };
}

// CLI entry
if (import.meta.main) {
  const campaign = process.env.SCRIBE_CAMPAIGN;
  if (!campaign) {
    console.error("Set SCRIBE_CAMPAIGN to the campaign directory");
    process.exit(1);
  }
  await migrateTrackStatus(campaign);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd plugins/ironsworn/scribe
bun test scripts/migrate-track-status.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: No commit yet** — bundled with Tasks 1, 2, 4–10 at end of Task 10.

---

## Task 4: Make `loadCharacter` validate `status`

**Files:**
- Modify: `plugins/ironsworn/scribe/src/state/character.ts` — find `loadCharacter` function

This forces any unmigrated campaign to fail loudly with a clear error pointing to the migration script.

- [ ] **Step 1: Read the current loader**

```bash
grep -n "loadCharacter\|JSON.parse" plugins/ironsworn/scribe/src/state/character.ts | head
```

Identify the function that parses `character.json`. It will be returning a `Character` object.

- [ ] **Step 2: Add validation**

Inside `loadCharacter` (or wherever the JSON is parsed into a `Character`), after `progressTracks` is read, add:

```ts
const validStatuses = new Set(["active", "fulfilled", "forsaken"]);
for (const track of character.progressTracks) {
  if (!validStatuses.has((track as { status?: string }).status ?? "")) {
    throw new Error(
      `Progress track "${track.name}" is missing or has invalid 'status' field. ` +
      `Run: bun run scripts/migrate-track-status.ts (with SCRIBE_CAMPAIGN set)`,
    );
  }
}
```

- [ ] **Step 3: No test yet** — covered by the existing test suite once fixtures are updated in Task 5+.

---

## Task 5: Update fixtures and read.ts (briefing tracks)

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/read.ts:351-359`
- Modify: `plugins/ironsworn/scribe/src/tools/read.test.ts:34-156`

`session_briefing` exposes `tracks.open` / `tracks.completed`. We rename `completed` → `fulfilled` and add `forsaken` to the briefing payload.

- [ ] **Step 1: Update `read.ts`**

In `plugins/ironsworn/scribe/src/tools/read.ts`, find the briefing tracks block (around line 351) and replace:

```ts
tracks: {
  open: character.progressTracks.filter(
    (t) => t.status === "active" && t.ticks < 40,
  ),
  ready: character.progressTracks.filter(
    (t) =>
      t.status === "active" &&
      t.ticks >= 40,
  ),
  fulfilled: character.progressTracks.filter((t) => t.status === "fulfilled"),
  forsaken: character.progressTracks.filter((t) => t.status === "forsaken"),
},
```

(Preserve the surrounding logic. If the existing block has different bucket names like `completed`, the rename happens here.)

- [ ] **Step 2: Update test fixtures**

In `plugins/ironsworn/scribe/src/tools/read.test.ts`, replace every fixture literal `completed: false` with `status: "active"` and `completed: true` with `status: "fulfilled"`. Update assertions: `briefing.tracks.completed` becomes `briefing.tracks.fulfilled`. Update the test that checks `t.completed).toBe(false)` to assert `t.status).toBe("active")`.

Specifically:

- Line 34: `{ ..., completed: false }` → `{ ..., status: "active" }`
- Line 35: same pattern
- Line 36: same
- Line 37: same
- Line 38: `completed: true` → `status: "fulfilled"`
- Line 96: `briefing.tracks.completed` → `briefing.tracks.fulfilled`
- Line 126: `briefing.tracks.completed.map` → `briefing.tracks.fulfilled.map`
- Line 142: `expect(t.completed).toBe(false)` → `expect(t.status).toBe("active")`
- Line 156: `briefing.tracks.completed` → `briefing.tracks.fulfilled`

- [ ] **Step 3: Run read tests**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/read.test.ts
```
Expected: PASS.

---

## Task 6: Update `fulfill_progress` and `create_progress_track` and `tick_progress`

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.ts`

Three small edits within existing tools to use the new field.

- [ ] **Step 1: Update `create_progress_track`**

Find line 350 in `mutations.ts` (the `newTrack` literal):

```ts
const newTrack = { name, rank, kind, ticks: 0, completed: false };
```

Replace with:

```ts
const newTrack: ProgressTrack = { name, rank, kind, ticks: 0, status: "active" };
```

Add `import type { ProgressTrack } from "../state/character.js";` to the imports at the top of the file if not already present.

- [ ] **Step 2: Update `fulfill_progress`**

Find line 411 (`track.completed = true;`) and replace with:

```ts
track.status = "fulfilled";
```

- [ ] **Step 3: Add status guard to `tick_progress`**

In `tick_progress` (starts at line 259), after the track lookup and before the tick math (around line 295), add:

```ts
if (track.status !== "active") {
  return {
    content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
    isError: true,
  };
}
```

- [ ] **Step 4: Update `tick_progress` description block**

Replace the description string array (lines 259–276) with the new wording from the spec:

```ts
[
  "Tick a named progress track by the given number of marks.",
  "",
  "Use `reach_milestone` for vow advancement (RAW Reach a Milestone).",
  "Use `tick_progress` for: journey waypoints (1 mark per Undertake hit),",
  "combat harm (rank-dependent ticks per harm point), bond progress (1 raw tick),",
  "and scene-challenge progress.",
  "",
  "IMPORTANT — unit clarification:",
  "  `marks` is the number of *progress marks* (boxes), NOT raw ticks.",
  "  Each mark equals a rank-dependent number of ticks:",
  "    troublesome=12, dangerous=8, formidable=4, extreme=2, epic=1.",
  "  Example: marks=2 on a dangerous track adds 2*8=16 ticks.",
  "",
  "The response always includes an `applied` object with:",
  "  - prior_ticks: ticks before this call",
  "  - requested_marks: the marks value that was passed (or 1 if default)",
  "  - ticks_added: actual ticks added after clamping",
  "  - clamped: true if the result was clamped at the 40-tick maximum",
  "",
  "When clamping occurs, a `warnings` array is also returned.",
].join("\n"),
```

- [ ] **Step 5: Update mutations test fixtures**

In `plugins/ironsworn/scribe/src/tools/mutations.test.ts`:

- Lines 25–28: replace `completed: false` with `status: "active"` and `completed: true` (combat ended) with `status: "fulfilled"`. Wait — line 28 is `completed: false` for "Combat Ended" (a 40/40 track that hasn't been formally closed). Keep it `status: "active"` since the fixture intent is "ready to be closed." Verify by re-reading the test that uses it.
- Lines 291, 306, 318, 341: `expect(parsed.track.completed).toBe(true)` → `expect(parsed.track.status).toBe("fulfilled")`.

---

## Task 7: Update `narrative.ts` and `state/character.ts:360`

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/narrative.ts:232,269`
- (Already covered: `state/character.ts:360` was updated in Task 2)

`open_thread` for vows can implicitly create a progress track; `close_thread` for vows marks the matching track completed.

- [ ] **Step 1: Update implicit track creation**

In `plugins/ironsworn/scribe/src/tools/narrative.ts:232`, replace:

```ts
track = { name: title, rank: rank as ProgressTrack["rank"], kind: "vow", ticks: 0, completed: false };
```

With:

```ts
track = { name: title, rank: rank as ProgressTrack["rank"], kind: "vow", ticks: 0, status: "active" };
```

- [ ] **Step 2: Update close_thread → mark track completed**

In `plugins/ironsworn/scribe/src/tools/narrative.ts:269`, replace:

```ts
character.progressTracks[idx]!.completed = true;
```

With:

```ts
character.progressTracks[idx]!.status = "fulfilled";
```

---

## Task 8: Update remaining fixture files

**Files:**
- Modify: `plugins/ironsworn/scribe/src/state/threads.test.ts:97,106,129,143,153,159,167`
- Modify: `plugins/ironsworn/scribe/src/rules/ironsworn/progress.test.ts:10`

Pure mechanical fixture updates.

- [ ] **Step 1: Update threads.test.ts**

For each line referencing `completed`:

- Line 97: `completed: false` → `status: "active"`
- Line 106: `expect(loaded.progressTracks[0]!.completed).toBe(false)` → `expect(loaded.progressTracks[0]!.status).toBe("active")`
- Line 129: `completed: false` → `status: "active"`
- Line 143: `updatedChar.progressTracks[idx]!.completed = true` → `updatedChar.progressTracks[idx]!.status = "fulfilled"`
- Line 153: `expect(track!.completed).toBe(true)` → `expect(track!.status).toBe("fulfilled")`
- Line 159: `completed: false` → `status: "active"`
- Line 167: `expect(finalChar.progressTracks[0]!.completed).toBe(false)` → `expect(finalChar.progressTracks[0]!.status).toBe("active")`

- [ ] **Step 2: Update progress.test.ts**

Line 10 fixture: `completed: false` → `status: "active"`.

- [ ] **Step 3: Check character.test.ts**

```bash
grep -n "completed" plugins/ironsworn/scribe/src/state/character.test.ts
```

If any matches found, apply the same pattern. If clean, no edit needed.

- [ ] **Step 4: Run full test suite**

```bash
cd plugins/ironsworn/scribe
bun test
bun run tsc --noEmit
```
Expected: all tests pass; typecheck clean.

---

## Task 9: Run migration on the active campaign

**Files:** none (data only)

Before committing the schema migration, run it once against the user's actual campaign(s) so the next session loads cleanly.

- [ ] **Step 1: Identify the campaign path**

Check `.mcp.json` for `SCRIBE_CAMPAIGN`:

```bash
grep -n "SCRIBE_CAMPAIGN" plugins/ironsworn/.mcp.json
```

The path in the env var is the campaign directory.

- [ ] **Step 2: Back up the character file**

```bash
cp <campaign-dir>/character.json <campaign-dir>/character.json.bak
```

- [ ] **Step 3: Run the migration**

```bash
cd plugins/ironsworn/scribe
SCRIBE_CAMPAIGN=<campaign-dir> bun run scripts/migrate-track-status.ts
```

Expected stdout: `[migrate-track-status] migrated N track(s) in <path>`.

- [ ] **Step 4: Spot-check the result**

```bash
jq '.progressTracks[] | {name, status}' <campaign-dir>/character.json
```

Every track should have a `status` field; no `completed` fields remain.

- [ ] **Step 5: Commit Tasks 1–9 together**

```bash
git add plugins/ironsworn/scribe/src/state/character.ts \
        plugins/ironsworn/scribe/src/tools/mutations.ts \
        plugins/ironsworn/scribe/src/tools/read.ts \
        plugins/ironsworn/scribe/src/tools/narrative.ts \
        plugins/ironsworn/scribe/src/tools/mutations.test.ts \
        plugins/ironsworn/scribe/src/tools/read.test.ts \
        plugins/ironsworn/scribe/src/state/threads.test.ts \
        plugins/ironsworn/scribe/src/rules/ironsworn/progress.test.ts \
        plugins/ironsworn/scribe/scripts/migrate-track-status.ts \
        plugins/ironsworn/scribe/scripts/migrate-track-status.test.ts
git commit -m "$(cat <<'EOF'
refactor(scribe): replace ProgressTrack.completed with status enum

ProgressTrack.completed: boolean → status: "active" | "fulfilled" | "forsaken"

Drives upcoming forsake_vow tool (#60) by giving the schema room for the
forsaken state without overloading completed. Includes one-time migration
script for existing campaign data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add `reach_milestone` tool (test first)

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.ts`
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.test.ts`

The first new tool. Vow-only, semantic alias for "1 milestone event."

- [ ] **Step 1: Write failing tests**

Append to `plugins/ironsworn/scribe/src/tools/mutations.test.ts` (inside the existing `describe` for the tool registration, or add a new `describe`):

```ts
describe("reach_milestone", () => {
  it("applies rank-correct ticks for count=1 — troublesome (12 ticks)", async () => {
    const { campaignPath, server } = await setup({ progressTracks: [
      { name: "T-Vow", rank: "troublesome", kind: "vow", ticks: 0, status: "active" },
    ]});
    const result = await callTool(server, "reach_milestone", { track_name: "T-Vow" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.ticks).toBe(12);
    expect(parsed.applied.milestones_applied).toBe(1);
    expect(parsed.applied.ticks_added).toBe(12);
    expect(parsed.applied.clamped).toBe(false);
  });

  it("applies rank-correct ticks — dangerous (8), formidable (4), extreme (2), epic (1)", async () => {
    for (const [rank, ticks] of [["dangerous", 8], ["formidable", 4], ["extreme", 2], ["epic", 1]] as const) {
      const { server } = await setup({ progressTracks: [
        { name: `${rank}-Vow`, rank, kind: "vow", ticks: 0, status: "active" },
      ]});
      const result = await callTool(server, "reach_milestone", { track_name: `${rank}-Vow` });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.track.ticks).toBe(ticks);
    }
  });

  it("applies count=2 correctly (dangerous = 16 ticks)", async () => {
    const { server } = await setup({ progressTracks: [
      { name: "D-Vow", rank: "dangerous", kind: "vow", ticks: 0, status: "active" },
    ]});
    const result = await callTool(server, "reach_milestone", { track_name: "D-Vow", count: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.track.ticks).toBe(16);
    expect(parsed.applied.milestones_applied).toBe(2);
  });

  it("rejects non-vow tracks", async () => {
    const { server } = await setup({ progressTracks: [
      { name: "Journey", rank: "dangerous", kind: "journey", ticks: 0, status: "active" },
    ]});
    const result = await callTool(server, "reach_milestone", { track_name: "Journey" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/vow tracks only/);
  });

  it("rejects non-active tracks", async () => {
    const { server } = await setup({ progressTracks: [
      { name: "Done", rank: "dangerous", kind: "vow", ticks: 16, status: "fulfilled" },
    ]});
    const result = await callTool(server, "reach_milestone", { track_name: "Done" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not active/);
  });

  it("clamps at 40 with warning", async () => {
    const { server } = await setup({ progressTracks: [
      { name: "Almost", rank: "troublesome", kind: "vow", ticks: 36, status: "active" },
    ]});
    const result = await callTool(server, "reach_milestone", { track_name: "Almost" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.track.ticks).toBe(40);
    expect(parsed.applied.clamped).toBe(true);
    expect(parsed.warnings).toBeDefined();
  });

  it("rejects unknown track", async () => {
    const { server } = await setup({ progressTracks: [] });
    const result = await callTool(server, "reach_milestone", { track_name: "Nope" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/);
  });
});
```

(Adjust `setup` and `callTool` helper names to match the existing test patterns in this file. If the file uses a different harness, follow it exactly.)

- [ ] **Step 2: Run test — expect failure**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "reach_milestone"
```
Expected: FAIL with "Tool not found: reach_milestone" or similar.

- [ ] **Step 3: Implement the tool**

In `plugins/ironsworn/scribe/src/tools/mutations.ts`, add a new `server.tool(...)` block immediately after the existing `tick_progress` registration (after line 333):

```ts
server.tool(
  "reach_milestone",
  [
    "Apply RAW Reach a Milestone events to a vow track. Vow-only.",
    "",
    "RAW: when the player overcomes a critical obstacle directly tied to a vow,",
    "call this with the vow's track_name. The tool reads the track's rank and",
    "applies the canonical milestone amount (troublesome=3 boxes, dangerous=2,",
    "formidable=1, extreme=2 ticks, epic=1 tick). One call = one milestone event.",
    "",
    "For non-vow tracks (journey waypoints, combat harm, bonds, scene challenges)",
    "use tick_progress instead — those have their own tick semantics.",
  ].join("\n"),
  {
    track_name: z.string().describe("Name of the vow track (case-insensitive)"),
    count: z.coerce.number().int().positive().optional().describe(
      "Number of milestone events to apply (default 1).",
    ),
  },
  async ({ track_name, count }) => {
    try {
      const character = await loadCharacter(campaignPath);
      const idx = character.progressTracks.findIndex(
        (t) => t.name.toLowerCase() === track_name.toLowerCase(),
      );
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
          isError: true,
        };
      }
      const track = character.progressTracks[idx]!;
      if (track.kind !== "vow") {
        return {
          content: [{ type: "text", text: `Error: reach_milestone applies to vow tracks only. Track "${track.name}" is kind="${track.kind}". For journey waypoints, combat harm, or bonds, use tick_progress.` }],
          isError: true,
        };
      }
      if (track.status !== "active") {
        return {
          content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
          isError: true,
        };
      }
      const milestonesApplied = count ?? 1;
      const priorTicks = track.ticks;
      const ticksRequested = milestonesApplied * TICKS_PER_MARK[track.rank];
      const before = structuredClone(character);
      const updatedTrack = tickProgress(track, milestonesApplied);
      const ticksAdded = updatedTrack.ticks - priorTicks;
      const clamped = ticksAdded < ticksRequested;
      character.progressTracks[idx] = updatedTrack;
      await saveCharacter(campaignPath, character);
      await appendJournal(campaignPath, {
        timestamp: new Date().toISOString(),
        kind: "reachMilestone",
        before,
        after: character,
      });
      recordMutation(campaignPath);
      const applied = {
        milestones_applied: milestonesApplied,
        ticks_added: ticksAdded,
        prior_ticks: priorTicks,
        clamped,
      };
      const warnings: string[] = clamped
        ? [`Requested ${milestonesApplied} milestone(s) (${ticksRequested} ticks) would exceed max; clamped at 40`]
        : [];
      const payload: Record<string, unknown> = { ok: true, track: updatedTrack, applied };
      if (warnings.length > 0) payload.warnings = warnings;
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "reach_milestone"
```
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/mutations.ts plugins/ironsworn/scribe/src/tools/mutations.test.ts
git commit -m "feat(scribe): add reach_milestone MCP tool (#60)"
```

---

## Task 11: Add `forsake_vow` tool (test first)

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.ts`
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `mutations.test.ts`:

```ts
describe("forsake_vow", () => {
  it("sets status to forsaken", async () => {
    const { server } = await setup({
      spirit: 5,
      progressTracks: [
        { name: "Doomed", rank: "dangerous", kind: "vow", ticks: 8, status: "active" },
      ],
    });
    const result = await callTool(server, "forsake_vow", { track_name: "Doomed", reason: "Too costly" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.track.status).toBe("forsaken");
  });

  it("applies stress equal to rank — troublesome=1, dangerous=2, formidable=3, extreme=4, epic=5", async () => {
    for (const [rank, stress] of [
      ["troublesome", 1], ["dangerous", 2], ["formidable", 3], ["extreme", 4], ["epic", 5],
    ] as const) {
      const { server } = await setup({
        spirit: 5,
        progressTracks: [
          { name: `${rank}-V`, rank, kind: "vow", ticks: 0, status: "active" },
        ],
      });
      const result = await callTool(server, "forsake_vow", { track_name: `${rank}-V` });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.spirit).toBe(5 - stress);
    }
  });

  it("closes matching thread with Forsaken: <reason>", async () => {
    const { server, campaignPath } = await setup({
      progressTracks: [
        { name: "Vengeance", rank: "dangerous", kind: "vow", ticks: 0, status: "active" },
      ],
      threads: [{ title: "Vengeance", kind: "vow", status: "open" }],
    });
    await callTool(server, "forsake_vow", { track_name: "Vengeance", reason: "I cannot" });
    const threads = await loadThreads(campaignPath);
    const thread = threads.find((t) => t.title === "Vengeance");
    expect(thread!.status).toBe("closed");
    expect(thread!.notes).toMatch(/Forsaken: I cannot/);
  });

  it("uses 'Forsaken' if no reason given", async () => {
    const { server, campaignPath } = await setup({
      progressTracks: [
        { name: "Quiet", rank: "troublesome", kind: "vow", ticks: 0, status: "active" },
      ],
      threads: [{ title: "Quiet", kind: "vow", status: "open" }],
    });
    await callTool(server, "forsake_vow", { track_name: "Quiet" });
    const threads = await loadThreads(campaignPath);
    const thread = threads.find((t) => t.title === "Quiet");
    expect(thread!.notes).toMatch(/Forsaken/);
    expect(thread!.notes).not.toMatch(/Forsaken:/);
  });

  it("awards 0 XP", async () => {
    const { server, campaignPath } = await setup({
      experience: 5,
      progressTracks: [
        { name: "Noble", rank: "epic", kind: "vow", ticks: 30, status: "active" },
      ],
    });
    await callTool(server, "forsake_vow", { track_name: "Noble" });
    const char = await loadCharacter(campaignPath);
    expect(char.experience).toBe(5);
  });

  it("rejects non-vow tracks", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "Trip", rank: "dangerous", kind: "journey", ticks: 0, status: "active" },
      ],
    });
    const result = await callTool(server, "forsake_vow", { track_name: "Trip" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/vow/);
  });

  it("rejects non-active vows", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "Old", rank: "dangerous", kind: "vow", ticks: 16, status: "fulfilled" },
      ],
    });
    const result = await callTool(server, "forsake_vow", { track_name: "Old" });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "forsake_vow"
```

- [ ] **Step 3: Implement the tool**

In `mutations.ts`, after the `reach_milestone` block, add:

```ts
const STRESS_BY_RANK: Record<ProgressTrack["rank"], number> = {
  troublesome: 1,
  dangerous: 2,
  formidable: 3,
  extreme: 4,
  epic: 5,
};

server.tool(
  "forsake_vow",
  [
    "Forsake an active vow per the RAW Forsake Your Vow move.",
    "",
    "Atomically: sets status='forsaken', applies Endure Stress equal to rank",
    "(troublesome=1, dangerous=2, formidable=3, extreme=4, epic=5),",
    "and auto-closes the matching thread with resolution 'Forsaken[: <reason>]'.",
    "Awards 0 XP — this is failure, not fulfillment.",
  ].join("\n"),
  {
    track_name: z.string().describe("Name of the vow track to forsake (case-insensitive)"),
    reason: z.string().optional().describe("Optional narrative reason recorded in the thread closure note"),
  },
  async ({ track_name, reason }) => {
    try {
      const character = await loadCharacter(campaignPath);
      const idx = character.progressTracks.findIndex(
        (t) => t.name.toLowerCase() === track_name.toLowerCase(),
      );
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
          isError: true,
        };
      }
      const track = character.progressTracks[idx]!;
      if (track.kind !== "vow") {
        return {
          content: [{ type: "text", text: `Error: forsake_vow applies to vow tracks only. Track "${track.name}" is kind="${track.kind}".` }],
          isError: true,
        };
      }
      if (track.status !== "active") {
        return {
          content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
          isError: true,
        };
      }
      const before = structuredClone(character);
      track.status = "forsaken";
      await saveCharacter(campaignPath, character);

      const stressAmount = STRESS_BY_RANK[track.rank];
      await sufferStress(campaignPath, stressAmount);

      let threadClosed = false;
      const threads = await loadThreads(campaignPath);
      const openMatch = threads.find(
        (t) => t.title.toLowerCase() === track_name.toLowerCase() && t.status === "open",
      );
      const resolutionNote = reason ? `Forsaken: ${reason}` : "Forsaken";
      if (openMatch) {
        await closeThread(campaignPath, openMatch.title, resolutionNote);
        threadClosed = true;
      }

      await appendJournal(campaignPath, {
        timestamp: new Date().toISOString(),
        kind: "forsakeVow",
        before,
        after: await loadCharacter(campaignPath),
      });
      recordMutation(campaignPath);

      const finalChar = await loadCharacter(campaignPath);
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          track: finalChar.progressTracks[idx],
          stressApplied: stressAmount,
          spirit: finalChar.spirit,
          threadClosed,
          xpGained: 0,
        }) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);
```

Add `import type { ProgressTrack } from "../state/character.js";` if not already imported (Task 6 likely added it).

- [ ] **Step 4: Run tests**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "forsake_vow"
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/mutations.ts plugins/ironsworn/scribe/src/tools/mutations.test.ts
git commit -m "feat(scribe): add forsake_vow MCP tool (#60)"
```

---

## Task 12: Add `recommit_vow` tool (test first)

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.ts`
- Modify: `plugins/ironsworn/scribe/src/tools/mutations.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("recommit_vow", () => {
  it("clears to 4 ticks if any boxes were filled (16 → 4)", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "R", rank: "dangerous", kind: "vow", ticks: 16, status: "active" },
      ],
    });
    const result = await callTool(server, "recommit_vow", { track_name: "R" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.track.ticks).toBe(4);
    expect(parsed.track.rank).toBe("formidable");
    expect(parsed.track.status).toBe("active");
  });

  it("clears to 0 if no boxes were filled (3 → 0)", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "R", rank: "dangerous", kind: "vow", ticks: 3, status: "active" },
      ],
    });
    const result = await callTool(server, "recommit_vow", { track_name: "R" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.track.ticks).toBe(0);
    expect(parsed.track.rank).toBe("formidable");
  });

  it("raises rank one tier — troublesome→dangerous→formidable→extreme→epic", async () => {
    for (const [from, to] of [
      ["troublesome", "dangerous"],
      ["dangerous", "formidable"],
      ["formidable", "extreme"],
      ["extreme", "epic"],
    ] as const) {
      const { server } = await setup({
        progressTracks: [
          { name: from, rank: from, kind: "vow", ticks: 0, status: "active" },
        ],
      });
      const result = await callTool(server, "recommit_vow", { track_name: from });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.track.rank).toBe(to);
    }
  });

  it("epic stays epic (no-op rank bump)", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "E", rank: "epic", kind: "vow", ticks: 16, status: "active" },
      ],
    });
    const result = await callTool(server, "recommit_vow", { track_name: "E" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.track.rank).toBe("epic");
    expect(parsed.track.ticks).toBe(4);
  });

  it("rejects non-vow tracks", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "J", rank: "dangerous", kind: "journey", ticks: 0, status: "active" },
      ],
    });
    const result = await callTool(server, "recommit_vow", { track_name: "J" });
    expect(result.isError).toBe(true);
  });

  it("rejects non-active vows", async () => {
    const { server } = await setup({
      progressTracks: [
        { name: "F", rank: "dangerous", kind: "vow", ticks: 16, status: "fulfilled" },
      ],
    });
    const result = await callTool(server, "recommit_vow", { track_name: "F" });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "recommit_vow"
```

- [ ] **Step 3: Implement the tool**

In `mutations.ts`, after the `forsake_vow` block, add:

```ts
const RANK_LADDER: ProgressTrack["rank"][] = ["troublesome", "dangerous", "formidable", "extreme", "epic"];

server.tool(
  "recommit_vow",
  [
    "Recommit to a vow after a Fulfill Your Vow miss (RAW: 'You recommit').",
    "",
    "Clears all but one filled progress box and raises rank by one tier",
    "(epic stays epic). The track remains active — the vow continues.",
    "Use this when the player chooses 'recommit' on a Fulfill miss.",
    "For 'give up', use forsake_vow instead.",
  ].join("\n"),
  {
    track_name: z.string().describe("Name of the vow track to recommit (case-insensitive)"),
  },
  async ({ track_name }) => {
    try {
      const character = await loadCharacter(campaignPath);
      const idx = character.progressTracks.findIndex(
        (t) => t.name.toLowerCase() === track_name.toLowerCase(),
      );
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `Error: Progress track not found: "${track_name}"` }],
          isError: true,
        };
      }
      const track = character.progressTracks[idx]!;
      if (track.kind !== "vow") {
        return {
          content: [{ type: "text", text: `Error: recommit_vow applies to vow tracks only. Track "${track.name}" is kind="${track.kind}".` }],
          isError: true,
        };
      }
      if (track.status !== "active") {
        return {
          content: [{ type: "text", text: `Error: Track "${track.name}" is not active (status: ${track.status})` }],
          isError: true,
        };
      }
      const before = structuredClone(character);
      const priorTicks = track.ticks;
      const priorRank = track.rank;
      track.ticks = priorTicks >= 4 ? 4 : 0;
      const rankIdx = RANK_LADDER.indexOf(priorRank);
      track.rank = RANK_LADDER[Math.min(rankIdx + 1, RANK_LADDER.length - 1)]!;
      await saveCharacter(campaignPath, character);
      await appendJournal(campaignPath, {
        timestamp: new Date().toISOString(),
        kind: "recommitVow",
        before,
        after: character,
      });
      recordMutation(campaignPath);
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          track,
          priorTicks,
          priorRank,
        }) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 4: Run tests**

```bash
cd plugins/ironsworn/scribe
bun test src/tools/mutations.test.ts -t "recommit_vow"
```
Expected: all 6 tests pass.

- [ ] **Step 5: Run full suite + typecheck**

```bash
cd plugins/ironsworn/scribe
bun test
bun run tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/mutations.ts plugins/ironsworn/scribe/src/tools/mutations.test.ts
git commit -m "feat(scribe): add recommit_vow MCP tool (#60)"
```

---

## Task 13: Write the unified skill

**Files:**
- Create: `plugins/ironsworn/skills/ironsworn-progress-tracks/SKILL.md`
- Delete: `plugins/ironsworn/skills/ironsworn-journey/SKILL.md` (and the dir)

The skill is large; structure it strictly per the spec's section outline. Pull verbatim text from the existing `ironsworn-journey` SKILL where appropriate, and from `plugins/ironsworn/agents/ironsworn-gm.md` lines 336–365 for the display section.

- [ ] **Step 1: Read source content**

```bash
cat plugins/ironsworn/skills/ironsworn-journey/SKILL.md
sed -n '336,365p' plugins/ironsworn/agents/ironsworn-gm.md
```

- [ ] **Step 2: Create the skill file**

Create `plugins/ironsworn/skills/ironsworn-progress-tracks/SKILL.md`:

```markdown
---
name: ironsworn-progress-tracks
description: >
  Governs all Ironsworn progress-track play: vows (Swear, Reach a Milestone,
  Fulfill, Forsake, Recommit), journeys (Undertake, Make Camp, Resupply, Reach
  Your Destination), combat tracks, bonds, and scene challenges. ALWAYS invoke
  this skill whenever the player swears, advances, fulfills, or abandons a vow;
  travels across the Ironlands or makes any journey move; ticks any progress
  track; or displays a track's progress glyphs. Never handle progress mechanics
  from memory alone.
---

# Ironsworn Progress Tracks

Progress tracks are the spine of Ironsworn. Vows, journeys, combats, bonds, and scene challenges all use them. This skill is the single source of truth for how they work, how they are advanced, how they resolve, and how they are displayed.

---

## When to Invoke This Skill

Invoke this skill whenever you would otherwise reach for a progress-track rule, including:

- Player swears, advances, fulfills, or abandons a vow
- Player begins, continues, or ends a journey (any of: Undertake a Journey, Make Camp, Resupply, Reach Your Destination)
- Combat resolves: Enter the Fray, Strike, Clash, End the Fight, harm
- Bonds: any move that says "mark progress on your bonds"
- Scene challenges (extended dramatic challenges with progress + countdown)
- Anything that would call `tick_progress`, `reach_milestone`, `fulfill_progress`, `forsake_vow`, `recommit_vow`, `roll_progress`, `create_progress_track`, or `close_track`
- Displaying any track's progress to the player

---

## Progress Track Fundamentals

A progress track has 10 boxes. Each box holds 4 ticks. Maximum is 40 ticks (= 10 fully filled boxes).

**Ticks-per-mark by rank:**

| Rank | Ticks per mark | Boxes per mark |
|---|---|---|
| Troublesome | 12 | 3 |
| Dangerous | 8 | 2 |
| Formidable | 4 | 1 |
| Extreme | 2 | ½ |
| Epic | 1 | ¼ |

**Progress score** (used by `roll_progress`) = number of *fully filled* boxes (those with all 4 ticks). Partial boxes do not count.

---

## Vows

### 1. Swear an Iron Vow

When the player commits to a quest:

1. `resolve_move` with move "Swear an Iron Vow", stat "heart" (add +1 if vow is to a bonded NPC/community).
2. Set the rank from the player's intent (or `roll_oracle`).
3. `create_progress_track` with `name`, `rank`, `kind: "vow"` — this auto-opens a matching thread.

**Outcomes:**

| Result | Effect |
|---|---|
| Strong hit | +2 momentum; clear next step |
| Weak hit | +1 momentum; begin with questions |
| Miss | A significant obstacle. Choose: press on (-2 momentum) or `forsake_vow`. |

The **background vow** (created at character creation) does not require a Swear roll — just `create_progress_track`.

### 2. Reach a Milestone

**RAW trigger:** the player overcomes a critical obstacle, completes a perilous journey, solves a complex mystery, defeats a powerful threat, gains vital support, or acquires a crucial item — *and the success directly advances a vow.*

**Discipline:** after every hit on a move that overcame a meaningful obstacle, ask yourself: did this advance any open vow? If yes:

- Call `reach_milestone` with `track_name=<vow name>`. Default `count=1` (one milestone event).
- The tool reads the rank and applies the canonical amount automatically. Never pass `count > 1` unless the fiction explicitly justifies multiple milestones in one beat (e.g., the rule explicitly notes that a single dramatic moment satisfies two related vows — call `reach_milestone` once per vow, not `count=2`).

**Never use `tick_progress` for vow advancement.** Use `reach_milestone`.

**What does NOT count:**
- A minor success or easy obstacle. Milestones cost something.
- A success unrelated to any vow. Tick nothing.
- Just because a session is ending. Don't patch tracks retroactively — earn them.

### 3. Fulfill Your Vow

When the fiction has reached the climax — the player believes the vow is at its end:

1. `roll_progress` with `track_name=<vow name>` — this returns the outcome and progress score.
2. `fulfill_progress` with `track_name`, `outcome`, optional `resolution` — awards XP and closes the matching thread.

This is a **progress roll, not an action roll.** Do not use `resolve_move`.

**Outcomes (progress roll):**

| Result | Effect |
|---|---|
| Strong hit | Vow fulfilled. XP = troublesome 1, dangerous 2, formidable 3, extreme 4, epic 5. |
| Weak hit | More to be done. XP = troublesome 0, dangerous 1, formidable 2, extreme 3, epic 4. May Swear a new vow to set things right (+1 if so). |
| Miss | Quest is undone. Choose: recommit OR forsake. |

### 4. Miss on Fulfill — Recommit or Forsake

**Always offer the choice via `AskUserQuestion`:**

```
question: "Your quest is undone. What do you do?"
options:
  - value: "recommit"  label: "Recommit"  description: "Clear all but one filled progress, and raise the quest's rank by one (if not already epic). The vow continues."
  - value: "forsake"   label: "Forsake"   description: "Abandon the quest. Endure Stress equal to the rank."
```

- Recommit → `recommit_vow` (clears to one filled box, raises rank one tier).
- Forsake → `forsake_vow` (sets status to forsaken, applies stress, closes thread).

Never auto-decide. The player chooses.

### 5. Forsake Your Vow

When the player abandons a vow (mid-quest or after a Fulfill miss):

- `forsake_vow` with `track_name` and optional `reason`.
- The tool applies stress equal to rank (troublesome=1, dangerous=2, formidable=3, extreme=4, epic=5).
- The matching thread closes with "Forsaken: <reason>" (or just "Forsaken").
- 0 XP awarded. This is failure, not success.

If forsaking a vow central to the character's identity, consider Write Your Epilogue.

---

## Journeys

Journeys are a progress mechanic. The destination is reached by accumulating marks on a journey progress track and then making a progress roll. Supply drain is the primary cost.

### 1. Start the Journey

**First: is this journey even necessary?** Short, safe trips through familiar territory don't get rolled — narrate and move on. Reserve Undertake a Journey for genuinely hazardous or unfamiliar travel.

1. **Determine rank** by distance, danger, and pacing intent:
   - Troublesome — nearby, known region; a short narrative arc
   - Dangerous — significant distance, some hazard
   - Formidable — far lands, real danger
   - Extreme — the edge of the known world
   - Epic — a voyage few have survived

2. `create_progress_track` with `name` (e.g. "Journey to Holtfen"), `rank`, `kind: "journey"`.

3. Narrate the departure — weather, what they carry, who watches them leave.

### 2. Pacing the Journey

Before each roll, choose:

- **Montage (zoom out):** Summarize travel in a sentence. Use for legs that serve the narrative clock but aren't intrinsically interesting.
- **Scene (zoom in):** Slow down. Use when a waypoint is a real story beat.

Mix deliberately. Don't zoom in on every leg; don't montage past everything.

**Travel time is fluid.** One roll might be hours or days. Don't lock to "one roll = one day."

**Transport is fiction, not bonus.** A horse/boat/mule changes logistics, not dice — unless an asset says so.

### 3. Undertake a Journey (Wits)

Each waypoint is one roll.

**Bond bonus:** Setting off from a community with which the character has a bond → add +1 to the *first* Undertake roll only (`adds: 1` on the first `resolve_move`).

**Roll:** `resolve_move` with move "Undertake a Journey", stat "wits".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | Reach a waypoint. Choose: mark progress, or mark progress + take +1 momentum but suffer -1 supply | `tick_progress` (marks=1); if speed: also `consume_supply` n=1, `take_momentum` n=1 |
| Weak hit | Reach a waypoint, mark progress, suffer -1 supply | `tick_progress` (marks=1); `consume_supply` n=1 |
| Miss | Waylaid. Pay the Price. | No progress; narrate complication |

**On strong hit — offer choice:**
```
question: "You make good progress. How do you push on?"
options:
  - value: "steady"  label: "Steady pace"  description: "Mark progress. Resources intact."
  - value: "speed"   label: "Push hard"    description: "Mark progress. +1 momentum, but -1 supply."
```

**On any match (doubles on challenge dice):** introduce something unexpected. Use `roll_oracle` if unsure.

**On a miss — Pay the Price.** Either play it out (concrete obstacle, resolve with follow-on moves) or fast-forward (apply a consequence directly: −supply, −health, −momentum, debility, or a new threat track). Mix the two over a long journey.

**Complication Diversity:** Before narrating the complication, follow the Complication Diversity Protocol in the GM agent — call `get_recent_complications` and pick a fresh theme.

### 4. Mid-Journey Recovery

#### Make Camp (Wits)

Optional. Only roll when the player wants mechanical benefit or you want to play out the rest as a scene.

**Roll:** `resolve_move` with move "Make Camp", stat "wits".

- Strong hit: choose **two**
- Weak hit: choose **one**
- Miss: no comfort. Pay the Price.

```
question: "You make camp. What do you tend to?" (+ "Choose two." or "Choose one.")
options:
  - value: "recuperate"  label: "Recuperate"  description: "+1 health for you and companions."
  - value: "partake"     label: "Partake"     description: "−1 supply, +1 health for you and companions."
  - value: "relax"       label: "Relax"       description: "+1 spirit."
  - value: "focus"       label: "Focus"       description: "+1 momentum."
  - value: "prepare"     label: "Prepare"     description: "+1 to your next Undertake a Journey roll."
```

Apply effects with `restore_health` / `restore_spirit` / `take_momentum` / `consume_supply`. If "Prepare" is chosen, remember to add +1 to the *next* Undertake roll (and only the next).

#### Resupply (Wits)

**Roll:** `resolve_move` with move "Resupply", stat "wits".

| Result | Effect | Tools |
|---|---|---|
| Strong hit | +2 supply | `restore_supply` n=2 |
| Weak hit | Up to +2 supply, but -1 momentum each | `AskUserQuestion`, then `restore_supply` and `take_momentum` n=−chosen |
| Miss | Pay the Price | |

```
question: "You find something, but the search costs you. How much do you gather?"
options:
  - value: "2"  label: "+2 supply"  description: "Lose 2 momentum."
  - value: "1"  label: "+1 supply"  description: "Lose 1 momentum."
  - value: "0"  label: "Nothing"    description: "Keep your momentum."
```

### 5. Reach Your Destination

When the journey track has enough progress and arrival is in sight:

**This is a progress roll, not an action roll.** Use `roll_progress`, not `resolve_move`.

**Roll:** `roll_progress` with `track_name=<journey name>`.

| Result | Effect |
|---|---|
| Strong hit | Destination favors you. Choose: make another move (not a progress move) and add +1, OR take +1 momentum |
| Weak hit | Arrive but face an unforeseen complication. Envision it (use `roll_oracle` if unsure). |
| Miss | Hopelessly astray. Clear all but one filled progress, raise rank by one (epic stays epic). The journey continues. |

**On strong hit — offer choice:**
```
question: "The road has favored you. How do you use the advantage?"
options:
  - value: "move"      label: "Act immediately"  description: "Make another move now and add +1."
  - value: "momentum"  label: "Take momentum"    description: "Take +1 momentum."
```

**After resolution (on a hit):** the journey is over. Call `fulfill_progress` (or `close_track` if no XP appropriate — journeys grant 0 XP regardless). Narrate arrival; use `search_lore` if known. Call `record_scene` for the arrival beat.

### Journeys and Vows — Cross-Link

Arrival can be a milestone for a related vow. If the journey directly served a quest, after closing the journey track, **call `reach_milestone` separately on the vow.** Do not double-tick the journey track itself.

Example: Saskia journeys to Cinderhome to save the overseer. On arrival (Reach Your Destination strong hit) → `fulfill_progress` on "Journey to Cinderhome" → `reach_milestone` on "Save the Overseer".

### Supply Pressure

Track supply faithfully:
- Weak hit on Undertake → −1 supply
- Speed choice on strong hit → −1 supply
- Partake on Make Camp → −1 supply
- Resupply weak hit → −1 momentum per supply taken

When supply hits 0: `inflict_debility` with "unprepared". The character cannot make progress until they resupply or reach a settlement.

---

## Combat Tracks

When combat begins (Enter the Fray) and would benefit from a progress track, `create_progress_track` with `kind: "combat"` and a rank matching the foe.

**Ticking combat tracks:** combat ticks via `tick_progress`, NOT `reach_milestone`. Each point of harm inflicted is rank-dependent ticks (per RAW: 1 harm = 1 mark — i.e., rank-dependent ticks by the same table). Use `tick_progress(marks=N)` where N is harm points.

**End the Fight** is a progress roll: `roll_progress` then `fulfill_progress` (combat tracks always award 0 XP).

---

## Bonds

The bond track is rank-less. Always tick 1 raw tick when a bond move (e.g., Forge a Bond strong hit) says to mark progress.

Use `tick_progress(track_name="bonds", marks=1)` — but note: bonds aren't tracked as a progress track in the standard sense in this system. Increment `character.bonds` directly via the bond mutation if available, or refer to the project's bond handling. (If bonds are stored as a number, not a track, the relevant mutation is increment-bonds, not `tick_progress`. Confirm before calling.)

---

## Scene Challenges

A scene challenge uses two tracks:
- A standard 10-box progress track (rank applies normally — `tick_progress` adds rank-dependent ticks per mark).
- A 4-box countdown track (always one full box at a time).

Resolve via `roll_progress` against the progress track.

---

## Display Format

Use these glyphs for any progress-track display: `○ ◔ ◑ ◕ ●`.

The `ticks` field returned by tools is total ticks (0–40), not boxes.

| Ticks in box | Glyph |
|---|---|
| 0 | ○ |
| 1 | ◔ |
| 2 | ◑ |
| 3 | ◕ |
| 4 | ● |

**Display formula:** for each of the 10 boxes, integer-divide total ticks by 4 to get full boxes (●), then the partial-box glyph for `ticks % 4`, then ○ for the remainder up to 10.

**Examples:**
- 0 ticks → `○○○○○○○○○○`
- 8 ticks (dangerous, 1 mark) → `●●○○○○○○○○`
- 16 ticks (dangerous, 2 marks) → `●●●●○○○○○○`
- 30 ticks → `●●●●●●●◑○○`
- 40 ticks → `●●●●●●●●●●`

---

## Common Mistakes

- **Never use `tick_progress` for a vow milestone — use `reach_milestone`.**
- **Fulfill Your Vow is a progress roll, not an action roll** — use `roll_progress`, not `resolve_move`.
- **Miss on Fulfill: ASK the player recommit vs forsake; do not auto-decide.**
- **Forsake applies stress** equal to rank — use the `forsake_vow` tool, never improvise.
- **Never skip `create_progress_track`** at journey or vow start.
- **Never narrate "they arrived" without rolling Reach Your Destination.**
- **Always tick progress after each Undertake hit** — progress only accumulates through explicit `tick_progress` calls.
- **The Prepare option in Make Camp** gives +1 to the *next* Undertake only — apply once.
- **Don't roll Undertake for mundane travel** — narrate short safe trips.
- **Bond bonus on Undertake applies once** — only the first roll of a journey from a bonded community.
- **Journey arrival → vow milestone is a SEPARATE call** — `fulfill_progress` on the journey, then `reach_milestone` on the vow. Don't double-tick.
```

- [ ] **Step 3: Delete the old skill**

```bash
rm -rf plugins/ironsworn/skills/ironsworn-journey
```

- [ ] **Step 4: Verify only the new skill exists**

```bash
ls plugins/ironsworn/skills/
```

Expected output:
```
ironsworn-character-builder
ironsworn-progress-tracks
ironsworn-world-truths
```

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/skills/ironsworn-progress-tracks/SKILL.md
git rm -r plugins/ironsworn/skills/ironsworn-journey
git commit -m "feat(skill): add ironsworn-progress-tracks (replaces ironsworn-journey) (#60)"
```

---

## Task 14: Update GM agent

**Files:**
- Modify: `plugins/ironsworn/agents/ironsworn-gm.md`

Three edits: replace Journeys section, drop Display section, add discipline rule.

- [ ] **Step 1: Replace the "Journeys" section**

Find the current section (around lines 326–334) starting with `## Journeys`. Replace its body with:

```markdown
## Progress Tracks

**ALWAYS invoke the `ironsworn:ironsworn-progress-tracks` skill** before handling any progress-track interaction. This includes:

- Vows (Swear an Iron Vow, Reach a Milestone, Fulfill Your Vow, Forsake Your Vow, recommit on Fulfill miss)
- Journeys (Undertake a Journey, Make Camp, Resupply, Reach Your Destination)
- Combat tracks (Enter the Fray, harm, End the Fight)
- Bonds, scene challenges, any direct `tick_progress` need
- Displaying any track's progress glyphs

Never run progress mechanics from memory. The skill has the exact tool call sequences, rank-based tick rules, milestone discipline, and display formulas.
```

- [ ] **Step 2: Delete the "Progress Track Display" section**

Remove lines that begin with `## Progress Track Display` and continue through the end of the example/glyph table (originally lines 336–365). The skill is now the single source of truth.

- [ ] **Step 3: Add the milestone discipline rule**

Find the "Useful Reminders" section near the end of the file. Replace the existing line that says:

```markdown
- **Progress tracks** advance by marks — call `tick_progress` after the player earns progress
```

with:

```markdown
- **Progress tracks** advance by marks. After every hit on a move that overcame a critical obstacle, ask: did this advance any open vow? If yes, invoke `ironsworn:ironsworn-progress-tracks` and call `reach_milestone` for that vow before continuing. For non-vow tracks (journey waypoints, combat harm, bonds), use `tick_progress`.
```

- [ ] **Step 4: Verify**

```bash
grep -n "ironsworn-journey\|Progress Track Display" plugins/ironsworn/agents/ironsworn-gm.md
```

Expected: no matches (or only matches inside historical context that should be cleaned up).

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/agents/ironsworn-gm.md
git commit -m "docs(agent): point GM at ironsworn-progress-tracks skill (#60)"
```

---

## Task 15: Bump plugin version and final verification

**Files:**
- Modify: `plugins/ironsworn/.claude-plugin/plugin.json`

Per CLAUDE.md, the Stop hook blocks completion without a version bump. This is a feature change → bump minor.

- [ ] **Step 1: Bump version**

In `plugins/ironsworn/.claude-plugin/plugin.json`, change:

```json
"version": "0.12.0",
```

to:

```json
"version": "0.13.0",
```

- [ ] **Step 2: Run full verification**

```bash
cd plugins/ironsworn/scribe
bun test
bun run tsc --noEmit
```

Expected: all tests pass; typecheck clean.

- [ ] **Step 3: Verify the journey skill is gone**

```bash
ls plugins/ironsworn/skills/
```

Should NOT include `ironsworn-journey`.

- [ ] **Step 4: Verify the new tools are registered**

```bash
grep -c "server.tool(\"reach_milestone\\|server.tool(\"forsake_vow\\|server.tool(\"recommit_vow" plugins/ironsworn/scribe/src/tools/mutations.ts
```

Expected: `3` (one per tool registration).

- [ ] **Step 5: Commit**

```bash
git add plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "chore(plugin): bump version to 0.13.0 (#60)"
```

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin worktree-issue-60
gh pr create --title "feat: progress tracks skill + vow lifecycle tools (closes #60)" --body "$(cat <<'EOF'
## Summary
- New `ironsworn-progress-tracks` skill replaces `ironsworn-journey` and unifies all progress-track guidance (vows, journeys, combat, bonds, scene challenges) including display rules.
- Three new MCP tools: `reach_milestone` (vow-only, rank-aware), `forsake_vow` (sets status, applies stress, closes thread), `recommit_vow` (Fulfill-miss path).
- Schema migration: `ProgressTrack.completed: boolean` → `status: "active" | "fulfilled" | "forsaken"` with one-time campaign-data migration script.
- GM agent points at the new skill and gains a milestone-discipline rule.

## Test plan
- [ ] `bun test` passes in `plugins/ironsworn/scribe/`
- [ ] `bun run tsc --noEmit` clean
- [ ] Migration script runs on existing campaign without error and converts all tracks
- [ ] Manual: swear a dangerous vow, call `reach_milestone` once → ticks=8 (`●●○○○○○○○○`); twice → ticks=16
- [ ] Manual: force a Fulfill miss; GM presents recommit/forsake via `AskUserQuestion`; choosing forsake drops spirit by rank and closes thread
- [ ] Plugin version bumped (Stop hook should pass)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implementing task |
|---|---|
| 1. Schema change (ProgressTrack.status) | Task 1 (interface), Task 4 (loader) |
| 1. Migration script | Task 3 |
| 1. Audit of call sites (read.ts, mutations.ts, narrative.ts, tests) | Tasks 5, 6, 7, 8 |
| 2.1 reach_milestone | Task 10 |
| 2.2 forsake_vow | Task 11 |
| 2.3 recommit_vow | Task 12 |
| 2.4 tick_progress doc update | Task 6 (Step 4) |
| 3. New skill | Task 13 |
| 3. GM agent edits | Task 14 |
| 4. Tests | Tasks 3, 10, 11, 12 |
| 5. Plugin version bump | Task 15 |

All sections covered.

**Placeholder scan:** no "TBD", "TODO", or vague "implement appropriate handling" steps. Every code step has the exact code; every command has the exact path.

**Type consistency:** `ProgressTrack["rank"]` and `ProgressTrack["kind"]` referenced consistently. `TICKS_PER_MARK` imported from `rules/ironsworn/progress.js` (already present). New constants `STRESS_BY_RANK` and `RANK_LADDER` defined where used. Tool response shapes match the spec.

**One potential gap:** the spec mentions the `bonds` field in `Character` is a number, not a progress track — but the skill's section 6 says "use `tick_progress(track_name='bonds', marks=1)`." The skill text already flags this as needing confirmation in the implementation phase. The implementer should verify and adjust the skill text in Task 13 if `character.bonds` is incremented through a different mutation. This is called out inline in the skill content and is not a placeholder — it's an honest "verify before publishing this guidance."
