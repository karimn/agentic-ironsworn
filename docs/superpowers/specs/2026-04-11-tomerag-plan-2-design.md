# TomeRAG.jl Plan 2 — Hybrid Search + Extended Query API + REST Server

**Date:** 2026-04-11
**Status:** Approved

---

## Overview

Plan 2 adds three capabilities on top of the Plan 1 foundation:

1. **BM25/hybrid search** — DuckDB FTS index alongside the HNSW index; hybrid merge via Reciprocal Rank Fusion (RRF)
2. **Extended query API** — `filter_chunks`, `lookup`, `multi_query`, `get_context`
3. **REST API** — `serve(registry)` via Oxygen.jl, exposes all query functions over HTTP

Evaluation harness deferred. PDF ingestion and Claude classifier deferred to Plan 3.

---

## Architecture

Implementation follows a layered approach (A):

```
Layer 3: REST API (src/server.jl)          ← Oxygen.jl HTTP server
Layer 2: Extended Query API (src/query_engine.jl)  ← filter_chunks, lookup, multi_query, get_context
Layer 1: BM25/FTS + hybrid search (src/storage.jl + src/query_engine.jl)
```

Each layer is fully tested before the next builds on it.

---

## Layer 1: BM25/FTS Index + Hybrid Search

### Storage changes (`src/storage.jl`)

`initialize_store` creates a DuckDB FTS index on the `text` column after the HNSW index:

```julia
DBInterface.execute(db, "PRAGMA create_fts_index('chunks', 'id', 'text', stemmer='porter')")
```

`insert_chunks` rebuilds the FTS index after each batch (DuckDB FTS does not auto-update on INSERT):

```julia
DBInterface.execute(db, "PRAGMA drop_fts_index('chunks')")
DBInterface.execute(db, "PRAGMA create_fts_index('chunks', 'id', 'text', stemmer='porter')")
```

New function `bm25_search(db, query_text; content_type, document_type, top_k)`:
- Uses `fts_main_chunks.match_bm25(id, query_text)` for BM25 scoring
- Accepts the same metadata filters as `similarity_search`
- Returns `Vector{Tuple{Chunk, Float32}}` (chunk + raw BM25 score)

### Query engine changes (`src/query_engine.jl`)

`query()` becomes hybrid by default:

1. Run `similarity_search` (dense) and `bm25_search` (BM25) in parallel
2. Merge results via **Reciprocal Rank Fusion**: `score(chunk) = Σ 1/(k + rankᵢ)` where `k = 60`
3. Re-rank merged list by RRF score, apply `top_k` and `score_threshold`

Signature gains `mode` keyword (`:hybrid` default, `:dense` for dense-only):

```julia
query(registry, text; source, content_type=nothing, document_type=nothing,
      top_k=5, score_threshold=0.0f0, embed_backend, mode=:hybrid)
```

---

## Layer 2: Extended Query API (`src/query_engine.jl`)

### `filter_chunks`

Pure metadata filter — no embedding, no text query. Paginates via `offset`.

```julia
filter_chunks(registry, source;
    content_type=nothing, document_type=nothing,
    top_k=100, offset=0)
```

Returns `Vector{Chunk}`.

### `lookup`

Exact/fuzzy name match via FTS against `text` and `heading_path`. Useful for stat blocks, move names, NPC names.

```julia
lookup(registry, name; source, content_type=nothing)
```

Returns `Vector{QueryResult}` ranked by BM25 score.

### `multi_query`

Runs N `query()` calls (same source or cross-source), min-max normalizes scores per sub-query, merges and deduplicates by chunk ID.

```julia
multi_query(registry, queries::Vector{Tuple{String, NamedTuple}};
    embed_backend, top_k=10)
```

Where each query tuple is `(text, kwargs)` — kwargs forwarded to `query()` (e.g. `source`, `content_type`). `embed_backend` is a single shared backend passed at the top level, not per sub-query. Cross-source scores are not directly comparable; min-max normalization makes them mergeable.

