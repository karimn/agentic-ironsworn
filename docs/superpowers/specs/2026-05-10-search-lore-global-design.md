# `search_lore_global` — GraphRAG Phase C

**Issue:** [#57](https://github.com/karimn/agentic-rpg/issues/57)
**Scope:** Phase C of issue #57 only. Phase D (auto-recompute trigger) deferred to a follow-up.
**Status:** Spec

## Motivation

Phases A + B (shipped in #67) cluster the lore graph via hierarchical Louvain and generate Claude-written summaries for each cluster, embedded via Ollama. Entities and relations can be searched locally via `search_lore`, but there is no way to query at the community level.

The GM agent needs to ground scenes in both *entity-level* facts (who/what/where) and *thematic* framing (what cluster is this part of, what's the campaign-wide pattern). Without `search_lore_global`, the GM can only reason entity-by-entity — the community summaries sit in DuckDB unused.

## Goals

1. Ship `search_lore_global` MCP tool that semantically searches community summaries
2. Add the HNSW index on `lore_communities.embedding` so search is fast at scale
3. Update the GM agent prompt so `search_lore` and `search_lore_global` are paired whenever lore is consulted for scene-grounding (not for name-collision checks)

## Non-goals

- **Phase D auto-recompute trigger.** Recomputation remains manual via the existing `recompute_communities` tool.
- **Drill-down member entities in results.** `search_lore_global` returns community-level hits only. Callers that need member entities follow up with `get_community`.
- **`search_lore_auto` combined router.** Keeping the two tools separate so the GM's decision is visible in the tool trace.
- **Cross-campaign global search.** Campaigns remain isolated.

## Design

### SDK layer — `searchCommunities` in `rag/communities.ts`

New function alongside `listCommunities` / `getCommunity`:

```ts
export interface CommunitySearchHit {
  id: string;
  level: number;
  parent_id: string | null;
  member_count: number;
  summary: string;
  score: number;
}

export async function searchCommunities(
  campaignPath: string,
  query: string,
  k?: number,
  embedder?: Embedder,
): Promise<CommunitySearchHit[]>;
```

**Behavior:**
- Default `k = 5`, capped at 100 (mirrors `listCommunities`).
- Embeds `query` via the supplied `embedder` or `getLoreEmbedding` (Ollama `nomic-embed-text`).
- SQL filters out `NULL` embeddings and ranks across *all* hierarchy levels flat (leaves and rollups mixed), by descending `array_cosine_similarity`.
- Returns `[]` for an empty table or when all rows have NULL embeddings.
- Throws when the embedder throws (Ollama unreachable). The MCP tool surfaces this as `{ isError: true }` — same pattern as `search_lore`.

**Null-embedding policy:** rows where Ollama was unavailable at `recompute_communities` time have `embedding IS NULL`. These are silently excluded from results — surfacing them with `score = 0` would be misleading (they can't be ranked against the query). On the next successful recompute they'll be backfilled.

### Schema change — HNSW index on `lore_communities.embedding`

In `rag/lore-db.ts`, after the existing `lore_communities_parent_idx` and `lore_communities_level_idx` creations, guarded by `vssLoaded`:

```ts
if (vssLoaded) {
  await conn.run(`
    CREATE INDEX IF NOT EXISTS lore_communities_embedding_idx
    ON lore_communities USING HNSW (embedding)
    WITH (metric = 'cosine')
  `);
}
```

The `ORDER BY array_cosine_similarity(...) DESC LIMIT k` query pattern picks up the HNSW index automatically when present, matching the pattern already used for `lore_entities`. The explicit `WHERE embedding IS NOT NULL` keeps correctness independent of the index.

No DuckDB migration is required: the `IF NOT EXISTS` creates the index on first open of any existing DB.

### MCP tool — `search_lore_global` in `tools/lore.ts`

Wraps `searchCommunities`:

```ts
server.tool(
  "search_lore_global",
  "GraphRAG Phase C: semantic search over lore community summaries (thematic " +
    "clusters produced by recompute_communities). Ranks hits flat across all " +
    "hierarchy levels (leaves + rollups) by cosine similarity. Pair with " +
    "search_lore when grounding scenes — search_lore for entity-level facts, " +
    "search_lore_global for thematic framing. Returns ranked community hits " +
    "with id, level, parent_id, member_count, summary, score.",
  {
    query: z.string().describe("Search query"),
    k: z.coerce.number().int().positive().optional()
      .describe("Number of results (default 5, capped at 100)"),
  },
  async ({ query, k }) => {
    try {
      const results = await searchCommunities(campaignPath, query, k);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);
```

Tool registration uses the existing `server.tool` pattern; no other infrastructure changes.

### GM agent prompt updates — `agents/ironsworn-gm.md`

Three targeted edits around the existing lore guidance (current lines 112-114):

1. **Extend "Ground every scene in the established lore" (line 112):** pair `search_lore` with `search_lore_global` as parallel calls whenever grounding a scene, introducing a location/NPC/faction, or establishing theme. The two tools answer different questions — local = entity facts, global = thematic cluster — and they should be invoked in parallel in the same turn.

2. **Carve out collision checks (line 114):** the mandatory "Lore collision check" stays `search_lore` only. Name-collision lookup is an entity-resolution task; community summaries would add noise. Add a sentence clarifying this exception.

3. **New subsection "Local vs. Global Lore"** immediately after the collision-check paragraph:
   - `search_lore` — name/entity resolution, collision checks, entity-by-entity grounding
   - `search_lore_global` — thematic framing, campaign-wide context, "what's this cluster about"
   - Pair them (parallel tool calls) whenever lore is consulted for scene-grounding
   - Don't pair for name-collision checks
   - Quote the GraphRAG local-vs-global framing so future maintainers know why two tools exist

No other prompt changes.

## Testing

### `src/rag/communities.test.ts` — new describe block `searchCommunities`

Using the existing `mkdtemp`/`rm` campaign fixture and a deterministic stub embedder (small known-shape vectors):

1. **Ranks by cosine similarity.** Seed three communities with embeddings pointing in different directions; query closest to one. Assert that one ranks first.
2. **Returns `[]` on empty table.** Call without running `recomputeCommunities`. Assert empty array.
3. **Excludes NULL embeddings.** Insert a community row with `embedding = NULL` directly via SQL; verify it is not returned.
4. **Honors `k`.** Seed 7 communities; call with `k = 3`; assert 3 results.
5. **Caps `k` at 100.** Call with `k = 500`; assert it does not throw and returns at most 100.
6. **Flat cross-level ranking.** Seed a leaf and a parent whose embeddings are both close to the query; both appear in top-k.
7. **Ollama-gated end-to-end** (behind the existing `ollamaAvailable()` check): real `recomputeCommunities` run, then `searchCommunities` with a thematic query returns sensible ordering.

### `src/tools/lore.test.ts` — new `search_lore_global` cases

Mirroring existing `search_lore` tool tests:

1. **Happy path.** With seeded communities, the tool returns `{ content: [{ type: "text", text: "[...]" }] }` and the parsed JSON is a non-empty array.
2. **Error path.** When the embedder throws (Ollama down), the tool returns `{ isError: true }` and the error text includes the embedder message.

### Manual smoke

- `bun test` green
- `bun run tsc --noEmit` clean
- `bun run src/server.ts` starts; `search_lore_global` appears in the tool list

## Version bump

`plugins/ironsworn/.claude-plugin/plugin.json`: `0.10.0` → `0.11.0`. New MCP tool = minor bump per `CLAUDE.md`.

## Error handling & edge cases

- **Ollama unreachable:** `getLoreEmbedding` throws; `searchCommunities` propagates; MCP tool returns `{ isError: true }`. Matches `search_lore` behavior.
- **vss extension unavailable:** index creation silently skipped (existing pattern). Search still works via the linear cosine similarity scan.
- **No `recompute_communities` run yet:** `lore_communities` is empty; returns `[]`.
- **All communities have NULL embeddings:** returns `[]`. Recommend the operator re-run `recompute_communities` when Ollama is up.
- **`k < 1`:** Zod `z.coerce.number().int().positive().optional()` rejects before the handler runs.

## Out of scope (explicit)

- **Phase D auto-recompute trigger** — follow-up issue
- **`/refresh-communities` slash command** — out
- **Drill-down member entities in search results** — callers use `get_community` if needed
- **Cross-campaign global search** — campaigns stay isolated
- **Changing `search_lore` behavior** — unchanged
- **Embedding-strategy changes** — continue embedding `summary` text, not concatenated member summaries

## Acceptance criteria

- [ ] `searchCommunities` SDK function in `rag/communities.ts` with tests
- [ ] `search_lore_global` MCP tool in `tools/lore.ts` with tests
- [ ] HNSW index `lore_communities_embedding_idx` created in `lore-db.ts` (guarded by `vssLoaded`)
- [ ] GM agent prompt updated: pair `search_lore` + `search_lore_global` for scene-grounding; collision check stays local-only
- [ ] Plugin version bumped 0.10.0 → 0.11.0
- [ ] `bun test` and `bun run tsc --noEmit` green
