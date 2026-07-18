# Runtime Observability — Turn Ledger + Deterministic Referee (Spec & Plan)

**Status:** Spec — approved design pending implementation
**Issue:** #211 (layer 1 of the runtime-observability track, umbrella #214)
**Related:** #212 (LLM watcher), #213 (/session-report), #200 (narration-quality spike)

---

## 1. Problem

Every gameplay invariant in `agents/ironsworn-gm.md` — the burn gate, the
milestone check, beat recording, no-phantom-rolls, no-state-drift — is enforced
by prompt discipline alone. Eight+ sessions of play show these decay silently
under long context; the escalating MANDATORY/NEVER language in the GM prompt is
the accumulated scar tissue. Nothing at runtime notices a lapse, so lapses
surface sessions later as incoherence, and problem discovery still runs on
human memory.

This layer adds the cheapest, highest-leverage piece of the observer: a
**complete event ledger** written by the scribe, an **observations store** all
observer layers share, and a **deterministic referee** that checks every turn
and either bounces hard violations back to the agent for self-correction or
logs soft ones for later review.

## 2. The structural facts (what constrains the design)

1. **The scribe server never sees prose.** MCP tools receive mechanical events;
   the agent's narration goes straight to the player. No server-side component
   can check prose against mechanics on its own.
2. **The session transcript contains both streams.** Claude Code hooks receive
   `transcript_path` on stdin. The transcript JSONL carries assistant text,
   `tool_use` blocks (with inputs), and `tool_result` blocks (with the scribe's
   JSON responses) — exactly turn-scoped, in order.
3. **A Stop hook can block with a reason** that is delivered back to the agent
   (the `{"decision": "block", "reason": ...}` + exit 2 pattern already used by
   `scripts/check-version-bump.sh`). This is the only runtime channel that can
   turn a NEVER clause into self-correcting feedback.

**Design consequence (refinement over the issue text):** the referee parses the
just-finished turn's tool calls *and results* directly from the transcript. It
does **not** correlate against ledger timestamps — transcript blocks are exact
and turn-scoped, timestamps are approximate. The turn ledger is therefore *not*
a referee dependency; it is the durable, structured event stream that #213's
pacing metrics and cross-session reports need (transcripts are per-session,
harness-owned, and formatted for parsing rather than querying). The two
components ship together because they instrument the same events, but neither
depends on the other.

## 3. Goals / non-goals

**Goals**

