# GM Complication Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the GM agent from gravitating toward a single theme for all complications by introducing a complication-theme tracking field, a retrieval tool, and prompt-level diversity guidance.

**Architecture:** Scenes gain an optional `complication_theme` column. A new `get_recent_complications` tool queries this column sorted by recency. The GM agent prompt adds a Complication Diversity Protocol that uses the tool before narrating any miss.

**Tech Stack:** TypeScript, DuckDB (scenes store), Bun test runner, Zod schemas, MCP server tool registration

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `plugins/ironsworn/scribe/src/rag/scenes.ts` | Add `complication_theme` column, update `recordScene` signature, add `getRecentComplications` query, update `Scene`/`SceneExport` types |
| Modify | `plugins/ironsworn/scribe/src/tools/narrative.ts` | Update `record_scene` tool schema to accept `complication_theme` |
| Modify | `plugins/ironsworn/scribe/src/tools/read.ts` | Register `get_recent_complications` tool |
| Modify | `plugins/ironsworn/scribe/src/rag/scenes.test.ts` | Add tests for `getRecentComplications` |
| Modify | `plugins/ironsworn/agents/ironsworn-gm.md` | Add Complication Diversity Protocol and Complication Palette |
| Modify | `plugins/ironsworn/skills/ironsworn-journey/SKILL.md` | Add cross-reference to Complication Diversity Protocol |

---

### Task 1: Add `complication_theme` Column to Scene Store

**Files:**
- Modify: `plugins/ironsworn/scribe/src/rag/scenes.ts`

- [ ] **Step 1: Write the failing test**

Create test in `plugins/ironsworn/scribe/src/rag/scenes.test.ts`:

```typescript
import { recordScene, searchScenes, getRecentComplications } from "./scenes.js";

// ... (existing imports and setup remain unchanged)

describe("getRecentComplications", () => {
  it("returns only scenes with complication_theme set", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Wolves attacked at the river ford.", "exploration", "beasts");
    await recordScene(campaignDir, "The village elder greeted them warmly.", "social");
    await recordScene(campaignDir, "A blizzard rolled in without warning.", "exploration", "weather");
    const results = await getRecentComplications(campaignDir, 5);
    expect(results).toHaveLength(2);
    expect(results[0].complication_theme).toBe("weather");
    expect(results[1].complication_theme).toBe("beasts");
  });

  it("returns empty array when no complications recorded", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "A quiet day of travel.", "exploration");
    const results = await getRecentComplications(campaignDir, 5);
    expect(results).toEqual([]);
  });

  it("respects the k limit", async () => {
    if (!(await ollamaAvailable())) return;
    await recordScene(campaignDir, "Wolves attacked.", "exploration", "beasts");
    await recordScene(campaignDir, "Bridge collapsed.", "exploration", "physical-hazard");
    await recordScene(campaignDir, "Blizzard hit.", "exploration", "weather");
    const results = await getRecentComplications(campaignDir, 2);
    expect(results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/ironsworn/scribe && bun test src/rag/scenes.test.ts`

Expected: FAIL — `getRecentComplications` is not exported from `./scenes.js`, and `recordScene` does not accept a 4th argument.

- [ ] **Step 3: Update the `Scene` and `SceneExport` types**

In `plugins/ironsworn/scribe/src/rag/scenes.ts`, update the types:

```typescript
export interface Scene {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
  score?: number;
}

export interface SceneExport {
  id: string;
  text: string;
  timestamp: string;
  kind: string;
  complication_theme?: string;
}
```

- [ ] **Step 4: Add `complication_theme` column to the schema**

In `initDb`, update the `CREATE TABLE` statement:

```typescript
await conn.run(`
  CREATE TABLE IF NOT EXISTS scenes (
    id                 TEXT PRIMARY KEY,
    text               TEXT NOT NULL,
    embedding          FLOAT[768] NOT NULL,
    timestamp          TEXT NOT NULL,
    kind               TEXT NOT NULL DEFAULT 'scene',
    complication_theme TEXT
  )
`);
```

- [ ] **Step 5: Update `recordScene` to accept and persist `complication_theme`**

```typescript
export async function recordScene(
  campaignPath: string,
  summary: string,
  kind?: string,
  complicationTheme?: string,
): Promise<void> {
  const [embedding, instance] = await Promise.all([
    getEmbedding(summary),
    getDb(campaignPath),
  ]);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sceneKind = kind ?? "scene";

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme)
       VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?)`,
      [id, summary, timestamp, sceneKind, complicationTheme ?? null],
    );
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 6: Update `exportScenes` to include `complication_theme`**

