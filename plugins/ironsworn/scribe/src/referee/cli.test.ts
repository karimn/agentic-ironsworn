import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  userMsg,
  assistantText,
  assistantToolUse,
  toolResult,
  transcript,
} from "./fixtures.js";

const CLI = join(import.meta.dir, "cli.ts");
const SCRIBE = "mcp__plugin_ironsworn_scribe__";

let campaignDir: string;
let transcriptPath: string;

beforeEach(async () => {
  campaignDir = await mkdtemp(join(tmpdir(), "scribe-referee-cli-test-"));
  await writeFile(join(campaignDir, "character.json"), JSON.stringify({ name: "Kara" }));
  transcriptPath = join(campaignDir, "transcript.jsonl");
});

afterEach(async () => {
  await rm(campaignDir, { recursive: true, force: true });
});

interface RunResult {
  exitCode: number;
  stdout: string;
}

async function runCli(
  payload: object,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SCRIBE_CAMPAIGN: campaignDir, ...env },
  });
  const exitCode = await proc.exited;
  return { exitCode, stdout: await new Response(proc.stdout).text() };
}

const DRIFT_TURN = transcript(
  userMsg("I climb."),
  assistantText("The rocks bite deep. You lose 2 health as you haul yourself up."),
);

const CLEAN_TURN = transcript(
  userMsg("I climb."),
  assistantToolUse("t1", `${SCRIBE}resolve_move`, { move_name: "Face Danger", stat: "iron" }),
  toolResult("t1", { band: "strong_hit", burnOffered: false }),
  assistantToolUse("t2", `${SCRIBE}tick_progress`, { track_name: "Journey", ticks: 2 }),
  toolResult("t2", { ok: true }),
  assistantText("You haul yourself over the lip of the cliff."),
);

describe("referee cli", () => {
  it("log mode: records the violation to the spill file but exits 0", async () => {
    await writeFile(transcriptPath, DRIFT_TURN);
    const result = await runCli(
      { session_id: "s1", transcript_path: transcriptPath, cwd: campaignDir },
      { SCRIBE_REFEREE_MODE: "log" },
    );
    expect(result.exitCode).toBe(0);

    const spill = await readFile(join(campaignDir, "observations-spill.jsonl"), "utf-8");
    const entries = spill.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const drift = entries.find((e) => e["kind"] === "state_drift");
    expect(drift).toBeDefined();
    expect(drift!["severity"]).toBe("hard");
    expect(drift!["blocked"]).toBe(false);
    expect(drift!["turnRef"]).toBe("s1:2");
  });

  it("enforce mode: blocks with a corrective reason on a hard violation", async () => {
    await writeFile(transcriptPath, DRIFT_TURN);
    const result = await runCli(
      { session_id: "s1", transcript_path: transcriptPath, cwd: campaignDir },
      { SCRIBE_REFEREE_MODE: "enforce" },
    );
    expect(result.exitCode).toBe(2);
    const decision = JSON.parse(result.stdout) as { decision: string; reason: string };
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("state_drift");
    expect(decision.reason).toContain("suffer_harm");

    const spill = await readFile(join(campaignDir, "observations-spill.jsonl"), "utf-8");
    const drift = JSON.parse(spill.trim().split("\n")[0]!) as Record<string, unknown>;
    expect(drift["blocked"]).toBe(true);
  });

  it("enforce mode: never blocks twice — stop_hook_active runs log-only", async () => {
    await writeFile(transcriptPath, DRIFT_TURN);
    const result = await runCli(
      {
        session_id: "s1",
        transcript_path: transcriptPath,
        cwd: campaignDir,
        stop_hook_active: true,
      },
      { SCRIBE_REFEREE_MODE: "enforce" },
    );
    expect(result.exitCode).toBe(0);
  });

  it("exits 0 on a clean turn and persists the cursor across runs", async () => {
    await writeFile(transcriptPath, CLEAN_TURN);
    const result = await runCli(
      { session_id: "s1", transcript_path: transcriptPath, cwd: campaignDir },
      { SCRIBE_REFEREE_MODE: "enforce" },
    );
    expect(result.exitCode).toBe(0);

    const statePath = join(campaignDir, ".referee-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(await readFile(statePath, "utf-8")) as {
      transcriptPath: string;
      cursor: { knownText: string };
    };
    expect(state.transcriptPath).toBe(transcriptPath);
  });

  it("off mode and non-campaign sessions exit 0 without touching anything", async () => {
    await writeFile(transcriptPath, DRIFT_TURN);
    const off = await runCli(
      { session_id: "s1", transcript_path: transcriptPath, cwd: campaignDir },
      { SCRIBE_REFEREE_MODE: "off" },
    );
    expect(off.exitCode).toBe(0);
    expect(existsSync(join(campaignDir, "observations-spill.jsonl"))).toBe(false);

    // No character.json → not a play session, even with SCRIBE_CAMPAIGN set.
    const emptyDir = await mkdtemp(join(tmpdir(), "scribe-referee-nonplay-"));
    try {
      const nonPlay = await runCli(
        { session_id: "s1", transcript_path: transcriptPath, cwd: emptyDir },
        { SCRIBE_REFEREE_MODE: "enforce", SCRIBE_CAMPAIGN: emptyDir },
      );
      expect(nonPlay.exitCode).toBe(0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("fails open on a garbage payload", async () => {
    const proc = Bun.spawn(["bun", "run", CLI], {
      stdin: new TextEncoder().encode("not json"),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SCRIBE_REFEREE_MODE: "enforce" },
    });
    expect(await proc.exited).toBe(0);
  });

  it("discovers the campaign from .mcp.json when SCRIBE_CAMPAIGN is unset", async () => {
    await writeFile(transcriptPath, DRIFT_TURN);
    await writeFile(
      join(campaignDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { scribe: { command: "bun", env: { SCRIBE_CAMPAIGN: campaignDir } } },
      }),
    );
    const proc = Bun.spawn(["bun", "run", CLI], {
      stdin: new TextEncoder().encode(JSON.stringify({
        session_id: "s1", transcript_path: transcriptPath, cwd: campaignDir,
      })),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SCRIBE_CAMPAIGN: "", SCRIBE_REFEREE_MODE: "enforce" },
    });
    expect(await proc.exited).toBe(2);
  });
});