- Catch the "silent protocol decay" class the moment it happens, per turn.
- Make the three unambiguous violations self-correcting via the blocking channel.
- Establish the observation substrate (#212 and #213 write into and read from it).
- Fail open everywhere: observer breakage must never interrupt play.

**Non-goals**

- No LLM judgment of prose quality (that is #212).
- No reporting/rendering surface (that is #213).
- No server-side state-machine enforcement (e.g. a pending-burn token in
  `resolve_move`). That is a possible future hardening; the referee is the
  cheaper first line and also covers cases a server gate cannot see (prose
  claiming things that never hit the server at all).
- No changes to the GM prompt. Shrinking its compliance armor is a payoff that
  comes *after* the referee proves it catches the lapses the armor exists for.

## 4. Component A — Turn ledger (scribe)

### What

One JSONL entry per MCP tool call, written to the campaign folder:
`<campaign>/session-ledger.jsonl` (sibling of `state-journal.jsonl`, which it
generalizes; the mutation journal stays untouched — it is an audit log of
character state, not an event stream).

```jsonc
{
  "ts": "2026-07-18T19:04:11.512Z",
  "tool": "resolve_move",
  "args": { "move_name": "Face Danger", "stat": "iron", "adds": 1 },
  "result": { "outcome": "weak_hit", "burnOffered": true },
  "isError": false
}
```

### How

`instrumentServer(server, campaignPath)` in `scribe/src/ledger.ts`, called in
`server.ts` **before** the six `register(...)` calls and `loadExpansions`. It
wraps `server.tool` so every subsequently registered handler (core tools and
expansion tools alike) is intercepted — no per-tool changes, and future tools
are covered automatically.

- **Args:** logged as passed, with each string field truncated (default 300
  chars) so prose-bearing args (`record_scene` summaries, beat text) don't
  bloat the file.
- **Results:** a per-tool **allowlist** of result fields worth extracting
  (`resolve_move` → `outcome`, `burnOffered`, dice; `roll_progress` → outcome;
  mutations → the `after` resource values; default → nothing but `isError`).
  The allowlist lives in `ledger.ts` as a plain map; unknown tools log
  name/args/error only.
- **Failure mode:** append errors are swallowed to stderr (same convention as
  checkpoint failures in `server.ts`). Ledger writes must never fail a tool call.
- **Rotation:** none in v1. The file is append-only per campaign; `/session-
  report` (#213) segments it by timestamp. Revisit if size becomes real.

## 5. Component B — Observations store (core)

### Schema

`world.duckdb` migration **version 3** in `packages/core/src/migrations/world.ts`
(append-only, after v2 `contradictions`), plus the matching `CREATE TABLE IF NOT
EXISTS` in `rag/world-db.ts` `initDb` so fresh worlds need no migration:

```sql
CREATE TABLE IF NOT EXISTS observations (
  id          TEXT PRIMARY KEY,      -- UUID, consistent with other tables
  campaign_id TEXT NOT NULL,         -- FK campaigns(id); observations are campaign-scoped
  created_at  TIMESTAMP NOT NULL,
  source      TEXT NOT NULL,         -- 'referee' | 'watcher' (#212)
  severity    TEXT NOT NULL,         -- 'hard' | 'soft'
  kind        TEXT NOT NULL,         -- 'burn_gate_skipped' | 'state_drift' | 'phantom_roll'
                                     -- | 'milestone_skip' | 'beat_starvation' | 'ungrounded_entity'
                                     -- (#212 adds 'canon_conflict', 'agency_violation', ...)
  detail      TEXT NOT NULL,         -- human-readable, includes evidence quote
  turn_ref    TEXT,                  -- transcript locator: "<session_id>:<line_no>"
  blocked     BOOLEAN DEFAULT FALSE, -- referee bounced it back to the agent
  resolved_at TIMESTAMP,             -- #213's resolve_observation sets this
  resolution  TEXT
);
```

### API (`packages/core/src/rag/observations.ts`)

- `recordObservation(campaignPath, obs)` — insert; used by the referee CLI and
  later by the watcher.
- `listObservations(campaignPath, { unresolvedOnly, kind, since })` — #213's
  read path; built now so the store is queryable from day one.
- `resolveObservation(campaignPath, id, note)` — mirrors
  `resolve_contradiction`; the MCP tool wrapper ships with #213.

Campaign visibility follows the standard filter (rows carry `campaign_id`;
observations never cross campaigns — there is no canon/overlay concept here).

## 6. Component C — Referee Stop hook

### Execution shape

- `scribe/src/referee/` — all logic, fully unit-testable:
  - `transcript.ts` — parse transcript JSONL; extract the **last turn** = all
    assistant entries (text + `tool_use`) and their `tool_result`s since the
    last *human* user message (a user entry containing non-tool_result text).
  - `checks.ts` — pure functions `(turn: ParsedTurn) => Violation[]`; each
    check is data-driven and individually testable.
  - `cli.ts` — reads hook JSON from stdin, loads the transcript, runs checks,
    records observations, emits the block decision or exits 0.
- `scripts/referee-hook.sh` — thin shell: `bun run .../referee/cli.ts`, with a
  hard `timeout` and unconditional `exit 0` on any script-level error
  (fail-open is enforced at the shell layer, not trusted to the TS code).
- Hook registration: the plugin's hook config, using `${CLAUDE_PLUGIN_ROOT}`
  paths so it works for installed-plugin users — **not** the repo-relative
  pattern of the existing dev-only version-bump hook. The referee only runs
  when `SCRIBE_CAMPAIGN` resolves to a campaign (i.e. in play sessions); in
  dev sessions it exits 0 immediately.

### The checks

**Hard (blocking) — keyed off structured facts in the turn, near-zero false
positive:**

| Kind | Trigger |
|---|---|
| `burn_gate_skipped` | A `resolve_move` result in this turn has `burnOffered: true`, AND assistant text after that tool call contains outcome narration, AND no burn decision intervened (no `AskUserQuestion` tool_use, no `burn_momentum`, no second `resolve_move` with `burn_momentum: true`) |
| `state_drift` | Assistant text states a numeric resource change (`[-−+]\s*\d+\s+(health|spirit|supply|momentum)` and close variants) with no matching mutation tool call in the turn |
| `phantom_roll` | Assistant text contains outcome-band language ("strong hit" / "weak hit" / "miss") **together with** dice-value phrasing, and the turn contains no `resolve_move` / `roll_progress` / `roll_epilogue` |

**Soft (log-only) heuristics:**

| Kind | Trigger |
|---|---|
| `milestone_skip` | Strong/weak hit resolved, character has open vows/tracks (from the turn's own `session_briefing`/`get_character_*` results when present, else skipped), and no `reach_milestone`/`tick_progress` in the turn |
| `beat_starvation` | A `record_scene` opened a scene ≥ N turns ago (cursor state) with zero `record_beat` since |
| `ungrounded_entity` | Capitalized multi-word proper noun in narration appearing in no `recall`/`search_lore` result earlier in the session (requires the session cursor's name cache) |

Soft checks that need cross-turn state use a small cursor file
(`<campaign>/.referee-state.json`: last processed transcript line, open scene
turn counter, seen-entity name cache). Cursor corruption ⇒ delete and restart
from the current turn — never an error.

### Blocking policy

- Block ⇒ `{"decision": "block", "reason": "<kind>: <one-line instruction with the evidence quote>"}`
  on stderr + exit 2. The reason is written to the agent, so it is phrased as a
  corrective instruction ("You narrated −2 health but no `suffer_harm` was
  called — reconcile before ending the turn"), not a log line.
- **At most one block per turn.** If the incoming hook payload has
  `stop_hook_active: true` (this Stop is already a continuation from a stop
  hook), the referee runs checks **log-only**. This structurally prevents
  block loops even when the agent's correction is itself imperfect.
- Every violation is recorded as an observation whether or not it blocked
  (`blocked` column distinguishes).
- **Mode switch:** `SCRIBE_REFEREE_MODE` env — `off` | `log` | `enforce`.
  Ships defaulting to `log`; flipped to `enforce` as default only after the
  tuning phase (§8) shows the hard checks are clean.

## 7. Testing

- **Fixture transcripts** (`scribe/src/referee/fixtures/*.jsonl`): hand-built
  turns for each check — one violating, one compliant, plus the known
  edge cases (burn offered and correctly gated; harm narrated as *past*
  recap "you lost 2 health yesterday"; oracle-quoted outcome words; player
  message containing outcome language).
- Unit tests per check in `checks.test.ts`; transcript extraction tests in
  `transcript.test.ts` (multi-turn files, tool_result-only user entries,
  truncated/corrupt tail lines).
- `cli.test.ts` drives the CLI end-to-end with stdin payloads against fixture
  transcripts + a temp campaign, asserting exit codes, block JSON, and
  observation rows.
- Ledger: instrumentation test that registers a fake tool through
  `instrumentServer` and asserts the JSONL entry shape, truncation, and the
  swallow-on-append-failure behavior.
- Observations: migration test (v2 → v3) + fresh-init parity, following the
  existing `migrations/index.test.ts` pattern.

## 8. Rollout plan

1. **Phase A — ship in `log` mode.** Play 2–3 real sessions. Every check
   records observations; nothing blocks. Review the observation rows (raw SQL
   until #213 lands) and tune regexes/heuristics against the false positives
   found.
2. **Phase B — default `enforce`.** Only the three hard checks block; soft
   checks stay log-only permanently (they graduate individually, if ever, on
   evidence).
3. **Phase C — feed the loop.** #213 renders the accumulated observations;
   recurring soft-check hits become GitHub issues with transcript quotes as
   evidence. Only after the referee demonstrably holds the floor do we start
   *removing* compliance armor from the GM prompt (tracked as its own issue,
   with before/after observation rates as the measure).

## 9. Implementation plan (single PR, sequenced commits)

1. **core: observations store** — migration v3, `initDb` table,
   `rag/observations.ts` API + tests. No consumers yet; lowest-risk commit.
2. **scribe: turn ledger** — `ledger.ts` (`instrumentServer` + result
   allowlist), wire into `server.ts`, tests.
3. **scribe: referee module** — `transcript.ts`, `checks.ts` (hard checks
   first, then soft), fixtures, tests. Pure logic; no hook yet.
4. **referee CLI + hook wiring** — `cli.ts`, `scripts/referee-hook.sh`, plugin
   hook registration with `${CLAUDE_PLUGIN_ROOT}`, `SCRIBE_REFEREE_MODE`
   plumbing, cursor state.
5. **docs + version bump** — CLAUDE.md (new module map entries), this doc's
   status flip to "Implemented (Phase A)", minor version bump (new feature).

Estimated size: the referee module is the only genuinely new logic (~400–600
lines with tests); ledger and store are conventional extensions of existing
patterns.

## 10. Open questions

- **OQ1 — turn extraction vs. compaction:** after context compaction the
  transcript may open mid-conversation. The extractor treats "no human message
  found" as "process everything since file start, log-only" — verify against a
  real compacted transcript during Phase A.
- **OQ2 — `AskUserQuestion` visibility:** confirm the burn-gate check can see
  `AskUserQuestion` tool_use blocks in the transcript in installed-plugin
  sessions (it is a harness tool, not an MCP tool). If not, the check falls
  back to detecting the burn-offer question in assistant text.
- **OQ3 — multi-campaign sessions:** `SCRIBE_CAMPAIGN` is fixed per server
  process; the referee resolves the campaign the same way. A session that
  switches campaigns mid-play is out of scope (as it is for the scribe itself).
- **OQ4 — should hard blocks also write a beat?** Leaning no: the correction
  turn's own tool calls land in the ledger/beats naturally; double-recording
  invites drift.
