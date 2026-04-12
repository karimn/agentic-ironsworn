# TomeRAG.jl Plan 2 — Hybrid Search + Extended Query API + REST Server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BM25/hybrid search (Reciprocal Rank Fusion), five extended query functions, and an Oxygen.jl REST server exposing all of them over HTTP.

**Architecture:** Layered — storage gains FTS index + bm25_search; query_engine gains RRF merge in query() and four new functions; server.jl wraps all of them behind HTTP endpoints. Each layer is fully tested before the next builds on it.

**Tech Stack:** Julia 1.10+, DuckDB.jl (FTS extension), Oxygen.jl (HTTP server), HTTP.jl (already a dep — used in server tests), JSON3.jl (already a dep).

**Spec:** `docs/superpowers/specs/2026-04-11-tomerag-plan-2-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `TomeRAG.jl/Project.toml` | Modify | Add Oxygen dep + compat |
| `TomeRAG.jl/src/storage.jl` | Modify | FTS index creation/rebuild; `bm25_search` |
| `TomeRAG.jl/src/query_engine.jl` | Modify | `query()` hybrid mode + RRF; `filter_chunks`, `lookup`, `multi_query`, `get_context` |
| `TomeRAG.jl/src/server.jl` | Create | Oxygen.jl routes; `serve(registry; port, async)` |
| `TomeRAG.jl/src/TomeRAG.jl` | Modify | Include `server.jl`; export new functions |
| `TomeRAG.jl/test/test_storage.jl` | Modify | BM25 search tests |
| `TomeRAG.jl/test/test_query.jl` | Modify | Hybrid + extended query tests |
| `TomeRAG.jl/test/test_server.jl` | Create | Full REST API tests (one server lifecycle) |
| `TomeRAG.jl/test/runtests.jl` | Modify | Include `test_server.jl` |

---

## Task 1: Add Oxygen.jl dependency

**Files:**
- Modify: `TomeRAG.jl/Project.toml`

- [ ] **Step 1: Add Oxygen via Pkg**

Run:
```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.add("Oxygen")'
```
Expected: resolves and installs Oxygen.jl (and its deps: HTTP.jl already present).

- [ ] **Step 2: Add compat entry**

Open `TomeRAG.jl/Project.toml`. In the `[compat]` section, add:
```toml
Oxygen = "1"
```

The `[deps]` section will now contain an `Oxygen = "..."` line with UUID (added by Pkg.add above).

- [ ] **Step 3: Verify package loads**

Run:
```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Oxygen; println("Oxygen OK")'
```
Expected: `Oxygen OK`

- [ ] **Step 4: Commit**

```bash
git add TomeRAG.jl/Project.toml TomeRAG.jl/Manifest.toml
git commit -m "deps(tomerag): add Oxygen.jl for REST server"
```

---

## Task 2: FTS index in storage + bm25_search

**Files:**
- Modify: `TomeRAG.jl/src/storage.jl`
- Modify: `TomeRAG.jl/test/test_storage.jl`

- [ ] **Step 1: Write failing test**

Append to `TomeRAG.jl/test/test_storage.jl`:

```julia
using TomeRAG: bm25_search

@testset "bm25_search" begin
    path = tempname() * ".duckdb"
    src = _mk_source(path)
    initialize_store(src)

    # Insert chunks with distinct text
    c1 = _mk_chunk("bm1", "iron vow momentum move roll")
    c2 = _mk_chunk("bm2", "delve the dungeon depths explore")
    c3 = _mk_chunk("bm3", "blight corruption spreads darkness")
    insert_chunks(src, [c1, c2, c3])

    results = bm25_search(src, "momentum iron vow"; top_k=3)
    @test length(results) >= 1
    # First result should be the momentum/iron vow chunk
    top_chunk, top_score = results[1]
    @test top_chunk.id == "bm1"
    @test top_score > 0.0f0

    # Filter by content_type returns only matching chunks
    c4 = _mk_chunk("bm4", "iron vow move lore")
    c4 = Chunk(c4; content_type = :lore)
    insert_chunks(src, [c4])
    lore_results = bm25_search(src, "iron vow";
                               top_k=5,
                               filters=Dict{String,Any}("content_type" => "lore"))
    @test all(r[1].content_type == :lore for r in lore_results)
end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `bm25_search not defined`

- [ ] **Step 3: Add FTS to initialize_store**

In `TomeRAG.jl/src/storage.jl`, inside `initialize_store`, after the line that creates the HNSW index and before `finally`, add:

```julia
        DuckDB.execute(db, "INSTALL fts;")
        DuckDB.execute(db, "LOAD fts;")
        DuckDB.execute(db, """
            PRAGMA create_fts_index('chunks', 'id', 'text', stemmer='porter', overwrite=1);
        """)
```

The full `initialize_store` try block should now end:
```julia
        DuckDB.execute(db, """
            CREATE INDEX IF NOT EXISTS chunks_hnsw_idx
                ON chunks USING HNSW (embedding) WITH (metric='cosine');
        """)
        DuckDB.execute(db, "INSTALL fts;")
        DuckDB.execute(db, "LOAD fts;")
        DuckDB.execute(db, "PRAGMA create_fts_index('chunks', 'id', 'text', stemmer='porter', overwrite=1);")
    finally
        DBInterface.close!(db)
    end
```

- [ ] **Step 4: Rebuild FTS after insert in insert_chunks**

In `TomeRAG.jl/src/storage.jl`, modify `insert_chunks` to load FTS and rebuild the index after a successful commit. Replace the existing function body with:

