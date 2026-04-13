# TomeRAG.jl Plan 3 — PDF Ingestion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pluggable PDF ingestion to TomeRAG.jl via an `ExtractionBackend` abstraction, with a Claude Haiku vision backend for high-quality extraction and a Poppler-based fallback, plus a transparent disk cache and a markdown table atomicity fix in the chunker.

**Architecture:** New `extraction.jl` adds `ExtractionBackend`/`PageText`/`extract_pages` (mirrors `EmbeddingBackend` pattern). `VisionBackend` renders pages with `pdftoppm` and calls the Anthropic messages API. `PopplerBackend` runs `pdftotext`. `CachingBackend` wraps any backend and saves per-page text keyed by PDF content hash. `ingest!` gains an `extraction_backend` kwarg and `format=:auto` detection; injected page markers (`<!-- page N -->`) are stripped post-chunking to populate `chunk.page`.

**Tech Stack:** Julia 1.10+, Poppler_jll (pdftoppm + pdftotext), HTTP.jl + JSON3.jl (Anthropic API — already deps), SHA.jl (already a dep), Base64 stdlib, Printf stdlib.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `TomeRAG.jl/Project.toml` | Modify | Add `Poppler_jll` dep + compat |
| `TomeRAG.jl/src/extraction.jl` | Create | `ExtractionBackend`, `PageText`, `extract_pages`, `extract_page`, `PopplerBackend`, `CachingBackend`, `VisionBackend`, private helpers |
| `TomeRAG.jl/src/backends.jl` | Modify | Add `MockExtractionBackend` |
| `TomeRAG.jl/src/chunker.jl` | Modify | Replace hard token-cap section with line-aware table-atomic version |
| `TomeRAG.jl/src/ingest.jl` | Modify | `extraction_backend` kwarg, `format=:auto`, page marker injection + `_assign_pages` |
| `TomeRAG.jl/src/TomeRAG.jl` | Modify | `include("extraction.jl")` before `include("backends.jl")`; export new types |
| `TomeRAG.jl/test/test_extraction.jl` | Create | All extraction tests (Mock, Poppler unit, Caching); VisionBackend live-gated |
| `TomeRAG.jl/test/test_chunker.jl` | Modify | Table atomicity tests |
| `TomeRAG.jl/test/test_ingest.jl` | Modify | PDF ingest with MockExtractionBackend, page metadata, `:auto` detection |
| `TomeRAG.jl/test/runtests.jl` | Modify | Include `test_extraction.jl` |

---

## Task 1: Add Poppler_jll dependency

**Files:**
- Modify: `TomeRAG.jl/Project.toml`

- [ ] **Step 1: Add Poppler_jll via Pkg**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.add("Poppler_jll")'
```

Expected: resolves and installs `Poppler_jll`.

- [ ] **Step 2: Add compat entry**

Open `TomeRAG.jl/Project.toml`. In the `[compat]` section add:
```toml
Poppler_jll = "21, 22, 23, 24, 25"
```

- [ ] **Step 3: Verify binaries load**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Poppler_jll; println(pdftotext()); println(pdftoppm()); println(pdfinfo())'
```

Expected: prints three filesystem paths (the JLL-bundled binaries).

- [ ] **Step 4: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/Project.toml TomeRAG.jl/Manifest.toml
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "deps(tomerag): add Poppler_jll for PDF extraction"
```

---

## Task 2: ExtractionBackend interface + PageText + MockExtractionBackend

**Files:**
- Create: `TomeRAG.jl/src/extraction.jl`
- Modify: `TomeRAG.jl/src/backends.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Create: `TomeRAG.jl/test/test_extraction.jl`
- Modify: `TomeRAG.jl/test/runtests.jl`

- [ ] **Step 1: Write failing test**

Create `TomeRAG.jl/test/test_extraction.jl`:

```julia
using Test
using TomeRAG
using TomeRAG: extract_pages, extract_page, PageText

@testset "MockExtractionBackend" begin
    pages = [PageText(1, "# Iron Vow\nRoll +heart."),
             PageText(2, "# Face Danger\nRoll +edge.")]
    b = MockExtractionBackend(pages)

    result = extract_pages(b, "any/path.pdf")
    @test length(result) == 2
    @test result[1].page_num == 1
    @test result[1].text == "# Iron Vow\nRoll +heart."
    @test result[2].page_num == 2
    @test result[2].text == "# Face Danger\nRoll +edge."

    # Default extract_page delegates to extract_pages
    p = extract_page(b, "any/path.pdf", 2)
    @test p.page_num == 2
    @test p.text == "# Face Danger\nRoll +edge."
end
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `ExtractionBackend`, `PageText`, `MockExtractionBackend` not defined.

- [ ] **Step 3: Create extraction.jl**

Create `TomeRAG.jl/src/extraction.jl`:

```julia
using Base64
using Printf
using Poppler_jll
using HTTP
using JSON3

