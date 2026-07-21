import type { ParsedTurn, TurnEvent } from "./transcript.js";

// Deterministic referee checks (#211). Hard checks key off structured facts
// (tool results present in the turn) and are eligible for blocking; soft
// checks are heuristics and are always log-only. Policy and rollout:
// docs/design/runtime-observability.md §6, §8.

export type ViolationKind =
  | "burn_gate_skipped"
  | "state_drift"
  | "phantom_roll"
  | "milestone_skip"
  | "beat_starvation"
  | "ungrounded_entity";

export interface Violation {
  kind: ViolationKind;
  severity: "hard" | "soft";
  /** Corrective instruction phrased for the agent (hard) or reviewer (soft). */
  detail: string;
  /** Short quote from the turn backing the finding. */
  evidence?: string;
}

/** Cross-turn state persisted by the CLI in <campaign>/.referee-state.json. */
export interface RefereeCursor {
  openScene?: { turnsWithoutBeat: number };
  /** Concatenated grounding text seen this session (capped, sliding). */
  knownText: string;
}

export function emptyCursor(): RefereeCursor {
  return { knownText: "" };
}

const KNOWN_TEXT_CAP = 40_000;
const BEAT_STARVATION_TURNS = 4;
const EVIDENCE_LEN = 120;

function quote(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > EVIDENCE_LEN ? `${collapsed.slice(0, EVIDENCE_LEN)}…` : collapsed;
}