```julia
function insert_chunks(src::Source, chunks::AbstractVector{Chunk})
    isempty(chunks) && return 0
    db = DBInterface.connect(DuckDB.DB, src.db_path)
    inserted = 0
    try
        DuckDB.execute(db, "LOAD vss;")
        DuckDB.execute(db, "LOAD fts;")
        DuckDB.execute(db, "BEGIN;")
        stmt = """
            INSERT INTO chunks VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        for c in chunks
            exists = false
            for _ in DuckDB.execute(db,
                    "SELECT 1 FROM chunks WHERE doc_id=? AND content_hash=? LIMIT 1",
                    (c.doc_id, c.content_hash))
                exists = true
            end
            exists && continue
            DuckDB.execute(db, stmt, (
                c.id, c.source_id, c.doc_id, c.doc_path,
                c.text, Vector{Float32}(c.embedding), c.embedding_model, c.token_count, c.content_hash,
                String(c.document_type), c.system, c.edition, c.page,
                JSON3.write(c.heading_path), c.chunk_order, c.parent_id,
                String(c.content_type), JSON3.write(c.tags),
                c.move_trigger,
                c.scene_type === nothing ? nothing : String(c.scene_type),
                c.encounter_key, c.npc_name, String(c.license),
            ))
            inserted += 1
        end
        DuckDB.execute(db, "COMMIT;")
        if inserted > 0
            DuckDB.execute(db, "PRAGMA drop_fts_index('chunks');")
            DuckDB.execute(db, "PRAGMA create_fts_index('chunks', 'id', 'text', stemmer='porter', overwrite=1);")
        end
    catch e
        try DuckDB.execute(db, "ROLLBACK;") catch end
        rethrow(e)
    finally
        DBInterface.close!(db)
    end
    return inserted
end
```

- [ ] **Step 5: Add bm25_search function**

Append to `TomeRAG.jl/src/storage.jl` (after `_row_to_chunk`):