# ── Abstract interface ─────────────────────────────────────────────────────────

abstract type ExtractionBackend end

"""
    PageText

One page of extracted text from a PDF, tagged with its 1-based page number.
"""
Base.@kwdef struct PageText
    page_num :: Int
    text     :: String
end

"""
    extract_pages(backend, pdf_path) -> Vector{PageText}

Extract all pages from `pdf_path` using `backend`. Returns one `PageText` per page,
ordered by page number.
"""
function extract_pages end

"""
    extract_page(backend, pdf_path, page_num) -> PageText

Extract a single page. Default implementation calls `extract_pages` and slices;
backends may override for efficiency.
"""
function extract_page(backend::ExtractionBackend, pdf_path::AbstractString, page_num::Int)
    pages = extract_pages(backend, pdf_path)
    idx = findfirst(p -> p.page_num == page_num, pages)
    idx === nothing && error("page $page_num not found in $pdf_path")
    return pages[idx]
end
```

- [ ] **Step 4: Add MockExtractionBackend to backends.jl**

Append to `TomeRAG.jl/src/backends.jl` (after the `HeuristicBackend` section):

```julia
# ---- mock extraction backend -------------------------------------------------

"""
    MockExtractionBackend(pages)

Returns the given `Vector{PageText}` verbatim, ignoring the pdf_path.
Use in tests to avoid real PDF files or API calls.
"""
struct MockExtractionBackend <: ExtractionBackend
    pages::Vector{PageText}
end

extract_pages(b::MockExtractionBackend, ::AbstractString) = b.pages
```

- [ ] **Step 5: Wire into TomeRAG.jl module**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Add `include("extraction.jl")` as the **first** include (before `include("backends.jl")` — `backends.jl` will reference `ExtractionBackend`):

```julia
module TomeRAG

include("extraction.jl")
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
export ExtractionBackend, PageText, extract_pages, extract_page
export MockExtractionBackend
export split_to_token_budget
export initialize_store, insert_chunks, source_stats, similarity_search, bm25_search
export ingest!
export query, filter_chunks, lookup, multi_query, get_context, get_chunk
export serve

end # module
```

- [ ] **Step 6: Add test_extraction.jl to runtests.jl**

Edit `TomeRAG.jl/test/runtests.jl`. Add `include("test_extraction.jl")` before the closing `end`:

```julia
    include("test_extraction.jl")
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass, including new `MockExtractionBackend` tests.

- [ ] **Step 8: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/extraction.jl TomeRAG.jl/src/backends.jl \
      TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_extraction.jl TomeRAG.jl/test/runtests.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): ExtractionBackend interface + MockExtractionBackend"
```

---

## Task 3: PopplerBackend

**Files:**
- Modify: `TomeRAG.jl/src/extraction.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_extraction.jl`

- [ ] **Step 1: Write failing tests**

Append to `TomeRAG.jl/test/test_extraction.jl`:

```julia
using TomeRAG: _split_pdftext

@testset "PopplerBackend — _split_pdftext unit" begin
    # Form-feed (\f) separates pages in pdftotext output
    output = "Page one content.\fPage two content.\f"
    pages = _split_pdftext(output)
    @test length(pages) == 2
    @test pages[1].page_num == 1
    @test pages[1].text == "Page one content."
    @test pages[2].page_num == 2
    @test pages[2].text == "Page two content."
end

@testset "PopplerBackend — _split_pdftext skips blank pages" begin
    output = "Content\f\f\fMore content"   # two empty pages in the middle
    pages = _split_pdftext(output)
    @test length(pages) == 2
    @test pages[1].text == "Content"
    @test pages[2].text == "More content"
    # page_num reflects original position (3 was skipped, 4 is the second result)
    @test pages[1].page_num == 1
    @test pages[2].page_num == 4
end

@testset "PopplerBackend — extract_page uses -f/-l flags" begin
    # Live test: only runs if TOMERAG_LIVE_TESTS=1 and test fixture exists
    if get(ENV, "TOMERAG_LIVE_TESTS", "0") == "1"
        fixture = joinpath(@__DIR__, "fixtures", "test.pdf")
        if isfile(fixture)
            b = PopplerBackend()
            p = extract_page(b, fixture, 1)
            @test p.page_num == 1
            @test !isempty(p.text)
        else
            @warn "Skipping PopplerBackend live test: test/fixtures/test.pdf not found"
        end
    end
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `_split_pdftext`, `PopplerBackend` not defined.

