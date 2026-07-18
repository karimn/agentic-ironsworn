// Transcript-entry builders shared by the referee test files. Kept out of
// the *.test.ts files so importing them doesn't re-register another file's
// tests.

export function userMsg(text: string): object {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

export function userMsgString(text: string): object {
  return { type: "user", message: { role: "user", content: text } };
}

export function assistantText(text: string): object {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

export function assistantToolUse(id: string, name: string, input: object): object {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  };
}

export function toolResult(id: string, payload: object | string): object {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }],
    },
  };
}

export function transcript(...entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
