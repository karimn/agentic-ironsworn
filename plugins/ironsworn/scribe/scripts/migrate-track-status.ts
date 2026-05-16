import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

interface MigrationResult {
  touched: number;
}

export async function migrateTrackStatus(campaignPath: string): Promise<MigrationResult> {
  const charPath = join(campaignPath, "character.json");
  if (!existsSync(charPath)) {
    throw new Error(`character.json not found at ${charPath}`);
  }
  const raw = readFileSync(charPath, "utf8");
  const character: { progressTracks: Record<string, unknown>[] } = JSON.parse(raw);

  let touched = 0;
  for (const track of character.progressTracks) {
    if ("status" in track && track.status !== undefined) {
      // already migrated
      continue;
    }
    track.status = track.completed === true ? "fulfilled" : "active";
    delete track.completed;
    touched++;
  }

  if (touched === 0) {
    return { touched };
  }

  // Atomic write: temp file + rename
  const tempPath = `${charPath}.migrate.tmp`;
  writeFileSync(tempPath, JSON.stringify(character, null, 2));
  renameSync(tempPath, charPath);
  console.log(`[migrate-track-status] migrated ${touched} track(s) in ${charPath}`);
  return { touched };
}

// CLI entry
if (import.meta.main) {
  const campaign = process.env.SCRIBE_CAMPAIGN;
  if (!campaign) {
    console.error("Set SCRIBE_CAMPAIGN to the campaign directory");
    process.exit(1);
  }
  await migrateTrackStatus(campaign);
}