- [ ] **Step 3: Implement PopplerBackend in extraction.jl**

Append to `TomeRAG.jl/src/extraction.jl` (after the abstract interface section):

```julia
# ── PopplerBackend ─────────────────────────────────────────────────────────────

"""
    PopplerBackend()

Extract text with `pdftotext -layout` (from Poppler_jll). Fast and free; degrades
on multi-column layouts and loses table cell structure. Suitable for single-column
documents.
"""
struct PopplerBackend <: ExtractionBackend end

function _split_pdftext(output::AbstractString)
    raw_pages = split(output, '\f')
    result = PageText[]
    for (i, raw) in enumerate(raw_pages)
        text = strip(raw)
        isempty(text) || push!(result, PageText(i, String(text)))
    end
    return result
end

function extract_pages(::PopplerBackend, pdf_path::AbstractString)
    output = readchomp(`$(pdftotext()) -layout $(pdf_path) -`)
    return _split_pdftext(output)
end

# Override for efficiency: extract one page with -f / -l flags instead of full PDF.
function extract_page(::PopplerBackend, pdf_path::AbstractString, page_num::Int)
    output = readchomp(`$(pdftotext()) -layout -f $page_num -l $page_num $(pdf_path) -`)
    return PageText(page_num, String(strip(output)))
end
```

- [ ] **Step 4: Export PopplerBackend in TomeRAG.jl**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Add `PopplerBackend` to the exports line:

```julia
export ExtractionBackend, PageText, extract_pages, extract_page
export MockExtractionBackend, PopplerBackend
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass including new PopplerBackend unit tests.

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/extraction.jl TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_extraction.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): PopplerBackend — pdftotext extraction"
```

---

## Task 4: CachingBackend

**Files:**
- Modify: `TomeRAG.jl/src/extraction.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_extraction.jl`

- [ ] **Step 1: Write failing tests**

Append to `TomeRAG.jl/test/test_extraction.jl`:

```julia
using TomeRAG: CachingBackend

@testset "CachingBackend — first call extracts and caches" begin
    tmpdir = mktempdir()
    pdf_path = joinpath(tmpdir, "test.pdf")
    write(pdf_path, "fake pdf bytes for hashing")

    pages = [PageText(1, "iron vow text"), PageText(2, "face danger text")]
    inner = MockExtractionBackend(pages)
    cache = CachingBackend(inner, joinpath(tmpdir, "cache"))

    r1 = extract_pages(cache, pdf_path)
    @test length(r1) == 2
    @test r1[1].page_num == 1
    @test r1[1].text == "iron vow text"

    # Cache files must exist on disk
    using SHA
    pdf_hash = bytes2hex(sha256(read(pdf_path)))
    cache_dir = joinpath(tmpdir, "cache", pdf_hash)
    @test isfile(joinpath(cache_dir, "page_001.txt"))
    @test isfile(joinpath(cache_dir, "page_002.txt"))
    @test read(joinpath(cache_dir, "page_001.txt"), String) == "iron vow text"
end

@testset "CachingBackend — second call returns from disk (inner not called again)" begin
    tmpdir = mktempdir()
    pdf_path = joinpath(tmpdir, "test.pdf")
    write(pdf_path, "stable content for hash")

    call_count = Ref(0)

    # Counting mock — increments counter on each extract_pages call
    struct _CountingMock <: ExtractionBackend
        pages::Vector{PageText}
        counter::Ref{Int}
    end
    extract_pages(b::_CountingMock, ::AbstractString) = (b.counter[] += 1; b.pages)

    pages = [PageText(1, "cached text")]
    inner = _CountingMock(pages, call_count)
    cache = CachingBackend(inner, joinpath(tmpdir, "cache"))

    extract_pages(cache, pdf_path)          # populates cache
    @test call_count[] == 1

    extract_pages(cache, pdf_path)          # should read from disk
    @test call_count[] == 1                 # NOT incremented again
end

@testset "CachingBackend — different PDF content → different cache dir" begin
    tmpdir = mktempdir()
    p1 = joinpath(tmpdir, "a.pdf"); write(p1, "pdf content A")
    p2 = joinpath(tmpdir, "b.pdf"); write(p2, "pdf content B")

    pages = [PageText(1, "content")]
    inner = MockExtractionBackend(pages)
    cache = CachingBackend(inner, joinpath(tmpdir, "cache"))

    extract_pages(cache, p1)
    extract_pages(cache, p2)

    using SHA
    h1 = bytes2hex(sha256(read(p1)))
    h2 = bytes2hex(sha256(read(p2)))
    @test h1 != h2
    @test isdir(joinpath(tmpdir, "cache", h1))
    @test isdir(joinpath(tmpdir, "cache", h2))
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `CachingBackend` not defined.

- [ ] **Step 3: Implement CachingBackend in extraction.jl**

Append to `TomeRAG.jl/src/extraction.jl`:

```julia
# ── CachingBackend ─────────────────────────────────────────────────────────────

