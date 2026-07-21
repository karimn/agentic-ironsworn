import { describe, it, expect } from "bun:test";
import { extractLastTurn, normalizeToolName } from "./transcript.js";
import {
  userMsg,
  userMsgString,
  assistantText,
  assistantToolUse,
  toolResult,
  transcript,
} from "./fixtures.js";

describe("normalizeToolName", () => {
  it("strips the MCP server prefix", () => {
    expect(normalizeToolName("mcp__plugin_ironsworn_scribe__resolve_move")).toBe("resolve_move");
    expect(normalizeToolName("AskUserQuestion")).toBe("AskUserQuestion");
  });
});

describe("extractLastTurn", () => {
  it("returns only events after the final human message", () => {
    const raw = transcript(
      userMsg("I approach the gate."),
      assistantText("old turn text"),
      userMsg("I open it."),
      assistantText("The gate groans open."),
    );
    const turn = extractLastTurn(raw);
    expect(turn.assistantText).toBe("The gate groans open.");
    expect(turn.noHumanBoundary).toBe(false);
  });

  it("joins tool results to their tool_use and normalizes names", () => {
    const raw = transcript(
      userMsg("I strike."),
      assistantToolUse("t1", "mcp__plugin_ironsworn_scribe__resolve_move", {
        move_name: "Strike", stat: "iron",
      }),
      toolResult("t1", { band: "strong_hit", burnOffered: false }),
      assistantText("Your blade lands."),
    );
    const turn = extractLastTurn(raw);
    const call = turn.events.find((e) => e.kind === "tool_call");
    expect(call).toMatchObject({
      name: "resolve_move",
      input: { move_name: "Strike", stat: "iron" },
    });
    expect(JSON.parse((call as { resultText: string }).resultText)).toEqual({
      band: "strong_hit", burnOffered: false,
    });
    // Order preserved: tool call before the narration text.
    expect(turn.events[0]!.kind).toBe("tool_call");
    expect(turn.events[1]!.kind).toBe("text");
  });

  it("does not treat tool_result user entries as human boundaries", () => {
    const raw = transcript(
      userMsg("I look around."),
      assistantToolUse("t1", "mcp__plugin_ironsworn_scribe__recall", { query: "village" }),
      toolResult("t1", { entities: [] }),
      assistantText("The village is quiet."),
    );
    const turn = extractLastTurn(raw);
    expect(turn.assistantText).toBe("The village is quiet.");
    expect(turn.events).toHaveLength(2);
  });

  it("accepts plain-string user content as a human boundary", () => {
    const raw = transcript(
      userMsgString("first"),
      assistantText("one"),
      userMsgString("second"),
      assistantText("two"),
    );
    expect(extractLastTurn(raw).assistantText).toBe("two");
  });

  it("skips corrupt lines and flags a missing human boundary", () => {
    const raw = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"orphaned"}]}}\n{broken json\n';
    const turn = extractLastTurn(raw);
    expect(turn.noHumanBoundary).toBe(true);
    expect(turn.assistantText).toBe("orphaned");
  });
});
