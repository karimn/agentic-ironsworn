import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function npcFilePath(campaignPath: string, name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return join(campaignPath, "npcs", `${sanitized}.md`);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getNpc(
  campaignPath: string,
  name: string,
): Promise<string | null> {
  try {
    return await readFile(npcFilePath(campaignPath, name), "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

export async function upsertNpc(
  campaignPath: string,
  name: string,
  description?: string,
  impression?: string,
): Promise<void> {
  const filePath = npcFilePath(campaignPath, name);
  const timestamp = new Date().toISOString();
  const desc = description ?? "(none)";
  const imp = impression ?? "(none)";

  const existing = await getNpc(campaignPath, name);

  if (existing === null) {
    // Create new file
    const content = `# ${name}\n\n## ${timestamp}\n\n**Description:** ${desc}\n**Impression:** ${imp}\n`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  } else {
    // Append new section
    const section = `\n## ${timestamp}\n\n**Description:** ${desc}\n**Impression:** ${imp}\n`;
    await writeFile(filePath, existing + section, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Export (filename → raw markdown content)
// ---------------------------------------------------------------------------

export async function listNpcs(
  campaignPath: string,
): Promise<Record<string, string>> {
  const npcsDir = join(campaignPath, "npcs");
  try {
    const files = await readdir(npcsDir);
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => [f, await readFile(join(npcsDir, f), "utf-8")] as const),
    );
    return Object.fromEntries(entries);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Import (write raw markdown files)
// ---------------------------------------------------------------------------

export async function writeNpcRaw(
  campaignPath: string,
  filename: string,
  content: string,
): Promise<void> {
  const filePath = join(campaignPath, "npcs", filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}