"""
    CachingBackend(inner, cache_dir)

Transparent wrapper around any `ExtractionBackend`. Pages are saved to disk keyed
by `sha256(pdf_bytes)`, so the cache is valid regardless of filename. On re-ingest
of the same PDF, the inner backend is never called again.

Cache layout:
    cache_dir/<sha256_of_pdf>/page_001.txt
                              page_002.txt
                              ...
"""
struct CachingBackend <: ExtractionBackend
    inner     :: ExtractionBackend
    cache_dir :: String
end

function extract_pages(backend::CachingBackend, pdf_path::AbstractString)
    using SHA
    pdf_hash  = bytes2hex(sha256(read(pdf_path)))
    cache_dir = joinpath(backend.cache_dir, pdf_hash)

    # Try reading fully from cache (sequential page_NNN.txt files).
    if isdir(cache_dir) && isfile(joinpath(cache_dir, "page_001.txt"))
        cached = PageText[]
        i = 1
        while true
            f = joinpath(cache_dir, @sprintf("page_%03d.txt", i))
            isfile(f) || break
            push!(cached, PageText(i, read(f, String)))
            i += 1
        end
        isempty(cached) || return cached
    end

    # Cache miss — delegate to inner backend.
    results = extract_pages(backend.inner, pdf_path)

    mkpath(cache_dir)
    for pt in results
        write(joinpath(cache_dir, @sprintf("page_%03d.txt", pt.page_num)), pt.text)
    end
    return results
end
```

Note: `using SHA` inside a function is valid Julia — SHA is already a package dep.

- [ ] **Step 4: Export CachingBackend in TomeRAG.jl**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Extend the extraction exports line:

```julia
export ExtractionBackend, PageText, extract_pages, extract_page
export MockExtractionBackend, PopplerBackend, CachingBackend
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass including new CachingBackend tests.

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/extraction.jl TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_extraction.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): CachingBackend — disk-based per-PDF page cache"
```

---

## Task 5: VisionBackend

**Files:**
- Modify: `TomeRAG.jl/src/extraction.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_extraction.jl`

- [ ] **Step 1: Write live-gated test**

Append to `TomeRAG.jl/test/test_extraction.jl`:

```julia
@testset "VisionBackend (live — requires ANTHROPIC_API_KEY + TOMERAG_LIVE_TESTS=1)" begin
    if get(ENV, "TOMERAG_LIVE_TESTS", "0") != "1" ||
       !haskey(ENV, "ANTHROPIC_API_KEY")
        @test_skip "Set TOMERAG_LIVE_TESTS=1 and ANTHROPIC_API_KEY to run"
    else
        fixture = joinpath(@__DIR__, "fixtures", "test.pdf")
        if !isfile(fixture)
            @test_skip "test/fixtures/test.pdf not found"
        else
            b = VisionBackend(api_key=ENV["ANTHROPIC_API_KEY"])
            pages = extract_pages(b, fixture)
            @test length(pages) >= 1
            @test all(!isempty(p.text) for p in pages)
            @test pages[1].page_num == 1
        end
    end
end
```

- [ ] **Step 2: Run tests to confirm the new test is skipped (not failing)**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass; VisionBackend test is skipped.

- [ ] **Step 3: Implement VisionBackend in extraction.jl**

Append to `TomeRAG.jl/src/extraction.jl`:

```julia
# ── VisionBackend ──────────────────────────────────────────────────────────────

const _VISION_PROMPT = """This is page {PAGE} of an RPG rulebook. Extract all text \
exactly as written. Format as markdown: use # headings for chapter/section titles, \
## for subsections, **bold** for move names and keywords, > blockquotes for sidebars \
and boxed text, and markdown tables for any tabular content. Preserve the reading \
order. Output only the extracted text, nothing else."""

