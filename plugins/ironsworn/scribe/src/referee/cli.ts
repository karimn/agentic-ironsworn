// Referee Stop-hook CLI (#211).
//
// Reads the Claude Code Stop-hook payload from stdin, extracts the
// just-finished turn from the transcript, runs the deterministic checks,
// spills violations to <campaign>/observations-spill.jsonl (the scribe
// replays them into world.duckdb at startup — the hook must not touch the
// DB while the server holds the write lock), and — in enforce mode — blocks
// with a corrective reason on hard violations.
//
// Exit codes: 0 = allow (including every failure path — fail-open),
// 2 = block (JSON decision on stdout; the shell wrapper relays it).
//
// Deliberately imports only ./transcript.js and ./checks.js: no core
// barrel, no DuckDB bindings — hook startup must stay fast.

import { readFileSync } from "node:fs";
import { readFile, writeFile, appendFile, access } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { extractLastTurn } from "./transcript.js";
import { runChecks, emptyCursor, type RefereeCursor, type Violation } from "./checks.js";

const STATE_FILENAME = ".referee-state.json";
// Format contract mirrored by replayObservationSpill in @agentic-rpg/core.
const SPILL_FILENAME = "observations-spill.jsonl";
const MAX_BLOCK_REASONS = 2;

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

interface RefereeState {
  transcriptPath: string;
  cursor: RefereeCursor;
}

type Mode = "off" | "log" | "enforce";

function refereeMode(): Mode {
  const raw = (process.env["SCRIBE_REFEREE_MODE"] ?? "log").toLowerCase();
  return raw === "off" || raw === "enforce" ? raw : "log";
}

/**
 * Locate the active campaign. The hook process does not inherit the MCP
 * server's env, so SCRIBE_CAMPAIGN is usually absent here — fall back to
 * parsing .mcp.json in the session cwd (where ironsworn-init wires the
 * scribe server) and reading its SCRIBE_CAMPAIGN.
 */
async function findCampaignPath(cwd: string): Promise<string | undefined> {
  const fromEnv = process.env["SCRIBE_CAMPAIGN"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(cwd, fromEnv);
  }
  try {
    const raw = await readFile(join(cwd, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: Record<string, string> }>;
    };
    for (const server of Object.values(parsed.mcpServers ?? {})) {
      const campaign = server.env?.["SCRIBE_CAMPAIGN"];
      if (campaign !== undefined && campaign.length > 0) {
        return isAbsolute(campaign) ? campaign : resolve(cwd, campaign);
      }
    }
  } catch {
    // no .mcp.json or unparseable — not a play session
  }
  return undefined;
}

async function loadState(campaignPath: string, transcriptPath: string): Promise<RefereeCursor> {
  try {
    const raw = await readFile(join(campaignPath, STATE_FILENAME), "utf-8");
    const state = JSON.parse(raw) as RefereeState;
    // A different transcript means a new session: grounding cache resets.
    if (state.transcriptPath === transcriptPath && state.cursor !== undefined) {
      return { knownText: state.cursor.knownText ?? "", openScene: state.cursor.openScene };
    }
  } catch {
    // missing or corrupt cursor — restart from the current turn, never error
  }
  return emptyCursor();
}

async function saveState(
  campaignPath: string,
  transcriptPath: string,
  cursor: RefereeCursor,
): Promise<void> {
  const state: RefereeState = { transcriptPath, cursor };
  await writeFile(join(campaignPath, STATE_FILENAME), JSON.stringify(state), "utf-8");
}

async function spillObservations(
  campaignPath: string,
  sessionId: string,
  startLine: number,
  violations: Violation[],
  blockedHard: boolean,
): Promise<void> {
  if (violations.length === 0) return;
  const ts = new Date().toISOString();
  const lines = violations.map((v) =>
    JSON.stringify({
      ts,
      source: "referee",
      severity: v.severity,
      kind: v.kind,
      detail: v.evidence !== undefined ? `${v.detail} Evidence: "${v.evidence}"` : v.detail,
      turnRef: `${sessionId}:${startLine}`,
      blocked: blockedHard && v.severity === "hard",
    }),
  );
  await appendFile(join(campaignPath, SPILL_FILENAME), lines.join("\n") + "\n", "utf-8");
}

async function main(): Promise<number> {
  const mode = refereeMode();
  if (mode === "off") return 0;

  const payload = JSON.parse(readFileSync(0, "utf-8")) as HookPayload;
  const transcriptPath = payload.transcript_path;
  if (transcriptPath === undefined) return 0;
  await access(transcriptPath);

  const cwd = payload.cwd ?? process.cwd();
  const campaignPath = await findCampaignPath(cwd);
  if (campaignPath === undefined) return 0;
  // Play-session guard: a campaign folder always has character.json.
  await access(join(campaignPath, "character.json"));

  const cursor = await loadState(campaignPath, transcriptPath);
  const turn = extractLastTurn(await readFile(transcriptPath, "utf-8"));
  const { violations, cursor: nextCursor } = runChecks(turn, cursor);

  const hard = violations.filter((v) => v.severity === "hard");
  const willBlock =
    mode === "enforce" &&
    hard.length > 0 &&
    payload.stop_hook_active !== true && // at most one block per turn
    !turn.noHumanBoundary; // post-compaction head: never block on partial context

  await spillObservations(
    campaignPath,
    payload.session_id ?? "unknown-session",
    turn.startLine,
    violations,
    willBlock,
  );
  await saveState(campaignPath, transcriptPath, nextCursor);

  if (willBlock) {
    const reason = hard
      .slice(0, MAX_BLOCK_REASONS)
      .map((v) => `[referee:${v.kind}] ${v.detail}`)
      .join(" ");
    process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
    return 2;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // Fail-open: a referee crash must never block play.
    process.stderr.write(`[referee] ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(0);
  });
