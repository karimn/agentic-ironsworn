import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Turn ledger (#211): one JSONL entry per MCP tool call, written to
// <campaign>/session-ledger.jsonl. This is the durable, queryable event
// stream behind /session-report's pacing metrics and the watcher's
// cross-checks. The referee reads the transcript, not this file — see
// docs/design/runtime-observability.md §2.
//
// Invariant: a ledger failure must never fail (or slow) a tool call.

export const LEDGER_FILENAME = "session-ledger.jsonl";
const MAX_STRING = 300;

export interface LedgerEntry {
  ts: string;
  tool: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  isError: boolean;
}

function truncate(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(truncate);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, truncate(v)]),
    );
  }
  return value;
}

// Per-tool allowlist of result fields worth keeping. Fields absent from a
// result are skipped; tools not listed log nothing but name/args/isError.
const RESULT_ALLOWLIST: Record<string, string[]> = {
  resolve_move: [
    "moveName", "stat", "band", "match", "burnOffered", "momentumBurned",
    "actionDie", "challengeDice", "actionScore",
  ],
  roll_progress: ["band", "match", "progressScore", "challengeDice", "score", "outcome"],
  roll_epilogue: ["band", "match", "score", "challengeDice", "outcome"],
  roll_oracle: ["table", "roll", "result"],
  roll_yes_no: ["answer", "roll", "likelihood"],
  roll_dice: ["rolls", "total"],
  // Mutations all return { ok, state: characterDigest } — small by design.
  suffer_harm: ["ok", "state"],
  suffer_stress: ["ok", "state"],
  suffer_supply: ["ok", "state"],
  restore_health: ["ok", "state"],
  restore_spirit: ["ok", "state"],
  restore_supply: ["ok", "state"],
  take_momentum: ["ok", "state"],
  lose_momentum: ["ok", "state"],
  burn_momentum: ["ok", "state"],
  tick_progress: ["ok", "track", "state"],
  reach_milestone: ["ok", "track", "state"],
  record_scene: ["scene_id", "id", "ok"],
  record_beat: ["ok", "id", "beat_id"],
};

function extractResult(
  tool: string,
  content: unknown,
): Record<string, unknown> | undefined {
  const allow = RESULT_ALLOWLIST[tool];
  if (allow === undefined) return undefined;
  // MCP results carry JSON in the first text content block.
  const blocks = content as { type?: string; text?: string }[] | undefined;
  const text = blocks?.[0]?.type === "text" ? blocks[0].text : undefined;
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined; // error strings etc. — isError already captures it
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of allow) {
    if (field in record) out[field] = truncate(record[field]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function append(campaignPath: string, entry: LedgerEntry): Promise<void> {
  try {
    await appendFile(
      join(campaignPath, LEDGER_FILENAME),
      JSON.stringify(entry) + "\n",
      "utf-8",
    );
  } catch (e) {
    process.stderr.write(`[scribe] ledger append failed: ${e}\n`);
  }
}

type ToolHandler = (...handlerArgs: unknown[]) => Promise<{
  content?: unknown;
  isError?: boolean;
}>;

/**
 * Patch `server.tool` so every subsequently registered handler — core tools
 * and expansion tools alike — logs one ledger entry per call. Must run in
 * server.ts BEFORE the register(...) calls and loadExpansions.
 *
 * McpServer.tool overloads all end in the handler callback; when a params
 * schema was provided the handler's first call argument is the parsed tool
 * input, otherwise it's the MCP `extra` object. We detect schema presence at
 * registration time so args are only logged when they are real tool input.
 */
export function instrumentServer(server: McpServer, campaignPath: string): void {
  const original = server.tool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (...regArgs: unknown[]): unknown => {
    const name = regArgs[0] as string;
    const handlerIndex = regArgs.length - 1;
    const handler = regArgs[handlerIndex] as ToolHandler;
    // Schema present iff any arg between the name and the handler is a
    // non-string object (the description, if present, is a string).
    const hasSchema = regArgs
      .slice(1, handlerIndex)
      .some((a) => typeof a === "object" && a !== null);

    const wrapped: ToolHandler = async (...callArgs: unknown[]) => {
      const toolArgs = hasSchema
        ? (truncate(callArgs[0] ?? {}) as Record<string, unknown>)
        : {};
      try {
        const result = await handler(...callArgs);
        await append(campaignPath, {
          ts: new Date().toISOString(),
          tool: name,
          args: toolArgs,
          result: result.isError ? undefined : extractResult(name, result.content),
          isError: result.isError === true,
        });
        return result;
      } catch (e) {
        await append(campaignPath, {
          ts: new Date().toISOString(),
          tool: name,
          args: toolArgs,
          isError: true,
        });
        throw e;
      }
    };

    regArgs[handlerIndex] = wrapped;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (original as any)(...regArgs);
  };
}