"""
    VisionBackend(; model, api_key, concurrency, dpi)

Extract PDF pages by rendering each to PNG and sending the image to the Claude messages
API. Handles multi-column layouts, sidebars, and tables that defeat programmatic
extractors.

- `model`: Claude model ID (default: `"claude-haiku-4-5-20251001"`)
- `api_key`: Anthropic API key (default: `ENV["ANTHROPIC_API_KEY"]`)
- `concurrency`: max simultaneous API calls (default: `5`)
- `dpi`: page render resolution (default: `150` — sharp enough, token-efficient)
"""
Base.@kwdef struct VisionBackend <: ExtractionBackend
    model       :: String = "claude-haiku-4-5-20251001"
    api_key     :: String = get(ENV, "ANTHROPIC_API_KEY", "")
    concurrency :: Int    = 5
    dpi         :: Int    = 150
end

function _page_count(pdf_path::AbstractString)
    output = readchomp(`$(pdfinfo()) $(pdf_path)`)
    m = match(r"Pages:\s+(\d+)", output)
    m === nothing && error("could not determine page count for $pdf_path")
    return parse(Int, m[1])
end

function _render_page(backend::VisionBackend, pdf_path::AbstractString, page_num::Int)
    mktempdir() do tmpdir
        prefix = joinpath(tmpdir, "page")
        run(`$(pdftoppm()) -r $(backend.dpi) -f $page_num -l $page_num -png -singlefile \
             $pdf_path $prefix`)
        png_path = prefix * ".png"
        isfile(png_path) || error("pdftoppm did not produce $png_path for page $page_num")
        return read(png_path)
    end
end

function _call_vision_api(backend::VisionBackend, png_bytes::Vector{UInt8}, page_num::Int)
    encoded = base64encode(png_bytes)
    prompt  = replace(_VISION_PROMPT, "{PAGE}" => string(page_num))
    body = Dict(
        "model"      => backend.model,
        "max_tokens" => 4096,
        "messages"   => [Dict(
            "role"    => "user",
            "content" => [
                Dict("type" => "image", "source" => Dict(
                    "type"       => "base64",
                    "media_type" => "image/png",
                    "data"       => encoded,
                )),
                Dict("type" => "text", "text" => prompt),
            ],
        )],
    )
    resp = HTTP.post(
        "https://api.anthropic.com/v1/messages",
        ["x-api-key"         => backend.api_key,
         "anthropic-version" => "2023-06-01",
         "content-type"      => "application/json"],
        JSON3.write(body);
        readtimeout = 120,
    )
    HTTP.iserror(resp) &&
        error("Anthropic API error $(resp.status): $(String(resp.body))")
    result = JSON3.read(resp.body, Dict{String,Any})
    return String(result["content"][1]["text"])
end

# Single-page override — renders and calls API for one page only.
function extract_page(backend::VisionBackend, pdf_path::AbstractString, page_num::Int)
    png_bytes = _render_page(backend, pdf_path, page_num)
    text      = _call_vision_api(backend, png_bytes, page_num)
    return PageText(page_num, text)
end

# Full-document extraction using bounded concurrency.
function extract_pages(backend::VisionBackend, pdf_path::AbstractString)
    n = _page_count(pdf_path)
    results = Vector{Union{PageText,Nothing}}(nothing, n)
    sem     = Base.Semaphore(backend.concurrency)

    @sync for i in 1:n
        @async begin
            Base.acquire(sem)
            try
                results[i] = extract_page(backend, pdf_path, i)
            finally
                Base.release(sem)
            end
        end
    end
    return Vector{PageText}(results)
end
```

- [ ] **Step 4: Export VisionBackend in TomeRAG.jl**

Edit `TomeRAG.jl/src/TomeRAG.jl`. Extend the extraction exports line:

```julia
export ExtractionBackend, PageText, extract_pages, extract_page
export MockExtractionBackend, PopplerBackend, CachingBackend, VisionBackend
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass; VisionBackend test is skipped (no live key set).

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/extraction.jl TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_extraction.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): VisionBackend — Claude Haiku page-image extraction"
```

---

## Task 6: Chunker markdown table atomicity

**Files:**
- Modify: `TomeRAG.jl/src/chunker.jl`
- Modify: `TomeRAG.jl/test/test_chunker.jl`

- [ ] **Step 1: Write failing tests**

Read `TomeRAG.jl/test/test_chunker.jl` first to see the existing test helpers, then append:

```julia
@testset "split_to_token_budget — table kept atomic across token boundary" begin
    # Build a table + padding that exceeds max_tokens when combined.
    # The table alone is ~30 tokens; padded prefix is ~80 tokens → total > 100.
    table = """
| Weapon      | Damage | Weight |
|-------------|--------|--------|
| Iron Sword  | 3      | 1      |
| Bone Spear  | 4      | 2      |
| Blight Blade| 5      | 3      |
"""
    padding = join(fill("word", 80), " ")
    text = padding * "\n\n" * strip(table)

    pieces = split_to_token_budget(text; max_tokens=100, overflow=:paragraph)

    # The table must appear intact in exactly one piece (not split across pieces).
    table_line = "| Iron Sword  | Damage | Weight |"
    pieces_with_table = filter(p -> occursin("Iron Sword", p), pieces)
    @test length(pieces_with_table) == 1          # appears in exactly one piece
    piece = pieces_with_table[1]
    @test occursin("Iron Sword", piece)
    @test occursin("Bone Spear", piece)
    @test occursin("Blight Blade", piece)          # all rows in the same piece