```typescript
export async function exportScenes(campaignPath: string): Promise<SceneExport[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const rows = (
      await conn.runAndReadAll(
        `SELECT id, text, timestamp, kind, complication_theme FROM scenes ORDER BY timestamp`,
      )
    ).getRowObjectsJS() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      text: String(r["text"]),
      timestamp: String(r["timestamp"]),
      kind: String(r["kind"]),
      complication_theme: r["complication_theme"] != null ? String(r["complication_theme"]) : undefined,
    }));
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 7: Update `importScene` to accept `complication_theme`**

```typescript
export async function importScene(
  campaignPath: string,
  id: string,
  text: string,
  timestamp: string,
  kind: string,
  complicationTheme?: string,
): Promise<boolean> {
  const instance = await getDb(campaignPath);

  const checkConn = await instance.connect();
  let exists = false;
  try {
    const rows = (
      await checkConn.runAndReadAll(`SELECT id FROM scenes WHERE id = ?`, [id])
    ).getRowObjectsJS() as unknown[];
    exists = rows.length > 0;
  } finally {
    checkConn.closeSync();
  }
  if (exists) return false;

  const [embedding] = await Promise.all([getEmbedding(text)]);
  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await openWriteConn(instance);
  try {
    await conn.run(
      `INSERT INTO scenes (id, text, embedding, timestamp, kind, complication_theme) VALUES (?, ?, ${embeddingLiteral}, ?, ?, ?)`,
      [id, text, timestamp, kind, complicationTheme ?? null],
    );
    return true;
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 8: Add `searchScenes` return of `complication_theme`**

Update the `searchScenes` SQL and mapper:

```typescript
export async function searchScenes(
  campaignPath: string,
  query: string,
  k?: number,
): Promise<Scene[]> {
  const limit = k ?? 5;

  const [embedding, instance] = await Promise.all([
    getEmbedding(query),
    getDb(campaignPath),
  ]);

  const embeddingLiteral = `[${embedding.join(",")}]::FLOAT[768]`;

  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT id, text, timestamp, kind, complication_theme,
              array_cosine_similarity(embedding, ${embeddingLiteral}) AS score
       FROM scenes
       ORDER BY score DESC
       LIMIT ?`,
      [limit],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row["id"] ?? ""),
      text: String(row["text"] ?? ""),
      timestamp: String(row["timestamp"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      complication_theme: row["complication_theme"] != null ? String(row["complication_theme"]) : undefined,
      score:
        typeof row["score"] === "number"
          ? row["score"]
          : typeof row["score"] === "bigint"
            ? Number(row["score"])
            : undefined,
    }));
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 9: Implement `getRecentComplications`**

Add after `searchScenes` in `scenes.ts`:

```typescript
export interface ComplicationScene {
  summary: string;
  complication_theme: string;
  kind: string;
  timestamp: string;
}

export async function getRecentComplications(
  campaignPath: string,
  k: number = 5,
): Promise<ComplicationScene[]> {
  const instance = await getDb(campaignPath);
  const conn = await instance.connect();
  try {
    const result = await conn.runAndReadAll(
      `SELECT text, complication_theme, kind, timestamp
       FROM scenes
       WHERE complication_theme IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT ?`,
      [k],
    );

    const rows = result.getRowObjectsJS() as Record<string, unknown>[];

    return rows.map((row) => ({
      summary: String(row["text"] ?? ""),
      complication_theme: String(row["complication_theme"] ?? ""),
      kind: String(row["kind"] ?? "scene"),
      timestamp: String(row["timestamp"] ?? ""),
    }));
  } finally {
    conn.closeSync();
  }
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd plugins/ironsworn/scribe && bun test src/rag/scenes.test.ts`

Expected: PASS (all tests, including new `getRecentComplications` tests)

- [ ] **Step 11: Run typecheck**

Run: `cd plugins/ironsworn/scribe && bun run typecheck`

Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add plugins/ironsworn/scribe/src/rag/scenes.ts plugins/ironsworn/scribe/src/rag/scenes.test.ts
git commit -m "feat(scribe): add complication_theme column and getRecentComplications query (#25)"
```

---

### Task 2: Update `record_scene` Tool Schema

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/narrative.ts`

- [ ] **Step 1: Add `complication_theme` parameter to `record_scene` tool**

In the `record_scene` tool registration, add the new parameter to the schema object:

```typescript
complication_theme: z.string().optional().describe(
  "Freeform thematic category of the complication (e.g. 'weather', 'beasts', 'fungal-network', 'physical-hazard'). Set only when the scene involves a miss/complication."
),
```

- [ ] **Step 2: Pass `complication_theme` through to `recordScene`**

Update the handler to pass the new field:

```typescript
async ({ summary, kind, npcs, lore_ids, complication_theme }) => {
  try {
    await recordScene(campaignPath, summary, kind, complication_theme);
    recordMutation(campaignPath);
    const warnings = await buildSceneWarnings(campaignPath, npcs, lore_ids);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, warnings }) }],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
},
```

- [ ] **Step 3: Run typecheck**

Run: `cd plugins/ironsworn/scribe && bun run typecheck`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/narrative.ts
git commit -m "feat(scribe): accept complication_theme in record_scene tool (#25)"
```

---

### Task 3: Register `get_recent_complications` Tool

**Files:**
- Modify: `plugins/ironsworn/scribe/src/tools/read.ts`

- [ ] **Step 1: Add the tool registration**

At the top of `read.ts`, add the import:

```typescript
import { searchScenes, getRecentComplications } from "../rag/scenes.js";
```

(Replace the existing `import { searchScenes } from "../rag/scenes.js";` line.)

Then add the tool registration at the end of the `register` function (before the closing `}`):

```typescript
server.tool(
  "get_recent_complications",
  "Retrieve recent scenes tagged with a complication theme, ordered newest-first. Use before narrating a new complication to check for thematic repetition.",
  {
    k: z.coerce.number().int().positive().optional().describe("Number of recent complications to return (default 5)"),
  },
  async ({ k }) => {
    try {
      const results = await getRecentComplications(campaignPath, k ?? 5);
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);
```

- [ ] **Step 2: Run typecheck**

Run: `cd plugins/ironsworn/scribe && bun run typecheck`

Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `cd plugins/ironsworn/scribe && bun test`

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add plugins/ironsworn/scribe/src/tools/read.ts
git commit -m "feat(scribe): register get_recent_complications tool (#25)"
```

---

### Task 4: Update GM Agent Prompt

**Files:**
- Modify: `plugins/ironsworn/agents/ironsworn-gm.md`

- [ ] **Step 1: Add Complication Diversity Protocol section**

Insert after the "### Oracle Interpretation" section (after line 110), before "## Starting a Campaign":

```markdown
### Complication Diversity Protocol

Before narrating ANY miss or Pay the Price outcome, follow this protocol:

1. **Check recent history** — Call `get_recent_complications` (k=5). Note which `complication_theme` values appear, especially any that repeat.
2. **Choose a different category** — Pick a thematic category that has NOT dominated the recent complications. Use the Complication Palette below for inspiration.
3. **Exception** — If the fiction genuinely demands the same theme (the character is literally inside the threat's domain), it's allowed — but find a fresh angle within that theme.
4. **Tag the scene** — After narrating, call `record_scene` with `complication_theme` set to the category you chose.

### Complication Palette

Non-exhaustive thematic levers to draw from:

- **Weather / cold / exhaustion** — the land itself as antagonist
- **Beasts / wildlife** — natural or corrupted
- **Supernatural threats** — whatever darkness the world truths established
- **Political / factional tension** — rival settlements, power struggles
- **Ancient infrastructure** — ruins, old roads, unstable structures
- **Plain physical hazard** — injury, terrain, structural collapse
- **Interpersonal / social friction** — mistrust, conflicting goals, old grudges
- **Supply / resource scarcity**
- **Isolation / disorientation** — lost, cut off, no help coming

This list is not closed. Pull from your campaign's world truths to discover categories specific to this setting — but rotate among them.
```

- [ ] **Step 2: Verify the file is well-formed**

Read through the edited file to ensure no formatting issues.

- [ ] **Step 3: Commit**

```bash
git add plugins/ironsworn/agents/ironsworn-gm.md
git commit -m "feat(gm): add Complication Diversity Protocol and Palette (#25)"
```

---

### Task 5: Update Journey Skill Cross-Reference

**Files:**
- Modify: `plugins/ironsworn/skills/ironsworn-journey/SKILL.md`

- [ ] **Step 1: Add diversity protocol reminder**

In the "On a miss — Pay the Price" section (after line 85, after "Mix the two modes across a long journey..."), add:

```markdown
**Complication Diversity:** Before narrating the complication, follow the Complication Diversity Protocol defined in the GM agent — call `get_recent_complications` and choose a theme that hasn't dominated recent play.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/ironsworn/skills/ironsworn-journey/SKILL.md
git commit -m "feat(journey): cross-reference Complication Diversity Protocol (#25)"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `cd plugins/ironsworn/scribe && bun run typecheck`

Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `cd plugins/ironsworn/scribe && bun test`

Expected: All tests pass

- [ ] **Step 3: Verify no untracked files or missed changes**

Run: `git status`

Expected: Clean working tree
