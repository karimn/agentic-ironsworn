// Transcript parsing for the deterministic referee (#211).
//
// The referee reads the just-finished turn straight from the Claude Code
// session transcript (JSONL): assistant text, tool_use blocks, and their
// tool_result payloads are exact and turn-scoped there, which is why the
// referee does NOT timestamp-correlate against the session ledger — see
// docs/design/runtime-observability.md §2.

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface TranscriptEntry {
  type?: string;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

/** One ordered event within a turn — order matters for the burn-gate check. */
export type TurnEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; name: string; input: Record<string, unknown>; resultText?: string };

export interface ParsedTurn {
  events: TurnEvent[];
  /** Concatenated assistant prose, in order. */
  assistantText: string;
  /** True when no human user message was found (e.g. post-compaction head). */
  noHumanBoundary: boolean;
  /** 1-based transcript line number of the first entry in the turn. */
  startLine: number;
}

/** Strip the MCP server prefix: mcp__plugin_ironsworn_scribe__resolve_move → resolve_move. */
export function normalizeToolName(name: string): string {
  const match = /^mcp__.+__(.+)$/.exec(name);
  return match ? match[1]! : name;
}

function blocks(entry: TranscriptEntry): ContentBlock[] {
  const content = entry.message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

/** A human boundary: a real user message (typed text, not tool results, not meta). */
function isHumanMessage(entry: TranscriptEntry): boolean {
  if (entry.type !== "user" || entry.isMeta === true) return false;
  const bs = blocks(entry);
  if (bs.some((b) => b.type === "tool_result")) return false;
  return bs.some((b) => b.type === "text" && (b.text ?? "").trim().length > 0);
}

function toolResultText(block: ContentBlock): string | undefined {
  const inner = block.content;
  if (typeof inner === "string") return inner;
  if (Array.isArray(inner)) {
    const textBlock = (inner as ContentBlock[]).find((b) => b.type === "text");
    return textBlock?.text;
  }
  return undefined;
}

export function parseTranscriptLines(raw: string): TranscriptEntry[] {
  return raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return null;
      try {
        return JSON.parse(trimmed) as TranscriptEntry;
      } catch {
        return null; // corrupt/truncated tail lines are skipped, never fatal
      }
    })
    .filter((e): e is TranscriptEntry => e !== null);
}

/**
 * Extract the last turn: every assistant event after the final human user
 * message, with tool_use blocks joined to their tool_result payloads.
 */
export function extractLastTurn(raw: string): ParsedTurn {
  const entries = parseTranscriptLines(raw);

  let boundary = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isHumanMessage(entries[i]!)) {
      boundary = i;
      break;
    }
  }

  // Collect tool results from user entries anywhere after the boundary —
  // results always trail their tool_use, possibly across several entries.
  const resultsById = new Map<string, string>();
  for (let i = boundary + 1; i < entries.length; i++) {
    for (const block of blocks(entries[i]!)) {
      if (block.type === "tool_result" && block.tool_use_id !== undefined) {
        const text = toolResultText(block);
        if (text !== undefined) resultsById.set(block.tool_use_id, text);
      }
    }
  }

  const events: TurnEvent[] = [];
  const textParts: string[] = [];
  for (let i = boundary + 1; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.type !== "assistant") continue;
    for (const block of blocks(entry)) {
      if (block.type === "text" && (block.text ?? "").trim().length > 0) {
        events.push({ kind: "text", text: block.text! });
        textParts.push(block.text!);
      } else if (block.type === "tool_use" && block.name !== undefined) {
        events.push({
          kind: "tool_call",
          name: normalizeToolName(block.name),
          input: (block.input ?? {}) as Record<string, unknown>,
          resultText: block.id !== undefined ? resultsById.get(block.id) : undefined,
        });
      }
    }
  }

  return {
    events,
    assistantText: textParts.join("\n"),
    noHumanBoundary: boundary === -1,
    startLine: boundary + 2, // 1-based line after the boundary entry
  };
}