```julia
"""
    bm25_search(src, query_text; filters, top_k) -> Vector{Tuple{Chunk, Float32}}

BM25 full-text search over the `text` column. Returns chunks with raw BM25 scores,
ordered by score descending. `filters` supports keys: `"content_type"`,
`"document_type"`, `"system"`, `"doc_id"`.
"""
function bm25_search(src::Source, query_text::AbstractString;
                     top_k::Int=10,
                     filters::Dict{String,Any}=Dict{String,Any}())
    db = DBInterface.connect(DuckDB.DB, src.db_path)
    try
        DuckDB.execute(db, "LOAD fts;")

        where_parts = ["score IS NOT NULL"]
        filter_vals = Any[]
        for (col, val) in filters
            col in ("content_type", "document_type", "system", "doc_id") ||
                error("unsupported filter column: $col")
            push!(where_parts, "$col = ?")
            push!(filter_vals, String(val))
        end
        where_clause = "WHERE " * join(where_parts, " AND ")

        # match_bm25 requires a string literal; escape single quotes.
        escaped = replace(String(query_text), "'" => "''")
        sql = """
            SELECT id, source_id, doc_id, doc_path, text, embedding::FLOAT[] AS embedding,
                   embedding_model, token_count, content_hash, document_type, system,
                   edition, page, heading_path, chunk_order, parent_id, content_type, tags,
                   move_trigger, scene_type, encounter_key, npc_name, license,
                   fts_main_chunks.match_bm25(id, '$escaped') AS score
            FROM chunks
            $where_clause
            ORDER BY score DESC
            LIMIT $top_k
        """
        results = Tuple{Chunk,Float32}[]
        for row in DuckDB.execute(db, sql, filter_vals)
            push!(results, (_row_to_chunk(row), Float32(row.score)))
        end
        return results
    finally
        DBInterface.close!(db)
    end
end
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass (91 + new bm25 tests).

- [ ] **Step 7: Commit**

```bash
git add TomeRAG.jl/src/storage.jl TomeRAG.jl/test/test_storage.jl
git commit -m "feat(tomerag): BM25/FTS index and bm25_search"
```

---

## Task 3: Hybrid search in query() (RRF merge)

**Files:**
- Modify: `TomeRAG.jl/src/query_engine.jl`
- Modify: `TomeRAG.jl/test/test_query.jl`

- [ ] **Step 1: Write failing test**

Append to `TomeRAG.jl/test/test_query.jl`:

```julia
@testset "query() hybrid mode (RRF)" begin
    db = tempname() * ".duckdb"
    src = Source(
        id = "hybrid-test",
        name = "Hybrid Test",
        system = "PbtA",
        db_path = db,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md_path = tempname() * ".md"
    write(md_path, """
    # Rules
    ## Iron Vow
    **When you swear an iron vow**, roll +heart.
    ## Face Danger
    **When you face danger**, roll +edge.
    """)
    ingest!(reg, "hybrid-test", md_path;
            doc_id = "hybrid-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())

    # Hybrid mode (default) should return results
    results = query(reg, "iron vow heart";
                    source = "hybrid-test", top_k = 2,
                    embed_backend = MockEmbeddingBackend(dim=8))
    @test length(results) >= 1
    @test results[1].rank == 1

    # Dense-only mode still works
    dense_results = query(reg, "iron vow heart";
                          source = "hybrid-test", top_k = 2, mode = :dense,
                          embed_backend = MockEmbeddingBackend(dim=8))
    @test length(dense_results) >= 1
end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `query does not accept keyword argument mode`

- [ ] **Step 3: Add _rrf_merge helper and rewrite query()**

Replace the entire contents of `TomeRAG.jl/src/query_engine.jl` with:

```julia
"""
    _rrf_merge(dense, bm25; k, top_k, score_threshold) -> Vector{QueryResult}

Reciprocal Rank Fusion: score(chunk) = Σ 1/(k + rank_i).
`dense` is Vector{QueryResult} from similarity_search.
`bm25` is Vector{Tuple{Chunk,Float32}} from bm25_search (scores ignored, only rank used).
"""
function _rrf_merge(dense::Vector{QueryResult},
                    bm25::Vector{Tuple{Chunk,Float32}};
                    k::Int=60, top_k::Int=5,
                    score_threshold::Float32=0.0f0)
    scores = Dict{String,Float32}()
    chunks = Dict{String,Chunk}()

    for (i, qr) in enumerate(dense)
        id = qr.chunk.id
        scores[id] = get(scores, id, 0.0f0) + 1.0f0 / (k + i)
        chunks[id] = qr.chunk
    end
    for (i, (chunk, _)) in enumerate(bm25)
        id = chunk.id
        scores[id] = get(scores, id, 0.0f0) + 1.0f0 / (k + i)
        chunks[id] = chunk
    end

    sorted_ids = sort(collect(keys(scores)), by = id -> -scores[id])
    out = QueryResult[]
    for id in sorted_ids
        s = scores[id]
        s >= score_threshold || continue
        push!(out, QueryResult(chunks[id], s, length(out) + 1))
        length(out) >= top_k && break
    end
    return out
end

"""
    query(registry, text; source, content_type, document_type, top_k,
          score_threshold, embed_backend, mode) -> Vector{QueryResult}

Embed `text` and search `source`. `mode=:hybrid` (default) merges dense HNSW and
BM25 via Reciprocal Rank Fusion. `mode=:dense` runs dense-only.
"""
function query(registry::SourceRegistry, text::AbstractString;
               source::AbstractString,
               content_type::Union{Symbol,Nothing}=nothing,
               document_type::Union{Symbol,Nothing}=nothing,
               top_k::Int=5,
               score_threshold::Float32=0.0f0,
               embed_backend::EmbeddingBackend,
               mode::Symbol=:hybrid)
    src = get_source(registry, source)
    q = embed(embed_backend, String(text))
    length(q) == src.embedding_dim ||
        error("embedding dim mismatch: source expects $(src.embedding_dim), got $(length(q))")

    filters = Dict{String,Any}()
    content_type === nothing || (filters["content_type"] = String(content_type))
    document_type === nothing || (filters["document_type"] = String(document_type))

    if mode === :dense
        raw = similarity_search(src, q; top_k=top_k, filters=filters)
        score_threshold > 0 || return raw
        return [r for r in raw if r.score >= score_threshold]
    else
        dense = similarity_search(src, q; top_k=top_k * 2, filters=filters)
        bm25  = bm25_search(src, String(text); top_k=top_k * 2, filters=filters)
        return _rrf_merge(dense, bm25; top_k=top_k, score_threshold=score_threshold)
    end
end

```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass including new hybrid mode test.

- [ ] **Step 5: Commit**

```bash
git add TomeRAG.jl/src/query_engine.jl TomeRAG.jl/test/test_query.jl
git commit -m "feat(tomerag): hybrid RRF search in query()"
```

---

## Task 4: filter_chunks, lookup, multi_query, get_context

**Files:**
- Modify: `TomeRAG.jl/src/query_engine.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_query.jl`

- [ ] **Step 1: Write failing tests**

Append to `TomeRAG.jl/test/test_query.jl`:

```julia
using TomeRAG: filter_chunks, lookup, multi_query, get_context
# Note: the `using TomeRAG: name` syntax imports non-exported names too.
# Tests fail below because these functions don't exist yet (added in Step 3).

@testset "filter_chunks" begin
    db = tempname() * ".duckdb"
    src = Source(
        id = "filter-test",
        name = "Filter Test",
        system = "PbtA",
        db_path = db,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md_path = tempname() * ".md"
    write(md_path, """
    # Moves
    ## Iron Vow
    **When you swear an iron vow**, roll +heart.
    ## Face Danger
    **When you face danger**, roll +edge.
    # Lore
    ## The Iron World
    A world of darkness and danger.
    """)
    ingest!(reg, "filter-test", md_path;
            doc_id = "filter-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())

    all_chunks = filter_chunks(reg, "filter-test"; top_k=100)
    @test length(all_chunks) >= 3

    moves = filter_chunks(reg, "filter-test"; content_type=:move, top_k=100)
    @test all(c.content_type == :move for c in moves)
    @test length(moves) >= 1

    # Pagination
    page1 = filter_chunks(reg, "filter-test"; top_k=2, offset=0)
    page2 = filter_chunks(reg, "filter-test"; top_k=2, offset=2)
    @test length(page1) == 2
    @test (isempty(page2) || page1[1].id != page2[1].id)
end

@testset "lookup" begin
    db = tempname() * ".duckdb"
    src = Source(
        id = "lookup-test",
        name = "Lookup Test",
        system = "PbtA",
        db_path = db,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md_path = tempname() * ".md"
    write(md_path, """
    # Moves
    ## Delve the Depths
    **When you delve the depths**, roll +wits.
    ## Secure an Advantage
    **When you secure an advantage**, roll +heart.
    """)
    ingest!(reg, "lookup-test", md_path;
            doc_id = "lookup-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())

    results = lookup(reg, "Delve the Depths"; source="lookup-test")
    @test length(results) >= 1
    @test occursin("delve", lowercase(results[1].chunk.text))
    @test results[1].rank == 1
end

@testset "multi_query" begin
    db = tempname() * ".duckdb"
    src = Source(
        id = "multi-test",
        name = "Multi Test",
        system = "PbtA",
        db_path = db,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md_path = tempname() * ".md"
    write(md_path, """
    # Rules
    ## Iron Vow
    **When you swear upon iron**, roll +heart. On a 10+, your vow is strong.
    ## Face Danger
    **When you face danger**, roll +edge. On a miss, pay the price.
    """)
    ingest!(reg, "multi-test", md_path;
            doc_id = "multi-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())

    backend = MockEmbeddingBackend(dim=8)
    results = multi_query(reg, [
        ("iron vow swear", (source="multi-test",)),
        ("face danger miss", (source="multi-test",)),
    ]; embed_backend=backend, top_k=5)

    @test length(results) >= 1
    @test results[1].rank == 1
    # Scores are normalized 0–1
    @test all(0.0f0 <= r.score <= 1.0f0 for r in results)
    # No duplicates
    ids = [r.chunk.id for r in results]
    @test length(ids) == length(unique(ids))
end

@testset "get_context" begin
    db = tempname() * ".duckdb"
    src = Source(
        id = "ctx-test",
        name = "Ctx Test",
        system = "PbtA",
        db_path = db,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md_path = tempname() * ".md"
    write(md_path, """
    # Rules
    ## Move A
    First move text here for context testing purposes.
    ## Move B
    Second move text here for context testing purposes.
    ## Move C
    Third move text here for context testing purposes.
    """)
    ingest!(reg, "ctx-test", md_path;
            doc_id = "ctx-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())

    all_chunks = filter_chunks(reg, "ctx-test"; top_k=10)
    @test length(all_chunks) >= 3

    # Get context around the middle chunk
    middle = all_chunks[2]
    ctx = get_context(reg, middle.id; source="ctx-test", before=1, after=1)
    @test length(ctx) >= 1
    @test any(c.id == middle.id for c in ctx)
    # Chunks are ordered by chunk_order
    orders = [c.chunk_order for c in ctx]
    @test orders == sort(orders)

    # Non-existent chunk returns empty
    empty_ctx = get_context(reg, "nonexistent-id"; source="ctx-test", before=1, after=1)
    @test isempty(empty_ctx)
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `TomeRAG does not export or define filter_chunks`

- [ ] **Step 3: Append implementations to query_engine.jl**

Append to `TomeRAG.jl/src/query_engine.jl`:

```julia
"""
    filter_chunks(registry, source; content_type, document_type, top_k, offset) -> Vector{Chunk}

Pure metadata filter — no embedding, no text query. Paginates via `offset`.
"""
function filter_chunks(registry::SourceRegistry, source::AbstractString;
                       content_type::Union{Symbol,Nothing}=nothing,
                       document_type::Union{Symbol,Nothing}=nothing,
                       top_k::Int=100, offset::Int=0)
    src = get_source(registry, source)
    db = DBInterface.connect(DuckDB.DB, src.db_path)
    try
        where_parts = String[]
        vals = Any[]
        content_type === nothing || (push!(where_parts, "content_type = ?"); push!(vals, String(content_type)))
        document_type === nothing || (push!(where_parts, "document_type = ?"); push!(vals, String(document_type)))
        where = isempty(where_parts) ? "" : "WHERE " * join(where_parts, " AND ")
        sql = """
            SELECT id, source_id, doc_id, doc_path, text, embedding::FLOAT[] AS embedding,
                   embedding_model, token_count, content_hash, document_type, system,
                   edition, page, heading_path, chunk_order, parent_id, content_type, tags,
                   move_trigger, scene_type, encounter_key, npc_name, license
            FROM chunks $where ORDER BY chunk_order ASC
            LIMIT $top_k OFFSET $offset
        """
        result = Chunk[]
        row_iter = isempty(vals) ? DuckDB.execute(db, sql) : DuckDB.execute(db, sql, vals)
        for row in row_iter
            push!(result, _row_to_chunk(row))
        end
        return result
    finally
        DBInterface.close!(db)
    end
end

"""
    lookup(registry, name; source, content_type) -> Vector{QueryResult}

BM25 name lookup against chunk text. Returns results ranked by BM25 score.
"""
function lookup(registry::SourceRegistry, name::AbstractString;
                source::AbstractString,
                content_type::Union{Symbol,Nothing}=nothing)
    src = get_source(registry, source)
    db = DBInterface.connect(DuckDB.DB, src.db_path)
    try
        DuckDB.execute(db, "LOAD fts;")
        where_parts = ["score IS NOT NULL"]
        vals = Any[]
        content_type === nothing || (push!(where_parts, "content_type = ?"); push!(vals, String(content_type)))
        where = "WHERE " * join(where_parts, " AND ")
        escaped = replace(String(name), "'" => "''")
        sql = """
            SELECT id, source_id, doc_id, doc_path, text, embedding::FLOAT[] AS embedding,
                   embedding_model, token_count, content_hash, document_type, system,
                   edition, page, heading_path, chunk_order, parent_id, content_type, tags,
                   move_trigger, scene_type, encounter_key, npc_name, license,
                   fts_main_chunks.match_bm25(id, '$escaped') AS score
            FROM chunks $where ORDER BY score DESC LIMIT 20
        """
        results = QueryResult[]
        rank = 0
        row_iter = isempty(vals) ? DuckDB.execute(db, sql) : DuckDB.execute(db, sql, vals)
        for row in row_iter
            rank += 1
            push!(results, QueryResult(_row_to_chunk(row), Float32(row.score), rank))
        end
        return results
    finally
        DBInterface.close!(db)
    end
end

"""
    multi_query(registry, queries; embed_backend, top_k) -> Vector{QueryResult}

Runs multiple `query()` calls, min-max normalizes scores per sub-query,
merges and deduplicates by chunk ID (highest score wins), returns top_k.

`queries` is a `Vector` of `(text::String, kwargs::NamedTuple)` pairs.
`embed_backend` is shared across all sub-queries.
"""
function multi_query(registry::SourceRegistry,
                     queries::Vector{<:Tuple{<:AbstractString,<:NamedTuple}};
                     embed_backend::EmbeddingBackend,
                     top_k::Int=10)
    all_results = QueryResult[]
    for (text, kwargs) in queries
        results = query(registry, text; embed_backend=embed_backend,
                        top_k=top_k * 2, kwargs...)
        isempty(results) && continue
        scores = Float32[r.score for r in results]
        lo, hi = minimum(scores), maximum(scores)
        normed = hi > lo ? (scores .- lo) ./ (hi - lo) : ones(Float32, length(scores))
        for (r, s) in zip(results, normed)
            push!(all_results, QueryResult(r.chunk, s, 0))
        end
    end
    best = Dict{String,QueryResult}()
    for qr in all_results
        if !haskey(best, qr.chunk.id) || qr.score > best[qr.chunk.id].score
            best[qr.chunk.id] = qr
        end
    end
    sorted = sort(collect(values(best)), by = r -> -r.score)
    return [QueryResult(r.chunk, r.score, i) for (i, r) in enumerate(first(sorted, top_k))]
end

"""
    get_context(registry, chunk_id; source, before, after) -> Vector{Chunk}

Fetches `chunk_id` plus `before` chunks before and `after` chunks after it,
ordered by `chunk_order` within the same document.
"""
function get_context(registry::SourceRegistry, chunk_id::AbstractString;
                     source::AbstractString,
                     before::Int=1, after::Int=1)
    src = get_source(registry, source)
    db = DBInterface.connect(DuckDB.DB, src.db_path)
    try
        doc_id = nothing
        order  = nothing
        for row in DuckDB.execute(db,
                "SELECT doc_id, chunk_order FROM chunks WHERE id = ? LIMIT 1",
                (String(chunk_id),))
            doc_id = row.doc_id
            order  = Int(row.chunk_order)
        end
        isnothing(doc_id) && return Chunk[]

        sql = """
            SELECT id, source_id, doc_id, doc_path, text, embedding::FLOAT[] AS embedding,
                   embedding_model, token_count, content_hash, document_type, system,
                   edition, page, heading_path, chunk_order, parent_id, content_type, tags,
                   move_trigger, scene_type, encounter_key, npc_name, license
            FROM chunks
            WHERE doc_id = ? AND chunk_order >= ? AND chunk_order <= ?
            ORDER BY chunk_order ASC
        """
        result = Chunk[]
        for row in DuckDB.execute(db, sql, (doc_id, order - before, order + after))
            push!(result, _row_to_chunk(row))
        end
        return result
    finally
        DBInterface.close!(db)
    end
end
```

- [ ] **Step 4: Export new functions in TomeRAG.jl module**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Replace the `export query` line with:

```julia
export query, filter_chunks, lookup, multi_query, get_context
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add TomeRAG.jl/src/query_engine.jl TomeRAG.jl/src/TomeRAG.jl TomeRAG.jl/test/test_query.jl
git commit -m "feat(tomerag): filter_chunks, lookup, multi_query, get_context"
```

---

## Task 5: Server skeleton — serve() + /health + /sources

**Files:**
- Create: `TomeRAG.jl/src/server.jl`
- Create: `TomeRAG.jl/test/test_server.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`

- [ ] **Step 1: Write failing test (creates test_server.jl)**

Create `TomeRAG.jl/test/test_server.jl`:

```julia
using Test
using TomeRAG
using HTTP
using JSON3

# Helper: build a test registry with one source + ingested chunks.
function _test_registry(; port)
    db_path = tempname() * ".duckdb"
    src = Source(
        id = "test-src",
        name = "Test Source",
        system = "PbtA",
        db_path = db_path,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md = tempname() * ".md"
    write(md, """
    # Moves
    ## Face Danger
    **When you attempt something risky**, roll +attr. On a 10+, you succeed.
    ## Swear an Iron Vow
    **When you swear upon iron**, roll +heart. On a miss, the vow is imperilled.
    # Lore
    ## The Iron World
    A world of blasted heaths, dark forests, and ancient ruins.
    """)
    ingest!(reg, "test-src", md;
            doc_id = "test-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())
    return reg
end

@testset "REST API" begin
    test_port = 18080
    reg = _test_registry(port=test_port)
    server = serve(reg; port=test_port, async=true)
    sleep(1.0)   # wait for Oxygen to bind
    base = "http://localhost:$test_port"

    try
        @testset "GET /health" begin
            r = HTTP.get("$base/health")
            @test r.status == 200
            body = JSON3.read(r.body, Dict{String,Any})
            @test body["status"] == "ok"
        end

        @testset "GET /sources" begin
            r = HTTP.get("$base/sources")
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) == 1
            @test body[1]["id"] == "test-src"
            @test body[1]["name"] == "Test Source"
        end

        @testset "GET /sources/:id" begin
            r = HTTP.get("$base/sources/test-src")
            @test r.status == 200
            body = JSON3.read(r.body, Dict{String,Any})
            @test body["id"] == "test-src"
            @test body["chunk_count"] isa Integer
            @test body["chunk_count"] >= 1

            r404 = HTTP.get("$base/sources/no-such-source"; status_exception=false)
            @test r404.status == 404
        end
    finally
        close(server)
    end
end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `serve not defined`

- [ ] **Step 3: Create src/server.jl**

Create `TomeRAG.jl/src/server.jl`:

```julia
using Oxygen
using HTTP
using JSON3

"""
    serve(registry; port=8080, async=false)

Start the TomeRAG REST API server. Blocking by default.
Pass `async=true` to get a closeable server handle (for tests).
"""
function serve(registry::SourceRegistry; port::Int=8080, async::Bool=false)
    _setup_routes!(registry)
    if async
        return Oxygen.serveasync(; host="127.0.0.1", port=port)
    else
        Oxygen.serve(; host="0.0.0.0", port=port)
    end
end

function _setup_routes!(registry::SourceRegistry)
    @get "/health" function(req::HTTP.Request)
        return Dict("status" => "ok")
    end

    @get "/sources" function(req::HTTP.Request)
        return [_source_info(src) for src in values(registry.sources)]
    end

    @get "/sources/{id}" function(req::HTTP.Request, id::String)
        if !haskey(registry.sources, id)
            return HTTP.Response(404,
                ["Content-Type" => "application/json"],
                JSON3.write(Dict("error" => "source not found: $id")))
        end
        src = get_source(registry, id)
        stats = source_stats(src)
        info = _source_info(src)
        return merge(info, Dict("chunk_count" => stats.chunk_count))
    end
end

function _source_info(src::Source)
    return Dict(
        "id"              => src.id,
        "name"            => src.name,
        "system"          => src.system,
        "embedding_model" => src.embedding_model,
        "embedding_dim"   => src.embedding_dim,
        "license"         => String(src.license),
    )
end
```

- [ ] **Step 4: Wire up in TomeRAG.jl module**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Add `include("server.jl")` after `include("query_engine.jl")` and add `serve` to the exports:

```julia
module TomeRAG

include("content_types.jl")
include("types.jl")
include("tokenize.jl")
include("backends.jl")
include("chunker.jl")
include("storage.jl")
include("ingest.jl")
include("query_engine.jl")
include("server.jl")

export DEFAULT_CONTENT_TYPES, PBTA_CONTENT_TYPES, YZE_CONTENT_TYPES
export Chunk, QueryResult, ChunkingConfig
export Source, SourceRegistry, register_source!, get_source
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend,
       embed, classify
export split_to_token_budget
export initialize_store, insert_chunks, source_stats, similarity_search
export ingest!
export query, filter_chunks, lookup, multi_query, get_context
export serve

end # module
```

- [ ] **Step 5: Add test_server.jl to runtests.jl**

Edit `TomeRAG.jl/test/runtests.jl`. Add `include("test_server.jl")` at the end:

```julia
using Test
using TomeRAG

@testset "TomeRAG.jl" begin
    include("test_content_types.jl")
    include("test_types.jl")
    include("test_tokenize.jl")
    include("test_backends.jl")
    include("test_ollama.jl")
    include("test_heuristic.jl")
    include("test_chunker.jl")
    include("test_splitter.jl")
    include("test_storage.jl")
    include("test_ingest.jl")
    include("test_query.jl")
    include("test_integration.jl")
    include("test_server.jl")
end
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass, including `GET /health` and `GET /sources`.

- [ ] **Step 7: Commit**

```bash
git add TomeRAG.jl/src/server.jl TomeRAG.jl/src/TomeRAG.jl \
        TomeRAG.jl/test/test_server.jl TomeRAG.jl/test/runtests.jl
git commit -m "feat(tomerag): REST server skeleton — /health and /sources"
```

---

## Task 6: /query and /filter endpoints

**Files:**
- Modify: `TomeRAG.jl/src/server.jl`
- Modify: `TomeRAG.jl/test/test_server.jl`

> **Note:** The REST server uses `MockEmbeddingBackend` for all embedding operations since the server must be self-contained for testing. In a real consuming project, the server would be configured with an `OllamaBackend`. The server stores the embed_backend in a closure when `_setup_routes!` is called.

For Plan 2, `serve` accepts an optional `embed_backend` kwarg (defaulting to `nothing`; endpoints that require embedding return 501 if none provided, but in tests we pass a `MockEmbeddingBackend`).

- [ ] **Step 1: Write failing tests**

In `TomeRAG.jl/test/test_server.jl`, replace the `_test_registry` helper and `@testset "REST API"` with this extended version that passes `embed_backend` to `serve` and includes `/query` and `/filter` tests:

```julia
using Test
using TomeRAG
using HTTP
using JSON3

function _test_registry()
    db_path = tempname() * ".duckdb"
    src = Source(
        id = "test-src",
        name = "Test Source",
        system = "PbtA",
        db_path = db_path,
        embedding_model = "mock",
        embedding_dim = 8,
        license = :homebrew,
        chunking = ChunkingConfig(min_tokens=1, max_tokens=200),
        content_types = DEFAULT_CONTENT_TYPES,
    )
    reg = SourceRegistry()
    register_source!(reg, src)
    initialize_store(src)

    md = tempname() * ".md"
    write(md, """
    # Moves
    ## Face Danger
    **When you attempt something risky**, roll +attr. On a 10+, you succeed.
    ## Swear an Iron Vow
    **When you swear upon iron**, roll +heart. On a miss, the vow is imperilled.
    # Lore
    ## The Iron World
    A world of blasted heaths, dark forests, and ancient ruins.
    """)
    ingest!(reg, "test-src", md;
            doc_id = "test-doc", document_type = :core_rules, format = :markdown,
            embed_backend = MockEmbeddingBackend(dim=8),
            classify_backend = HeuristicBackend())
    return reg
end

@testset "REST API" begin
    test_port = 18080
    reg = _test_registry()
    backend = MockEmbeddingBackend(dim=8)
    server = serve(reg; port=test_port, async=true, embed_backend=backend)
    sleep(1.0)
    base = "http://localhost:$test_port"

    try
        @testset "GET /health" begin
            r = HTTP.get("$base/health")
            @test r.status == 200
            body = JSON3.read(r.body, Dict{String,Any})
            @test body["status"] == "ok"
        end

        @testset "GET /sources" begin
            r = HTTP.get("$base/sources")
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) == 1
            @test body[1]["id"] == "test-src"
        end

        @testset "GET /sources/:id" begin
            r = HTTP.get("$base/sources/test-src")
            @test r.status == 200
            body = JSON3.read(r.body, Dict{String,Any})
            @test body["chunk_count"] >= 1

            r404 = HTTP.get("$base/sources/no-such-source"; status_exception=false)
            @test r404.status == 404
        end

        @testset "POST /query" begin
            payload = JSON3.write(Dict(
                "text"   => "iron vow swear",
                "source" => "test-src",
                "top_k"  => 2,
            ))
            r = HTTP.post("$base/query",
                          ["Content-Type" => "application/json"], payload)
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) >= 1
            @test haskey(body[1], "text")
            @test haskey(body[1], "score")
            @test haskey(body[1], "rank")

            # Missing source → 400
            bad = HTTP.post("$base/query",
                            ["Content-Type" => "application/json"],
                            JSON3.write(Dict("text" => "hello"));
                            status_exception=false)
            @test bad.status == 400
        end

        @testset "POST /filter" begin
            payload = JSON3.write(Dict(
                "source"       => "test-src",
                "top_k"        => 10,
            ))
            r = HTTP.post("$base/filter",
                          ["Content-Type" => "application/json"], payload)
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) >= 1
            @test haskey(body[1], "text")

            # Filter by content_type
            move_payload = JSON3.write(Dict(
                "source"       => "test-src",
                "content_type" => "move",
                "top_k"        => 10,
            ))
            r2 = HTTP.post("$base/filter",
                           ["Content-Type" => "application/json"], move_payload)
            @test r2.status == 200
            moves = JSON3.read(r2.body, Vector{Dict{String,Any}})
            @test all(m["content_type"] == "move" for m in moves)
        end

    finally
        close(server)
    end
