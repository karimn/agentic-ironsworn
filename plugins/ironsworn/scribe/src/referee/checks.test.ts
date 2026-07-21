import { describe, it, expect } from "bun:test";
import { extractLastTurn } from "./transcript.js";
import {
  runChecks,
  emptyCursor,
  updateCursor,
  checkBeatStarvation,
  type RefereeCursor,
} from "./checks.js";
import {
  userMsg,
  assistantText,
  assistantToolUse,
  toolResult,
  transcript,
} from "./fixtures.js";

const SCRIBE = "mcp__plugin_ironsworn_scribe__";

function turnOf(...entries: object[]) {
  return extractLastTurn(transcript(userMsg("go"), ...entries));
}

function kinds(entries: object[], cursor: RefereeCursor = emptyCursor()): string[] {
  const turn = extractLastTurn(transcript(userMsg("go"), ...entries));
  return runChecks(turn, cursor).violations.map((v) => v.kind);
}

// ---------------------------------------------------------------------------
// burn_gate_skipped
// ---------------------------------------------------------------------------

const OFFERED = { band: "weak_hit", burnOffered: true, momentumBurned: false };

describe("burn_gate_skipped", () => {
  it("flags outcome narration after an unanswered burn offer", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Face Danger", stat: "iron" }),
      toolResult("t1", OFFERED),
      assistantText("The rope snaps and you slam into the cliff face."),
    ])).toContain("burn_gate_skipped");
  });

  it("passes when AskUserQuestion intervenes", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Face Danger", stat: "iron" }),
      toolResult("t1", OFFERED),
      assistantToolUse("t2", "AskUserQuestion", { questions: [] }),
      toolResult("t2", { answer: "keep" }),
      assistantText("The rope snaps and you slam into the cliff face."),
    ])).not.toContain("burn_gate_skipped");
  });

  it("passes when the trailing prose is the burn offer itself", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Face Danger", stat: "iron" }),
      toolResult("t1", OFFERED),
      assistantText("Your momentum is 7. Burn it to turn this into a strong hit?"),
    ])).not.toContain("burn_gate_skipped");
  });

  it("passes when momentum was already burned in the call", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, {
        move_name: "Face Danger", stat: "iron", burn_momentum: true,
        challenge_die_1: 4, challenge_die_2: 9,
      }),
      toolResult("t1", { band: "strong_hit", burnOffered: true, momentumBurned: true }),
      assistantText("You wrench yourself over the lip of the cliff."),
    ])).not.toContain("burn_gate_skipped");
  });
});

// ---------------------------------------------------------------------------
// state_drift
// ---------------------------------------------------------------------------

describe("state_drift", () => {
  it("flags a narrated resource change with no mutation call", () => {
    const violations = runChecks(
      turnOf(assistantText("The fall costs you. You lose 2 health and your shoulder screams.")),
      emptyCursor(),
    ).violations;
    const drift = violations.find((v) => v.kind === "state_drift");
    expect(drift).toBeDefined();
    expect(drift!.severity).toBe("hard");
    expect(drift!.detail).toContain("suffer_harm");
  });

  it("flags '-1 supply' notation", () => {
    expect(kinds([assistantText("The pack tears open on the rocks. −1 supply.")]))
      .toContain("state_drift");
  });

  it("passes when the matching mutation was called", () => {
    expect(kinds([
      assistantText("You lose 2 health as the rocks bite."),
      assistantToolUse("t1", `${SCRIBE}suffer_harm`, { n: 2 }),
      toolResult("t1", { ok: true, state: { health: 2 } }),
    ])).not.toContain("state_drift");
  });

  it("treats a resolve_move burn as touching momentum", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, {
        move_name: "Strike", stat: "iron", burn_momentum: true,
        challenge_die_1: 2, challenge_die_2: 8,
      }),
      toolResult("t1", { band: "strong_hit", burnOffered: true, momentumBurned: true }),
      assistantText("You spend it all — momentum resets to +2 after burning 8 momentum."),
    ])).not.toContain("state_drift");
  });

  it("ignores prose without numeric resource claims", () => {
    expect(kinds([assistantText("You feel your strength ebbing; supplies are running low.")]))
      .not.toContain("state_drift");
  });
});

// ---------------------------------------------------------------------------
// phantom_roll
// ---------------------------------------------------------------------------

describe("phantom_roll", () => {
  it("flags band + dice language with no roll tool", () => {
    expect(kinds([
      assistantText("A weak hit — your action score of 6 beats one challenge die but not the other."),
    ])).toContain("phantom_roll");
  });

  it("passes when a roll tool was called", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Strike", stat: "iron" }),
      toolResult("t1", { band: "weak_hit", burnOffered: false }),
      assistantText("A weak hit — your action score of 6 beats one challenge die but not the other."),
    ])).not.toContain("phantom_roll");
  });

  it("does not flag 'miss' in ordinary prose", () => {
    expect(kinds([assistantText("You miss her already, three days out from the village.")]))
      .not.toContain("phantom_roll");
  });
});

// ---------------------------------------------------------------------------
// milestone_skip
// ---------------------------------------------------------------------------