function parseResult(event: TurnEvent): Record<string, unknown> | undefined {
  if (event.kind !== "tool_call" || event.resultText === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(event.resultText);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toolCalls(turn: ParsedTurn): Extract<TurnEvent, { kind: "tool_call" }>[] {
  return turn.events.filter(
    (e): e is Extract<TurnEvent, { kind: "tool_call" }> => e.kind === "tool_call",
  );
}

// ---------------------------------------------------------------------------
// Hard check — burn gate skipped
// ---------------------------------------------------------------------------

/** Text that presents the burn offer itself is not outcome narration. */
function looksLikeBurnOffer(text: string): boolean {
  return /burn/i.test(text) && /momentum/i.test(text);
}

export function checkBurnGateSkipped(turn: ParsedTurn): Violation[] {
  const violations: Violation[] = [];
  for (let i = 0; i < turn.events.length; i++) {
    const event = turn.events[i]!;
    if (event.kind !== "tool_call" || event.name !== "resolve_move") continue;
    const result = parseResult(event);
    if (result?.["burnOffered"] !== true) continue;
    if (result["momentumBurned"] === true) continue;
    if (event.input["burn_momentum"] === true) continue;

    for (let j = i + 1; j < turn.events.length; j++) {
      const later = turn.events[j]!;
      if (later.kind === "tool_call") {
        const isBurnDecision =
          later.name === "AskUserQuestion" ||
          later.name === "burn_momentum" ||
          (later.name === "resolve_move" && later.input["burn_momentum"] === true);
        if (isBurnDecision) break;
        continue;
      }
      if (looksLikeBurnOffer(later.text)) break; // offer presented in prose — turn will pause
      violations.push({
        kind: "burn_gate_skipped",
        severity: "hard",
        detail:
          "resolve_move returned burnOffered: true but outcome narration followed without a burn " +
          "decision. Present the burn offer (AskUserQuestion) and wait for the player before narrating.",
        evidence: quote(later.text),
      });
      break;
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Hard check — state drift
// ---------------------------------------------------------------------------

type Resource = "health" | "spirit" | "supply" | "momentum";

const MUTATION_TOOLS: Record<Resource, string[]> = {
  health: ["suffer_harm", "restore_health", "companion_suffer_harm", "companion_restore_health"],
  spirit: ["suffer_stress", "restore_spirit"],
  supply: ["suffer_supply", "restore_supply"],
  momentum: ["take_momentum", "lose_momentum", "burn_momentum"],
};

// Numeric claims only (digits, not spelled-out numbers): the blocking bar is
// near-zero false positives, and digit forms are how the GM prompt mandates
// mechanical changes be stated.
const DRIFT_PATTERNS: RegExp[] = [
  /[-−+]\s?\d+\s*(health|spirit|supply|momentum)\b/gi,
  /\b(?:lose|loses|lost|suffer|suffers|suffered|take|takes|took)\s+\d+\s+(?:points?\s+of\s+)?(health|spirit|supply|momentum)\b/gi,
  /\b(?:gain|gains|gained|restore|restores|restored|regain|regains|regained)\s+\d+\s+(?:points?\s+of\s+)?(health|spirit|supply|momentum)\b/gi,
];

export function checkStateDrift(turn: ParsedTurn): Violation[] {
  const calls = toolCalls(turn);
  const touched = new Set<Resource>();
  for (const call of calls) {
    for (const [resource, tools] of Object.entries(MUTATION_TOOLS) as [Resource, string[]][]) {
      if (tools.includes(call.name)) touched.add(resource);
    }
    // A momentum burn via resolve_move also moves momentum.
    if (call.name === "resolve_move" && (call.input["burn_momentum"] === true || parseResult(call)?.["momentumBurned"] === true)) {
      touched.add("momentum");
    }
  }

  const violations: Violation[] = [];
  const flagged = new Set<Resource>();
  for (const pattern of DRIFT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of turn.assistantText.matchAll(pattern)) {
      const resource = match[1]!.toLowerCase() as Resource;
      if (touched.has(resource) || flagged.has(resource)) continue;
      flagged.add(resource);
      violations.push({
        kind: "state_drift",
        severity: "hard",
        detail:
          `Narration states a ${resource} change ("${match[0]}") but no ${resource} mutation tool ` +
          `was called this turn. Call the matching tool (${MUTATION_TOOLS[resource].join(" / ")}) ` +
          "or correct the narration before ending the turn.",
        evidence: quote(match[0]),
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Hard check — phantom roll
// ---------------------------------------------------------------------------

const ROLL_TOOLS = ["resolve_move", "roll_progress", "roll_epilogue", "roll_dice"];
const BAND_RE = /\b(strong hit|weak hit|miss)\b/i;
const DICE_RE = /\b(?:action die|action score|challenge dice|challenge die|rolled|d6\b|d10\b)/i;

export function checkPhantomRoll(turn: ParsedTurn): Violation[] {
  const hasRoll = toolCalls(turn).some((c) => ROLL_TOOLS.includes(c.name));
  if (hasRoll) return [];
  const bandMatch = BAND_RE.exec(turn.assistantText);
  if (bandMatch === null || !DICE_RE.test(turn.assistantText)) return [];
  return [{
    kind: "phantom_roll",
    severity: "hard",
    detail:
      `Narration describes a dice outcome ("${bandMatch[0]}") but no roll tool was called this ` +
      "turn. Call resolve_move / roll_progress before narrating roll results, or remove the " +
      "dice language.",
    evidence: quote(turn.assistantText.slice(Math.max(0, bandMatch.index - 40), bandMatch.index + 80)),
  }];
}

// ---------------------------------------------------------------------------
// Soft check — milestone check possibly skipped
// ---------------------------------------------------------------------------

const PROGRESS_TOOLS = ["reach_milestone", "tick_progress", "create_progress_track", "fulfill_progress"];

export function checkMilestoneSkip(turn: ParsedTurn): Violation[] {
  const calls = toolCalls(turn);
  const hit = calls.find((c) => {
    if (c.name !== "resolve_move") return false;
    const band = parseResult(c)?.["band"];
    return band === "strong_hit" || band === "weak_hit";
  });
  if (hit === undefined) return [];
  if (calls.some((c) => PROGRESS_TOOLS.includes(c.name))) return [];
  const move = String(hit.input["move_name"] ?? "a move");
  return [{
    kind: "milestone_skip",
    severity: "soft",
    detail:
      `${move} resolved as a hit with no reach_milestone/tick_progress this turn. If the hit ` +
      "overcame an obstacle on an open vow or track, the milestone was missed (GM protocol step 4).",
  }];
}

// ---------------------------------------------------------------------------
// Soft checks with cross-turn cursor — beat starvation, ungrounded entity
// ---------------------------------------------------------------------------

const GROUNDING_TOOLS = [
  "recall", "search_lore", "search_lore_global", "get_lore", "get_npc", "list_npcs",
  "search_scenes", "search_beats", "get_scene", "session_briefing", "get_canon_briefing",
];
const ENTITY_WRITE_TOOLS = ["upsert_entity", "upsert_lore", "upsert_npc", "record_beat", "record_scene", "open_thread"];

/** Advance the cursor with this turn's scene/beat calls and grounding text. */
export function updateCursor(cursor: RefereeCursor, turn: ParsedTurn): RefereeCursor {
  const next: RefereeCursor = {
    openScene: cursor.openScene ? { ...cursor.openScene } : undefined,
    knownText: cursor.knownText,
  };

  const additions: string[] = [];
  for (const call of toolCalls(turn)) {
    if (call.name === "record_scene") next.openScene = { turnsWithoutBeat: 0 };
    else if (call.name === "record_beat" && next.openScene) next.openScene.turnsWithoutBeat = 0;
    else if (call.name === "update_scene") next.openScene = undefined;

    if (GROUNDING_TOOLS.includes(call.name) && call.resultText !== undefined) {
      additions.push(call.resultText);
    }
    if (ENTITY_WRITE_TOOLS.includes(call.name)) {
      additions.push(JSON.stringify(call.input));
    }
  }
  if (next.openScene !== undefined) next.openScene.turnsWithoutBeat += 1;

  if (additions.length > 0) {
    const combined = next.knownText + "\n" + additions.join("\n");
    next.knownText = combined.length > KNOWN_TEXT_CAP ? combined.slice(-KNOWN_TEXT_CAP) : combined;
  }
  return next;
}

export function checkBeatStarvation(cursorAfter: RefereeCursor): Violation[] {
  const turns = cursorAfter.openScene?.turnsWithoutBeat ?? 0;
  if (turns < BEAT_STARVATION_TURNS) return [];
  return [{
    kind: "beat_starvation",
    severity: "soft",
    detail:
      `An open scene has gone ${turns} turns without a record_beat call. Beats must be recorded ` +
      "in real time — an unbeaten scene is invisible to search_beats.",
  }];
}

// Names that are Ironsworn vocabulary, not world entities.
const NAME_BLOCKLIST = new Set([
  "Face Danger", "Secure an Advantage", "Gather Information", "Heal", "Resupply",
  "Make Camp", "Undertake a Journey", "Reach Your Destination", "Compel", "Sojourn",
  "Draw the Circle", "Forge a Bond", "Test Your Bond", "Aid Your Ally", "Write Your Epilogue",
  "Enter the Fray", "Strike", "Clash", "Turn the Tide", "End the Fight", "Battle",
  "Endure Harm", "Face Death", "Endure Stress", "Face Desolation", "Out of Supply",
  "Face a Setback", "Swear an Iron Vow", "Reach a Milestone", "Fulfill Your Vow",
  "Forsake Your Vow", "Advance", "Ask the Oracle", "Pay the Price",
  "Strong Hit", "Weak Hit", "Iron Vow", "Ironsworn", "Ironlands", "The Ironlands",
]);

const PROPER_NOUN_RE = /\b([A-Z][a-z]{2,}(?:\s+(?:of\s+|the\s+)?[A-Z][a-z]{2,})+)\b/g;

/**
 * Flag multi-word proper nouns in narration that appear in no grounding
 * result seen this session and were not introduced by this turn's own
 * entity writes. Heuristic — soft, permanently log-only.
 */
export function checkUngroundedEntity(turn: ParsedTurn, cursorAfter: RefereeCursor): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  PROPER_NOUN_RE.lastIndex = 0;
  for (const match of turn.assistantText.matchAll(PROPER_NOUN_RE)) {
    const name = match[1]!;
    if (seen.has(name) || NAME_BLOCKLIST.has(name)) continue;
    seen.add(name);
    if (cursorAfter.knownText.includes(name)) continue;
    violations.push({
      kind: "ungrounded_entity",
      severity: "soft",
      detail:
        `"${name}" appears in narration but in no recall/search_lore result this session. ` +
        "Possible ungrounded entity or name-collision risk (GM lore collision check).",
      evidence: name,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface CheckRun {
  violations: Violation[];
  cursor: RefereeCursor;
}

export function runChecks(turn: ParsedTurn, cursor: RefereeCursor): CheckRun {
  const cursorAfter = updateCursor(cursor, turn);
  const violations: Violation[] = [
    ...checkBurnGateSkipped(turn),
    ...checkStateDrift(turn),
    ...checkPhantomRoll(turn),
    ...checkMilestoneSkip(turn),
    ...checkBeatStarvation(cursorAfter),
    ...checkUngroundedEntity(turn, cursorAfter),
  ];
  return { violations, cursor: cursorAfter };
}