end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `serve` does not accept `embed_backend` keyword

- [ ] **Step 3: Update serve() and add /query + /filter routes**

Replace `TomeRAG.jl/src/server.jl` entirely with:

```julia
using Oxygen
using HTTP
using JSON3

"""
    serve(registry; port=8080, async=false, embed_backend=nothing)

Start the TomeRAG REST API server.
- `async=true` returns a closeable handle (use `close(server)` to stop).
- `embed_backend` is required for endpoints that embed text (/query, /lookup, /multi_query).
  Pass a `MockEmbeddingBackend` for tests or an `OllamaBackend` for production.
"""
function serve(registry::SourceRegistry;
               port::Int=8080,
               async::Bool=false,
               embed_backend::Union{EmbeddingBackend,Nothing}=nothing)
    _setup_routes!(registry, embed_backend)
    if async
        return Oxygen.serveasync(; host="127.0.0.1", port=port)
    else
        Oxygen.serve(; host="0.0.0.0", port=port)
    end
end

function _setup_routes!(registry::SourceRegistry,
                        embed_backend::Union{EmbeddingBackend,Nothing})

    @get "/health" function(req::HTTP.Request)
        return Dict("status" => "ok")
    end

    @get "/sources" function(req::HTTP.Request)
        return [_source_info(src) for src in values(registry.sources)]
    end

    @get "/sources/{id}" function(req::HTTP.Request, id::String)
        if !haskey(registry.sources, id)
            return _error(404, "source not found: $id")
        end
        src = get_source(registry, id)
        stats = source_stats(src)
        return merge(_source_info(src), Dict("chunk_count" => stats.chunk_count))
    end

    @post "/query" function(req::HTTP.Request)
        isnothing(embed_backend) && return _error(501, "no embed_backend configured")
        body = try JSON3.read(req.body, Dict{String,Any}) catch; return _error(400, "invalid JSON") end
        haskey(body, "text")   || return _error(400, "missing field: text")
        haskey(body, "source") || return _error(400, "missing field: source")
        source = body["source"]
        haskey(registry.sources, source) || return _error(404, "source not found: $source")
        top_k          = Int(get(body, "top_k", 5))
        score_threshold = Float32(get(body, "score_threshold", 0.0))
        content_type   = haskey(body, "content_type")   ? Symbol(body["content_type"])   : nothing
        document_type  = haskey(body, "document_type")  ? Symbol(body["document_type"])  : nothing
        mode           = haskey(body, "mode")            ? Symbol(body["mode"])           : :hybrid
        results = query(registry, String(body["text"]);
                        source=source, content_type=content_type,
                        document_type=document_type, top_k=top_k,
                        score_threshold=score_threshold,
                        embed_backend=embed_backend, mode=mode)
        return [_result_dict(r) for r in results]
    end

    @post "/filter" function(req::HTTP.Request)
        body = try JSON3.read(req.body, Dict{String,Any}) catch; return _error(400, "invalid JSON") end
        haskey(body, "source") || return _error(400, "missing field: source")
        source = body["source"]
        haskey(registry.sources, source) || return _error(404, "source not found: $source")
        content_type  = haskey(body, "content_type")  ? Symbol(body["content_type"])  : nothing
        document_type = haskey(body, "document_type") ? Symbol(body["document_type"]) : nothing
        top_k  = Int(get(body, "top_k", 100))
        offset = Int(get(body, "offset", 0))
        chunks = filter_chunks(registry, source;
                               content_type=content_type, document_type=document_type,
                               top_k=top_k, offset=offset)
        return [_chunk_dict(c) for c in chunks]
    end
end

# ── Helpers ───────────────────────────────────────────────────────────────────

function _error(status::Int, msg::String)
    return HTTP.Response(status,
        ["Content-Type" => "application/json"],
        JSON3.write(Dict("error" => msg)))
end

function _source_info(src::Source)
    return Dict(
        "id"              => src.id,
        "name"            => src.name,
        "system"          => src.system,
        "embedding_model" => src.embedding_model,
        "embedding_dim"   => src.embedding_dim,
        "license"         => String(src.license),
    )
end

function _chunk_dict(c::Chunk)
    return Dict(
        "id"            => c.id,
        "source_id"     => c.source_id,
        "doc_id"        => c.doc_id,
        "text"          => c.text,
        "content_type"  => String(c.content_type),
        "document_type" => String(c.document_type),
        "heading_path"  => c.heading_path,
        "page"          => c.page,
        "tags"          => c.tags,
        "move_trigger"  => c.move_trigger,
        "chunk_order"   => c.chunk_order,
    )
end

function _result_dict(r::QueryResult)
    return merge(_chunk_dict(r.chunk), Dict("score" => r.score, "rank" => r.rank))
end
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass including `POST /query` and `POST /filter`.

- [ ] **Step 5: Commit**

```bash
git add TomeRAG.jl/src/server.jl TomeRAG.jl/test/test_server.jl
git commit -m "feat(tomerag): REST /query and /filter endpoints"
```

---

## Task 7: /lookup, /multi_query, /chunk/:id, /chunk/:id/context endpoints

**Files:**
- Modify: `TomeRAG.jl/src/server.jl`
- Modify: `TomeRAG.jl/test/test_server.jl`

- [ ] **Step 1: Write failing tests**

In `TomeRAG.jl/test/test_server.jl`, add these testsets inside the `try` block (before `finally`):

```julia
        @testset "GET /lookup" begin
            r = HTTP.get("$base/lookup?name=Iron+Vow&source=test-src")
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) >= 1
            @test any(occursin("iron", lowercase(b["text"])) for b in body)

            # Missing name → 400
            bad = HTTP.get("$base/lookup?source=test-src"; status_exception=false)
            @test bad.status == 400
        end

        @testset "POST /multi_query" begin
            payload = JSON3.write(Dict(
                "queries" => [
                    Dict("text" => "iron vow heart", "source" => "test-src"),
                    Dict("text" => "face danger risk", "source" => "test-src"),
                ],
                "top_k" => 5,
            ))
            r = HTTP.post("$base/multi_query",
                          ["Content-Type" => "application/json"], payload)
            @test r.status == 200
            body = JSON3.read(r.body, Vector{Dict{String,Any}})
            @test length(body) >= 1
            ids = [b["id"] for b in body]
            @test length(ids) == length(unique(ids))  # no duplicates
        end

        @testset "GET /chunk/:id and /chunk/:id/context" begin
            # First get a chunk id via /filter
            fr = HTTP.post("$base/filter",
                           ["Content-Type" => "application/json"],
                           JSON3.write(Dict("source" => "test-src", "top_k" => 1)))
            first_chunk = JSON3.read(fr.body, Vector{Dict{String,Any}})[1]
            chunk_id = first_chunk["id"]

            # Fetch single chunk
            r = HTTP.get("$base/chunk/$chunk_id")
            @test r.status == 200
            body = JSON3.read(r.body, Dict{String,Any})
            @test body["id"] == chunk_id

            # 404 for unknown
            r404 = HTTP.get("$base/chunk/no-such-id"; status_exception=false)
            @test r404.status == 404

            # Fetch context
            rc = HTTP.get("$base/chunk/$chunk_id/context?source=test-src&before=1&after=1")
            @test rc.status == 200
            ctx = JSON3.read(rc.body, Vector{Dict{String,Any}})
            @test length(ctx) >= 1
            @test any(c["id"] == chunk_id for c in ctx)
        end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: FAIL — `/lookup`, `/multi_query`, `/chunk/:id` not defined

