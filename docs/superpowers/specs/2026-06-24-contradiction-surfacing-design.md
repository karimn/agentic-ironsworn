# Contradiction Surfacing — Design Spec

**Date:** 2026-06-24
**Status:** Approved — ready for implementation planning
**Companion to:** `docs/design/agentic-rpg-v1.md` (priority #4)

## What we're building

Write-time contradiction detection on `upsertLore` and `linkLore`. When a
write would introduce a fact that conflicts with existing canon, flag it and
persist the flag — don't reject the write. The flag is returned inline in the
tool response and stored in a `contradictions` table for the canonize ritual
to adjudicate later.

Two contradiction kinds are detected:

- **`entity_summary_divergence`** — an entity update whose incoming summary
  has cosine similarity < 0.72 against the stored summary embedding. Catches
  "same name, very different description," which usually means two distinct
  real-world things sharing an identifier.
- **`relation_label_conflict`** — a new A→B relation is inserted while an
  active A→B relation with a **different** label already exists and `supersedes`
  was not declared. Catches undeclared supersession — the most common
  coherence failure mode after temporal recall.

## Non-goals

- Semantic relation conflict detection (LLM similarity check on relation
  meaning). Structural is sufficient and avoids an LLM call at write time.
- Blocking writes. Contradictions are surfaced, not rejected.
- Changes to `extract_session_lore`. It calls `upsertLore`/`linkLore`
  internally; flags are recorded automatically without extraction-layer changes.
- Eval harness changes. Contradiction flags don't affect extraction scores.

## Data model

### New `contradictions` table

Added to `world-db.ts` `initDb` (fresh installs) and as a new DB migration.

```sql
CREATE TABLE IF NOT EXISTS contradictions (
  id                      TEXT PRIMARY KEY,
  kind                    TEXT NOT NULL,  -- 'entity_summary_divergence' | 'relation_label_conflict'
  entity_id               TEXT,           -- set for entity kind
  relation_id             TEXT,           -- set for relation kind (the NEW relation)
  conflicting_relation_id TEXT,           -- set for relation kind (the EXISTING conflicting one)
  existing_value          TEXT NOT NULL,  -- existing summary  |  existing relation label
  incoming_value          TEXT NOT NULL,  -- incoming summary  |  new relation label
  similarity              REAL,           -- cosine sim (entity kind only)
  campaign_id             TEXT,
  created_at              TEXT NOT NULL,
  resolved_at             TEXT,
  resolution              TEXT
)
```

### `ContradictionFlag` interface

```ts
export interface ContradictionFlag {
  id: string;
  kind: 'entity_summary_divergence' | 'relation_label_conflict';
  entity_id?: string;
  relation_id?: string;
  conflicting_relation_id?: string;
  existing_value: string;
  incoming_value: string;
  similarity?: number;
  campaign_id: string | null;
  created_at: string;
  resolved_at?: string;
  resolution?: string;
}
```

### Detection threshold

```ts
const ENTITY_CONTRADICTION_THRESHOLD = 0.72;
```

Below this cosine similarity between old and new summary embeddings, the entity
update is flagged. The dedup threshold in extraction is 0.85 (same-entity
check); 0.72 is deliberately lower — it targets genuinely divergent
descriptions, not incremental updates.

## Module structure

### New file: `packages/core/src/rag/contradictions.ts`

Owns all contradiction logic. Exported functions:

```ts
// Called from inside upsertLore with the already-open write conn.
// Computes cosine similarity inline (pure arithmetic — the new embedding
// is already in hand from the upsert). Fetches existing embedding from DB.
// Inserts into contradictions if sim < threshold; returns flag or null.
export async function checkEntityContradiction(
  conn: DuckDBConnection,
  input: {
    entityId: string;
    newEmbedding: number[];
    existingSummary: string;
    incomingSummary: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null>

// Called from inside linkLore with the already-open write conn,
// AFTER the new relation row is inserted (so relation_id is known).
// SELECT active relations WHERE from=fromId AND to=toId AND label != newLabel
// AND invalid_at IS NULL. Inserts a flag for each conflict found;
// returns the first flag or null.
export async function checkRelationContradiction(
  conn: DuckDBConnection,
  input: {
    fromId: string;
    toId: string;
    newLabel: string;
    newRelationId: string;
    campaignId: string;
  },
): Promise<ContradictionFlag | null>

// MCP tool backing — manages its own connection.
export async function listContradictions(
  campaignPath: string,
  opts?: { includeResolved?: boolean; limit?: number },
): Promise<ContradictionFlag[]>

// MCP tool backing — manages its own connection.
export async function resolveContradiction(
  campaignPath: string,
  id: string,
  resolution?: string,
): Promise<void>
```

### Changes to `upsertLore` (`packages/core/src/rag/lore.ts`)

**Update path only** (`existingRow !== null`):

1. `resolveExisting` return type gains `summary: string` (SELECT already touches
   the row; one extra column, zero extra queries).
2. After confirming it's an update and before the `UPDATE` statement: call
   `checkEntityContradiction(conn, { entityId, newEmbedding, existingSummary: existingRow.summary, incomingSummary: input.summary, campaignId })`.
3. Stash the returned flag (may be null).
4. Include `contradiction?: ContradictionFlag` in the return value.

`UpsertLoreResult` becomes:

```ts
export interface UpsertLoreResult {
  id: string;
  slug: string;
  canonical: string;
  aliases: string[];
  updated: boolean;
  contradiction?: ContradictionFlag;
}
```

### Changes to `linkLore` (`packages/core/src/rag/lore.ts`)

**Insert path only** (`existingRows.length === 0`):

After the `INSERT INTO relations` succeeds: call
`checkRelationContradiction(conn, { fromId, toId, newLabel: input.relation, newRelationId: relationId, campaignId: ctx.campaignId })`.

Return type gains `contradiction?: ContradictionFlag`:

```ts
// linkLore return type
{ from_id: string; to_id: string; relation: string; relation_id: string; contradiction?: ContradictionFlag }
```

## MCP tool surface

Two new tools registered in `plugins/ironsworn/scribe/src/tools/lore.ts`:

### `list_contradictions`

```
List open (unresolved) contradiction flags raised at write time.
Call before canonize to see what needs adjudication.
```

Parameters:
- `include_resolved?: boolean` — include already-resolved flags (default false)
- `limit?: number` — max results, 1–100, default 20

### `resolve_contradiction`

```
Mark a contradiction flag as resolved.
Call after adjudicating — e.g. after canonizing the correct version
or confirming the two facts genuinely coexist.
```

Parameters:
- `id: string` — UUID of the contradiction flag
- `resolution?: string` — optional note on how it was resolved

### Inline response changes

`upsert_entity` response JSON gains an optional `contradiction` key:

```json
{
  "id": "...", "slug": "...", "canonical": "...", "aliases": [], "updated": true,
  "contradiction": {
    "kind": "entity_summary_divergence",
    "id": "...",
    "existing_value": "Lona is a healer from Caldren...",
    "incoming_value": "Lona is a blacksmith from the capital...",
    "similarity": 0.61
  }
}
```

`link` response JSON gains an optional `contradiction` key:

```json
{
  "from_id": "...", "to_id": "...", "relation": "ALLY_OF", "relation_id": "...",
  "contradiction": {
    "kind": "relation_label_conflict",
    "id": "...",
    "existing_value": "ENEMY_OF",
    "incoming_value": "ALLY_OF",
    "conflicting_relation_id": "..."
  }
}
```

## Testing

### Unit tests: `packages/core/src/rag/contradictions.test.ts`

All against an in-memory DuckDB world fixture (same pattern as `lore.test.ts`):

1. Entity similarity below threshold → flag inserted and returned with `similarity`
2. Entity similarity above threshold → null returned, no DB row
3. Relation label conflict → active A→B "ENEMY_OF" exists; insert A→B "ALLY_OF"
   → flag with both `relation_id` and `conflicting_relation_id`
4. No conflict when prior relation is invalidated (`invalid_at IS NOT NULL`)
5. No conflict when same label (the update path in `linkLore` — not reached, but defensive)
6. `resolveContradiction` → `resolved_at` and `resolution` set on the row
7. `listContradictions` → returns open flags; excludes resolved by default;
   includes resolved with `include_resolved: true`

### Integration additions: `packages/core/src/rag/lore.test.ts`

1. `upsertLore` returns `contradiction` when summary diverges on update
2. `upsertLore` returns no `contradiction` when summary is similar to existing
3. `linkLore` returns `contradiction` when structural conflict exists
4. `linkLore` returns no `contradiction` when prior relation was superseded
   (invalidated) before the call

## DB migration

New entry in `packages/core/src/migrations/world.ts` (append-only):

```ts
{
  version: 2,
  description: "add contradictions table for write-time conflict surfacing",
  async up(conn) {
    await conn.run(`CREATE TABLE IF NOT EXISTS contradictions ( ... )`);
  },
}
```

Also add the `CREATE TABLE IF NOT EXISTS contradictions` block to
`rag/world-db.ts` `initDb` so fresh installs don't need to run migrations.
Existing worlds pick it up on next server start via the migration runner.