### `get_context`

Fetches a chunk plus N neighbors by `chunk_order` within the same `doc_id`.

```julia
get_context(registry, chunk_id; before=1, after=1)
```

Returns `Vector{Chunk}` ordered by `chunk_order`.

### Exports

All five functions exported from `src/TomeRAG.jl`:
`query`, `filter_chunks`, `lookup`, `multi_query`, `get_context`

---

## Layer 3: REST API (`src/server.jl`)

### Starting the server

```julia
serve(registry; port=8080)
```

Uses **Oxygen.jl**. Blocking call; consuming projects run it in a task or at script end.

### Endpoints

| Method | Endpoint | Handler |
|--------|----------|---------|
| `GET`  | `/health` | `→ {"status": "ok"}` |
| `GET`  | `/sources` | List all registered sources with metadata |
| `GET`  | `/sources/:id` | Source stats: chunk count, doc count, last ingested, embedding model |
| `POST` | `/query` | `→ query()` |
| `POST` | `/filter` | `→ filter_chunks()` |
| `GET`  | `/lookup` | `→ lookup()` (query params: `name`, `source`, `content_type`) |
| `POST` | `/multi_query` | `→ multi_query()` |
| `GET`  | `/chunk/:id` | Single chunk by ID |
| `GET`  | `/chunk/:id/context` | `→ get_context()` (query params: `before`, `after`) |

### Request/response shapes

**`POST /query`:**
```json
{
  "text": "How does Blight corruption progress?",
  "source": "coriolis",
  "content_type": "mechanic",
  "document_type": "core_rules",
  "top_k": 5,
  "score_threshold": 0.6,
  "mode": "hybrid"
}
```

**`POST /filter`:**
```json
{
  "source": "ironsworn",
  "content_type": "move",
  "top_k": 100,
  "offset": 0
}
```

**Response (query/filter/lookup/multi_query):**
```json
[{
  "score": 0.91,
  "rank": 1,
  "source": "coriolis",
  "doc_id": "coriolis-core-1e",
  "document_type": "core_rules",
  "page": "142",
  "heading_path": ["The Blight", "Corruption Mechanics"],
  "content_type": "mechanic",
  "tags": ["blight", "corruption"],
  "move_trigger": null,
  "text": "..."
}]
```

**Errors:** `{"error": "message"}` with HTTP 400 (bad input), 404 (missing source/chunk), 500 (unexpected).

### New dependency

`Oxygen` added to `Project.toml`.

---

## Testing

### `test_storage.jl` additions
- BM25 search returns ranked results for a known query
- FTS index rebuilt correctly after `insert_chunks`

### `test_query.jl` additions
- Hybrid mode returns merged + RRF-ranked results
- Dense-only mode (`mode=:dense`) still works
- `filter_chunks` paginates correctly
- `lookup` finds a move by name
- `multi_query` normalizes and merges cross-source results
- `get_context` returns neighbors in `chunk_order`

### `test_server.jl` (new)
- Starts server on a random port via `Threads.@spawn serve(...)`
- Fires HTTP requests using `HTTP.jl` (already a dep)
- Checks all endpoints: health, sources, query, filter, lookup, multi_query, chunk, context
- Checks error responses (404 for unknown source, 400 for missing required fields)
- Shuts down server after tests

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/storage.jl` | Add FTS index creation/rebuild; add `bm25_search` |
| `src/query_engine.jl` | Hybrid RRF merge in `query()`; add `filter_chunks`, `lookup`, `multi_query`, `get_context` |
| `src/server.jl` | New — Oxygen.jl REST server |
| `src/TomeRAG.jl` | Include `server.jl`; export new functions + `serve` |
| `Project.toml` | Add `Oxygen` dep |
| `test/test_storage.jl` | BM25 search tests |
| `test/test_query.jl` | Hybrid + extended query tests |
| `test/test_server.jl` | New — REST API tests |
| `test/runtests.jl` | Include `test_server.jl` |