- [ ] **Step 3: Add routes to server.jl**

Inside `_setup_routes!` in `TomeRAG.jl/src/server.jl`, append after the `@post "/filter"` block:

```julia
    @get "/lookup" function(req::HTTP.Request)
        isnothing(embed_backend) && return _error(501, "no embed_backend configured")
        params = HTTP.queryparams(req.target)
        haskey(params, "name")   || return _error(400, "missing query param: name")
        haskey(params, "source") || return _error(400, "missing query param: source")
        source = params["source"]
        haskey(registry.sources, source) || return _error(404, "source not found: $source")
        content_type = haskey(params, "content_type") ? Symbol(params["content_type"]) : nothing
        results = lookup(registry, params["name"];
                         source=source, content_type=content_type)
        return [_result_dict(r) for r in results]
    end

    @post "/multi_query" function(req::HTTP.Request)
        isnothing(embed_backend) && return _error(501, "no embed_backend configured")
        body = try JSON3.read(req.body, Dict{String,Any}) catch; return _error(400, "invalid JSON") end
        haskey(body, "queries") || return _error(400, "missing field: queries")
        top_k = Int(get(body, "top_k", 10))
        queries = Tuple{String,NamedTuple}[]
        for q in body["queries"]
            haskey(q, "text")   || return _error(400, "each query needs 'text'")
            haskey(q, "source") || return _error(400, "each query needs 'source'")
            source = String(q["source"])
            haskey(registry.sources, source) || return _error(404, "source not found: $source")
            kwargs = (source=source,)
            push!(queries, (String(q["text"]), kwargs))
        end
        results = multi_query(registry, queries;
                              embed_backend=embed_backend, top_k=top_k)
        return [_result_dict(r) for r in results]
    end

    @get "/chunk/{id}" function(req::HTTP.Request, id::String)
        for src in values(registry.sources)
            db = DBInterface.connect(DuckDB.DB, src.db_path)
            try
                DuckDB.execute(db, "LOAD fts;")
                for row in DuckDB.execute(db,
                        """SELECT id, source_id, doc_id, doc_path, text,
                                  embedding::FLOAT[] AS embedding,
                                  embedding_model, token_count, content_hash,
                                  document_type, system, edition, page,
                                  heading_path, chunk_order, parent_id,
                                  content_type, tags, move_trigger,
                                  scene_type, encounter_key, npc_name, license
                           FROM chunks WHERE id = ? LIMIT 1""",
                        (id,))
                    return _chunk_dict(_row_to_chunk(row))
                end
            finally
                DBInterface.close!(db)
            end
        end
        return _error(404, "chunk not found: $id")
    end

    @get "/chunk/{id}/context" function(req::HTTP.Request, id::String)
        params = HTTP.queryparams(req.target)
        haskey(params, "source") || return _error(400, "missing query param: source")
        source = params["source"]
        haskey(registry.sources, source) || return _error(404, "source not found: $source")
        before = haskey(params, "before") ? parse(Int, params["before"]) : 1
        after  = haskey(params, "after")  ? parse(Int, params["after"])  : 1
        chunks = get_context(registry, id; source=source, before=before, after=after)
        return [_chunk_dict(c) for c in chunks]
    end
```

Also add `using DBInterface` at the top of server.jl (needed for the chunk scan in `/chunk/:id`):

The top of `TomeRAG.jl/src/server.jl` should read:
```julia
using Oxygen
using HTTP
using JSON3
using DBInterface
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```
Expected: all tests pass. Total test count should be > 91.

- [ ] **Step 5: Commit**

```bash
git add TomeRAG.jl/src/server.jl TomeRAG.jl/test/test_server.jl
git commit -m "feat(tomerag): REST /lookup, /multi_query, /chunk endpoints"
```

---

## Final Verification

After all tasks complete, run the full test suite one final time:

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all testsets pass (91 Plan 1 tests + new Plan 2 tests).

Then tag:

```bash
git tag tomerag-plan-2-complete
```