describe("milestone_skip", () => {
  it("flags a hit with no progress tool call (soft)", () => {
    const violations = runChecks(
      turnOf(
        assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Face Danger", stat: "wits" }),
        toolResult("t1", { band: "strong_hit", burnOffered: false }),
        assistantText("You slip past the sentries."),
      ),
      emptyCursor(),
    ).violations;
    const skip = violations.find((v) => v.kind === "milestone_skip");
    expect(skip).toBeDefined();
    expect(skip!.severity).toBe("soft");
  });

  it("passes when tick_progress was called, and on misses", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Strike", stat: "iron" }),
      toolResult("t1", { band: "strong_hit", burnOffered: false }),
      assistantToolUse("t2", `${SCRIBE}tick_progress`, { track_name: "Bandit Captain", ticks: 2 }),
      toolResult("t2", { ok: true }),
    ])).not.toContain("milestone_skip");

    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Strike", stat: "iron" }),
      toolResult("t1", { band: "miss", burnOffered: false }),
    ])).not.toContain("milestone_skip");
  });
});

// ---------------------------------------------------------------------------
// beat_starvation (cursor-driven)
// ---------------------------------------------------------------------------

describe("beat_starvation", () => {
  it("flags after 4 turns of an open scene with no beats, and resets on record_beat", () => {
    let cursor = emptyCursor();
    cursor = updateCursor(cursor, turnOf(
      assistantToolUse("t1", `${SCRIBE}record_scene`, { summary: "[scene opening]" }),
      toolResult("t1", { scene_id: "s1" }),
    ));
    for (let i = 0; i < 2; i++) {
      cursor = updateCursor(cursor, turnOf(assistantText("quiet narration")));
      expect(checkBeatStarvation(cursor)).toHaveLength(0);
    }
    cursor = updateCursor(cursor, turnOf(assistantText("still no beats")));
    expect(checkBeatStarvation(cursor)).toHaveLength(1);

    cursor = updateCursor(cursor, turnOf(
      assistantToolUse("t2", `${SCRIBE}record_beat`, { scene_id: "s1", kind: "narration" }),
      toolResult("t2", { ok: true }),
    ));
    expect(checkBeatStarvation(cursor)).toHaveLength(0);
  });

  it("stops tracking after update_scene closes the scene", () => {
    let cursor = emptyCursor();
    cursor = updateCursor(cursor, turnOf(
      assistantToolUse("t1", `${SCRIBE}record_scene`, { summary: "[opening]" }),
      toolResult("t1", { scene_id: "s1" }),
    ));
    cursor = updateCursor(cursor, turnOf(
      assistantToolUse("t2", `${SCRIBE}update_scene`, { scene_id: "s1", summary: "done" }),
      toolResult("t2", { ok: true }),
    ));
    for (let i = 0; i < 5; i++) {
      cursor = updateCursor(cursor, turnOf(assistantText("post-scene chatter")));
    }
    expect(checkBeatStarvation(cursor)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ungrounded_entity (cursor-driven)
// ---------------------------------------------------------------------------

describe("ungrounded_entity", () => {
  it("flags a multi-word proper noun absent from all grounding results", () => {
    const violations = runChecks(
      turnOf(assistantText("A rider bears the sigil of Kestrel Vale on her cloak.")),
      emptyCursor(),
    ).violations;
    expect(violations.map((v) => v.kind)).toContain("ungrounded_entity");
    expect(violations.find((v) => v.kind === "ungrounded_entity")!.evidence).toBe("Kestrel Vale");
  });

  it("passes when the name appeared in a recall result — same turn or earlier", () => {
    // Same turn: recall returns the name before narration uses it.
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}recall`, { query: "Kestrel Vale" }),
      toolResult("t1", { entities: [{ canonical: "Kestrel Vale" }] }),
      assistantText("The road bends toward Kestrel Vale."),
    ])).not.toContain("ungrounded_entity");

    // Earlier turn: cursor carries the grounding cache forward.
    const primed = updateCursor(emptyCursor(), turnOf(
      assistantToolUse("t1", `${SCRIBE}recall`, { query: "Kestrel Vale" }),
      toolResult("t1", { entities: [{ canonical: "Kestrel Vale" }] }),
    ));
    expect(kinds([assistantText("Kestrel Vale rises ahead.")], primed))
      .not.toContain("ungrounded_entity");
  });

  it("does not flag Ironsworn move names or single-word capitals", () => {
    const violationKinds = kinds([
      assistantText("This is Face Danger. Kara braces. On a Strong Hit you are through."),
    ]);
    expect(violationKinds).not.toContain("ungrounded_entity");
  });

  it("does not flag names introduced by this turn's own entity writes", () => {
    expect(kinds([
      assistantToolUse("t1", `${SCRIBE}record_beat`, {
        scene_id: "s1",
        entities: [{ name: "Torv Ashfell", type: "person" }],
      }),
      toolResult("t1", { ok: true }),
      assistantText("Torv Ashfell steps out of the smoke."),
    ])).not.toContain("ungrounded_entity");
  });
});