end

@testset "split_to_token_budget — table under max_tokens not split" begin
    table = """
| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |
"""
    # Table is small — should be returned as-is in one piece.
    pieces = split_to_token_budget(strip(table); max_tokens=200)
    @test length(pieces) == 1
    @test occursin("| 3 | 4 |", pieces[1])
end

@testset "split_to_token_budget — large table exceeding max kept whole" begin
    # A table larger than max_tokens should not be split (kept as one over-budget piece).
    rows = join(["| item_$(lpad(i, 3, '0')) | $(i*10) |" for i in 1:100], "\n")
    table = "| Item | Value |\n|------|-------|\n" * rows
    pieces = split_to_token_budget(table; max_tokens=50, overflow=:paragraph)
    # All rows must be in a single piece.
    @test length(filter(p -> occursin("item_001", p), pieces)) == 1
    @test length(filter(p -> occursin("item_100", p), pieces)) == 1
    piece_with_first = only(filter(p -> occursin("item_001", p), pieces))
    @test occursin("item_100", piece_with_first)
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — tables split across chunk boundaries.

- [ ] **Step 3: Fix the hard token-cap section in split_to_token_budget**

In `TomeRAG.jl/src/chunker.jl`, replace lines 94–101 (the hard token cap block):

```julia
    # Hard token cap.
    pieces = String[]
    i = 1
    while i <= length(toks)
        j = min(i + max_tokens - 1, length(toks))
        push!(pieces, join(toks[i:j], " "))
        i = j + 1
    end
    return _apply_overlap(pieces, overlap_tokens)
```

with:

```julia
    # Hard token cap — line-aware, treats markdown table runs as atomic.
    doc_lines  = split(text, '\n'; keepempty = true)
    cur_lines  = String[]
    cur_tokens = 0
    pieces     = String[]
    i_line     = 1

    while i_line <= length(doc_lines)
        line = doc_lines[i_line]

        if startswith(lstrip(line), "|")
            # Collect the entire table run atomically.
            tbl_lines  = String[]
            tbl_tokens = 0
            while i_line <= length(doc_lines) &&
                  startswith(lstrip(doc_lines[i_line]), "|")
                push!(tbl_lines, doc_lines[i_line])
                tbl_tokens += length(split(doc_lines[i_line]))
                i_line += 1
            end
            # Flush current accumulator if table won't fit (unless accumulator is empty).
            if cur_tokens + tbl_tokens > max_tokens && cur_tokens > 0
                push!(pieces, strip(join(cur_lines, "\n")))
                cur_lines  = String[]
                cur_tokens = 0
            end
            # Append table (never split it even if it exceeds max_tokens alone).
            append!(cur_lines, tbl_lines)
            cur_tokens += tbl_tokens
            continue
        end

        line_tokens = length(split(line))
        if cur_tokens + line_tokens > max_tokens && cur_tokens > 0
            push!(pieces, strip(join(cur_lines, "\n")))
            cur_lines  = String[]
            cur_tokens = 0
        end
        push!(cur_lines, line)
        cur_tokens += line_tokens
        i_line += 1
    end
    cur_tokens > 0 && push!(pieces, strip(join(cur_lines, "\n")))
    return _apply_overlap(pieces, overlap_tokens)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass including the three new table atomicity tests.

- [ ] **Step 5: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/chunker.jl TomeRAG.jl/test/test_chunker.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "fix(tomerag): keep markdown tables atomic in token-cap chunker"
```

---

## Task 7: ingest! PDF integration

**Files:**
- Modify: `TomeRAG.jl/src/ingest.jl`
- Modify: `TomeRAG.jl/test/test_ingest.jl`

- [ ] **Step 1: Write failing tests**

Read `TomeRAG.jl/test/test_ingest.jl` first to understand the existing test helpers, then append:

```julia
using TomeRAG: PageText, MockExtractionBackend

@testset "ingest! format=:pdf with MockExtractionBackend" begin
    db_path = tempname() * ".duckdb"
    src = Source(
        id = "pdf-ingest-test",
        name = "PDF Ingest Test",
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

    pdf_path = tempname() * ".pdf"
    write(pdf_path, "fake pdf bytes — content ignored by mock")

    pages = [
        PageText(1, "# Iron Vow\n**When you swear upon iron**, roll +heart. On a 10+, your vow is strong."),
        PageText(2, "# Face Danger\n**When you face danger**, roll +edge. On a miss, pay the price."),
    ]
    extractor = MockExtractionBackend(pages)

    n = ingest!(reg, "pdf-ingest-test", pdf_path;
                doc_id             = "test-rules",
                document_type      = :core_rules,
                format             = :pdf,
                embed_backend      = MockEmbeddingBackend(dim=8),
                classify_backend   = HeuristicBackend(),
                extraction_backend = extractor)

    @test n >= 1
    chunks = filter_chunks(reg, "pdf-ingest-test"; top_k=20)
    @test !isempty(chunks)
    # Page numbers populated from markers
    @test any(c.page == "1" for c in chunks)
    @test any(c.page == "2" for c in chunks)
    # No page markers in chunk text
    @test all(!occursin(r"<!-- page \d+ -->", c.text) for c in chunks)
end

@testset "ingest! format=:auto detects PDF by extension" begin
    db_path = tempname() * ".duckdb"
    src = Source(
        id = "auto-pdf-test",
        name = "Auto Test",
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

    pdf_path = tempname() * ".pdf"        # .pdf extension → auto-detect as :pdf
    write(pdf_path, "placeholder")

    pages = [PageText(1, "# Content\nAuto-detected pdf content.")]
    extractor = MockExtractionBackend(pages)

    n = ingest!(reg, "auto-pdf-test", pdf_path;
                doc_id             = "auto-doc",
                document_type      = :core_rules,
                embed_backend      = MockEmbeddingBackend(dim=8),
                classify_backend   = HeuristicBackend(),
                extraction_backend = extractor)
    @test n >= 1
end

@testset "ingest! format=:auto detects markdown by extension" begin
    db_path = tempname() * ".duckdb"
    src = Source(
        id = "auto-md-test",
        name = "Auto MD Test",
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

    md_path = tempname() * ".md"
    write(md_path, "# Rules\n**When you act**, roll +stat. On a 10+, succeed.")

    # No extraction_backend needed for markdown
    n = ingest!(reg, "auto-md-test", md_path;
                doc_id           = "md-doc",
                document_type    = :core_rules,
                embed_backend    = MockEmbeddingBackend(dim=8),
                classify_backend = HeuristicBackend())
    @test n >= 1
end

@testset "ingest! format=:pdf without extraction_backend raises error" begin
    reg = SourceRegistry()
    @test_throws ErrorException ingest!(reg, "any", "file.pdf";
                                        doc_id           = "x",
                                        document_type    = :core_rules,
                                        format           = :pdf,
                                        embed_backend    = MockEmbeddingBackend(dim=8),
                                        classify_backend = HeuristicBackend())
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `ingest!` does not accept `extraction_backend` and rejects non-`:markdown` format.

- [ ] **Step 3: Update ingest.jl**

Replace the entire contents of `TomeRAG.jl/src/ingest.jl` with:

```julia
using UUIDs

