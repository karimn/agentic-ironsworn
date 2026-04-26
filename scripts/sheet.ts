#!/usr/bin/env bun
/**
 * Display the current character sheet from disk. Zero tokens — pure JSON read.
 * Usage: bun run scripts/sheet.ts  (or ! bun run sheet from scribe/)
 * Respects SCRIBE_CAMPAIGN env var (default: campaigns/default).
 */

import { readFileSync } from "fs";
import { join } from "path";

// ── Load character ────────────────────────────────────────────────────────────
const repoRoot    = join(import.meta.dir, "..");
const campaignDir = process.env.SCRIBE_CAMPAIGN
  ? join(repoRoot, process.env.SCRIBE_CAMPAIGN)
  : join(repoRoot, "campaigns/default");

let char: any;
try {
  char = JSON.parse(readFileSync(join(campaignDir, "character.json"), "utf8"));
} catch {
  console.error(`No character found at ${campaignDir}/character.json`);
  process.exit(1);
}

const name: string     = char.name ?? "Unknown";
const stats            = char.stats ?? {};
const health: number   = char.health ?? 5;
const spirit: number   = char.spirit ?? 5;
const supply: number   = char.supply ?? 5;
const momentum: number      = char.momentum ?? 2;
const momentumReset: number = char.momentumReset ?? 2;
const bonds: number         = char.bonds ?? 0;
const assets: { name: string; abilities: boolean[] }[] = char.assets ?? [];
const tracks: { name: string; ticks: number }[]        = char.progressTracks ?? [];
const debilities: Record<string, boolean>              = char.debilities ?? {};
const activeDebs = Object.entries(debilities).filter(([, v]) => v).map(([k]) => k);

// ── Layout ────────────────────────────────────────────────────────────────────
// Total width 80: ║(1) + L(37) + ║(1) + R(40) + ║(1) = 80
const INN = 78;
const L   = 37;
const R   = 40;

const row   = (c: string) => `║${c.padEnd(INN)}║`;
const split = (lc: string, rc: string) => `║${lc.padEnd(L)}║${rc.padEnd(R)}║`;
const hfull = (tl: string, fill: string, tr: string) => `${tl}${"═".repeat(INN)}${tr}`;
const hsplit = (tl: string, fill: string, mid: string, tr: string) =>
  `${tl}${"═".repeat(L)}${mid}${"═".repeat(R)}${tr}`;

// ── Render helpers ────────────────────────────────────────────────────────────
const statDots = (val: number, max = 5) =>
  "●".repeat(Math.min(val, max)) + "○".repeat(Math.max(0, max - val));

const condBar = (val: number, max: number, width = 10) => {
  if (val <= 0) return "▄".repeat(Math.min(-val, width)) + "░".repeat(Math.max(0, width + val));
  const filled = Math.round((val / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
};

// ── Build ─────────────────────────────────────────────────────────────────────
const out: string[] = [];

// Header
const title    = name.toUpperCase().split("").join(" ");
const titlePad = Math.floor((INN - title.length) / 2);

out.push(hfull("╔", "═", "╗"));
out.push(row(""));
out.push(row(" ".repeat(titlePad) + title));
out.push(row(" ".repeat(titlePad + 1) + "─".repeat(title.length - 2)));
out.push(row(""));

// Stats | Condition
out.push(hsplit("╠", "═", "╦", "╣"));
out.push(split("  ATTRIBUTES", "  CONDITION"));
out.push(split("  " + "─".repeat(L - 4) + "  ", "  " + "─".repeat(R - 4) + "  "));

const STAT_NAMES = ["edge", "heart", "iron", "shadow", "wits"];
const COND_ROWS  = [
  { label: "Health",   val: health,   max: 5,  disp: `${health} / 5`   },
  { label: "Spirit",   val: spirit,   max: 5,  disp: `${spirit} / 5`   },
  { label: "Supply",   val: supply,   max: 5,  disp: `${supply} / 5`   },
  { label: "Momentum", val: momentum, max: 10, disp: `${momentum} / 10  ↺${momentumReset}` },
];

for (let i = 0; i < Math.max(STAT_NAMES.length, COND_ROWS.length); i++) {
  let lc = "", rc = "";

  if (i < STAT_NAMES.length) {
    const sn = STAT_NAMES[i]!;
    const sv = stats[sn] ?? 0;
    lc = `  ${(sn.charAt(0).toUpperCase() + sn.slice(1)).padEnd(10)}${statDots(sv)}  ${sv}`;
  }

  if (i < COND_ROWS.length) {
    const t = COND_ROWS[i]!;
    rc = `  ${t.label.padEnd(10)}${condBar(t.val, t.max)}  ${t.disp}`;
  }

  out.push(split(lc, rc));
}

// Debilities
if (activeDebs.length > 0) {
  out.push(hfull("╠", "═", "╣"));
  out.push(row(`  ⚠  DEBILITIES: ${activeDebs.join("  •  ")}`));
}

// Assets
out.push(hfull("╠", "═", "╣"));
out.push(row("  ASSETS"));
out.push(row("  " + "─".repeat(INN - 4) + "  "));
for (const asset of assets) {
  const pips = asset.abilities.map(a => a ? "◈" : "◇").join("  ");
  out.push(row(`  ${asset.name.padEnd(24)}  ${pips}`));
}

// Bonds
out.push(hfull("╠", "═", "╣"));
const bondPips = "◆".repeat(bonds) + "◇".repeat(Math.max(0, 10 - bonds));
out.push(row(`  BONDS  [${bonds}]  ${bondPips}`));

// Progress tracks
if (tracks.length > 0) {
  out.push(hfull("╠", "═", "╣"));
  out.push(row("  VOWS & PROGRESS"));
  out.push(row("  " + "─".repeat(INN - 4) + "  "));
  for (const t of tracks) {
    const boxes   = Math.floor(t.ticks / 4);
    const partial = t.ticks % 4;
    const pChar   = partial >= 3 ? "▓" : partial >= 1 ? "▒" : "";
    const bar     = "█".repeat(boxes) + pChar + "░".repeat(Math.max(0, 10 - boxes - (pChar ? 1 : 0)));
    const pct     = `${Math.floor((t.ticks / 40) * 100)}%`;
    out.push(row(`  ${t.name.padEnd(28)} ${bar}  ${pct}`));
  }
}

// Footer
out.push(hfull("╚", "═", "╝"));

for (const line of out) console.log(line);