"""
    ingest!(registry, source_id, path; doc_id, document_type,
            format, embed_backend, classify_backend,
            extraction_backend) -> Int

Read `path`, chunk, classify, embed (batched), and insert into the source's
DuckDB store. Returns the number of chunks actually inserted (dedup-aware).

`format` defaults to `:auto` (inferred from file extension: `.pdf` → `:pdf`,
everything else → `:markdown`). Pass `:pdf` or `:markdown` explicitly to override.
`extraction_backend` is required when format resolves to `:pdf`.
"""
function ingest!(registry::SourceRegistry, source_id::AbstractString, path::AbstractString;
                 doc_id::AbstractString,
                 document_type::Symbol,
                 format::Symbol               = :auto,
                 embed_backend::EmbeddingBackend,
                 classify_backend::ClassifyBackend,
                 extraction_backend::Union{ExtractionBackend,Nothing} = nothing)

    src = get_source(registry, source_id)

    # ── Resolve format ────────────────────────────────────────────────────────
    if format === :auto
        ext = lowercase(splitext(String(path))[2])
        format = ext == ".pdf" ? :pdf : :markdown
    end

    # ── Get document text ─────────────────────────────────────────────────────
    local doc_text::String
    if format === :pdf
        isnothing(extraction_backend) &&
            error("extraction_backend is required for format=:pdf")
        pages    = extract_pages(extraction_backend, String(path))
        doc_text = join(
            ["<!-- page $(p.page_num) -->\n$(p.text)" for p in pages],
            "\n\n",
        )
    elseif format === :markdown
        doc_text = read(path, String)
    else
        error("unsupported format: $format (expected :pdf or :markdown)")
    end

    # ── Chunk ─────────────────────────────────────────────────────────────────
    raws = chunk_document(doc_text, src.chunking)
    isempty(raws) && return 0

    # For PDF: extract page numbers from markers, strip markers from text.
    if format === :pdf
        raws = _assign_pages(raws)
    end

    # ── Classify ──────────────────────────────────────────────────────────────
    classified = [classify(classify_backend; text=r.text, heading_path=r.heading_path)
                  for r in raws]

    # ── Embed (batched) ───────────────────────────────────────────────────────
    embeddings = embed(embed_backend, [r.text for r in raws])

    # ── Build Chunk objects ───────────────────────────────────────────────────
    chunks = Chunk[]
    for (i, r) in enumerate(raws)
        cls = classified[i]
        push!(chunks, Chunk(
            id              = string(uuid4()),
            source_id       = src.id,
            doc_id          = String(doc_id),
            doc_path        = abspath(path),
            text            = r.text,
            embedding       = embeddings[i],
            embedding_model = src.embedding_model,
            token_count     = token_count(r.text),
            content_hash    = content_hash(r.text),
            document_type   = document_type,
            system          = src.system,
            edition         = "",
            page            = r.page,
            heading_path    = r.heading_path,
            chunk_order     = r.chunk_order,
            parent_id       = nothing,
            content_type    = cls.content_type,
            tags            = cls.tags,
            move_trigger    = cls.move_trigger,
            scene_type      = cls.scene_type,
            encounter_key   = cls.encounter_key,
            npc_name        = cls.npc_name,
            license         = src.license,
        ))
    end
    return insert_chunks(src, chunks)
end

"""
    _assign_pages(chunks) -> Vector{RawChunk}

Scans each chunk's text for `<!-- page N -->` markers injected during PDF extraction.
Sets `chunk.page` to the last marker found in that chunk's text (the page where the
body content lives). Strips all markers from the returned chunk text.
"""
function _assign_pages(chunks::Vector{RawChunk})
    map(chunks) do rc
        matches = collect(eachmatch(r"<!-- page (\d+) -->", rc.text))
        page    = isempty(matches) ? "" : String(matches[end][1])
        clean   = strip(replace(rc.text, r"<!-- page \d+ -->\n?" => ""))
        RawChunk(
            heading_path = rc.heading_path,
            text         = clean,
            chunk_order  = rc.chunk_order,
            page         = page,
        )
    end
end

_backend_model_name(::MockEmbeddingBackend) = "mock"
_backend_model_name(b::OllamaBackend)       = b.model
_backend_model_name(::EmbeddingBackend)     = ""
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass, including the four new ingest! tests.

- [ ] **Step 5: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/ingest.jl TomeRAG.jl/test/test_ingest.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): PDF ingest via ExtractionBackend + page marker injection"
```

---

## Task 8: Final verification + tag

- [ ] **Step 1: Run full test suite**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass. Count should be materially higher than 148 (Plan 2 baseline).

- [ ] **Step 2: Tag**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules tag tomerag-plan-3-complete
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `ExtractionBackend` abstract type + `PageText` + `extract_pages`/`extract_page` | Task 2 |
| `VisionBackend` — renders pages to PNG, calls Anthropic API, configurable concurrency | Task 5 |
| `PopplerBackend` — pdftotext, per-page `-f/-l` override | Task 3 |
| `CachingBackend` — SHA256 key, per-page disk cache, miss→delegate | Task 4 |
| `MockExtractionBackend` in backends.jl | Task 2 |
| Markdown table atomicity fix in chunker | Task 6 |
| `ingest!` PDF format + `format=:auto` detection | Task 7 |
| Page marker injection + `_assign_pages` strip + `chunk.page` population | Task 7 |
| All exports updated | Tasks 2, 3, 4, 5 |
| Tests for all backends (Mock, Poppler unit, Caching, Vision live-gated) | Tasks 2–5 |
| Tests for table atomicity | Task 6 |
| Tests for ingest! PDF path + auto detection + error case | Task 7 |
| `Poppler_jll` dep added | Task 1 |
| Final tag | Task 8 |

All spec requirements covered. ✅
