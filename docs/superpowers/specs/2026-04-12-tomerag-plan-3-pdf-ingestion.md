# TomeRAG.jl Plan 3 — PDF Ingestion

**Date:** 2026-04-12
**Status:** Approved

---

## Overview

Add PDF ingestion to TomeRAG.jl via a pluggable `ExtractionBackend` abstraction. The primary
backend uses Claude Haiku's vision API to render and extract each PDF page as structured
markdown — correctly handling multi-column layouts, sidebars, tables, and stat blocks that
defeat purely programmatic extractors. A fast fallback backend (`PopplerBackend`) uses
`pdftotext` for simple documents. A transparent `CachingBackend` wrapper ensures each page
is only ever extracted once.

Also fixes a gap in the existing chunker: markdown tables must be treated as atomic blocks
and never split mid-row.

---

## Design Decisions

**Why vision extraction?**
RPG rulebooks (Coriolis, Ironsworn) use complex layouts — two-column text, sidebars, boxed
read-aloud text, and stat-block tables — that no programmatic PDF extractor handles reliably.
Claude Haiku sees the page visually and reconstructs reading order and structure correctly.
Cost: ~$0.50–$1.50 per book, one time only.

**Why pluggable?**
Same pattern as `EmbeddingBackend` and `ClassifyBackend`. Consumers choose the backend that
fits their quality/cost/speed trade-off. New backends (e.g. a local vision model) can be
added without changing the pipeline.

**Why page-level granularity?**
Pages are the natural unit for RPG content: page numbers are meaningful metadata, caching
works cleanly per-page, and parallel Haiku calls map one-to-one to pages.

---

## New Abstraction: ExtractionBackend

```julia
abstract type ExtractionBackend end

struct PageText
    page_num :: Int
    text     :: String   # markdown text extracted from this page
end

# All backends implement:
extract_pages(backend::ExtractionBackend, pdf_path::AbstractString) -> Vector{PageText}
```

---

## Backends

### VisionBackend

Renders each PDF page to PNG via `pdftoppm` (Poppler_jll), then sends the image to
Claude's messages API for structured markdown extraction.

```julia
struct VisionBackend <: ExtractionBackend
    model       :: String   # default: "claude-haiku-4-5-20251001"
    api_key     :: String   # from ENV["ANTHROPIC_API_KEY"]
    concurrency :: Int      # parallel pages in-flight, default 5
    dpi         :: Int      # render resolution, default 150
end

VisionBackend(; model="claude-haiku-4-5-20251001",
                api_key=get(ENV, "ANTHROPIC_API_KEY", ""),
                concurrency=5, dpi=150)
```

**Rendering:** `pdftoppm -r 150 -f N -l N -png <pdf> <prefix>` via `Poppler_jll`.
PNG bytes are base64-encoded in memory — no temp files.

**API call:** `POST https://api.anthropic.com/v1/messages` using HTTP.jl and JSON3.jl
(both already deps). One call per page with an image block.

**Extraction prompt:**

> "This is page {N} of an RPG rulebook. Extract all text exactly as written. Format as
> markdown: use # headings for chapter/section titles, ## for subsections, **bold** for
> move names and keywords, > blockquotes for sidebars and boxed text, and markdown tables
> for any tabular content. Preserve the reading order. Output only the extracted text,
> nothing else."

**Concurrency:** Pages are dispatched with a semaphore capping simultaneous API calls at
`concurrency` (default 5). Results are collected in page order.

### PopplerBackend

Runs `pdftotext -layout` via `Poppler_jll`. Fast and free; degrades on multi-column
layouts and loses table structure. Suitable for simple single-column documents.

```julia
struct PopplerBackend <: ExtractionBackend end
```

Runs `pdftotext` once on the whole PDF, splits on form-feed characters (`\f`) to recover
per-page text, trims whitespace. Page numbers assigned by index.

### CachingBackend

Transparent wrapper around any backend. Skips already-extracted pages on re-ingest.

```julia
struct CachingBackend <: ExtractionBackend
    inner     :: ExtractionBackend
    cache_dir :: String
end
```

**Cache key:** SHA256 of PDF file bytes — cache is valid regardless of file path or name.

**Layout on disk:**
```
<cache_dir>/
└── <sha256_of_pdf>/
    ├── page_001.txt
    ├── page_002.txt
    └── ...
```

**Behaviour:** For each page, check if `page_NNN.txt` exists. Return cached text if present.
Delegate missing pages to `inner` (respecting its concurrency), write results to disk.
On error, no partial cache is written for the failed page.

---

## Chunker Fix: Markdown Table Atomicity

The existing chunker can split a markdown table mid-row when a section exceeds `max_tokens`.
Tables must be treated as atomic blocks.

**Detection:** A markdown table is a contiguous run of lines where every non-blank line
starts with `|`. When the chunker encounters such a run, it treats it as a single unit
that cannot be split — equivalent to how it treats `atomic_patterns` matches.

This is a targeted fix in `chunker.jl`. No changes to `ChunkingConfig` or the `Chunk`
struct.

---

## Integration with ingest!

### Updated signature

```julia
ingest!(registry, source_id, path;
        doc_id,
        document_type,
        format             = :auto,           # :auto, :pdf, :markdown
        embed_backend,
        classify_backend,
        extraction_backend = nothing)         # required when format=:pdf
```

`format = :auto` detects `:pdf` vs `:markdown` from file extension. Existing callers that
pass `format = :markdown` are unaffected.

### PDF path through the pipeline

```
pdf_path
  ↓
extract_pages(extraction_backend, pdf_path)     # Vector{PageText}
  ↓
inject page markers between pages:
  "<!-- page 1 -->\n{text}\n<!-- page 2 -->\n{text}\n..."
  ↓
existing markdown chunker (unchanged except table atomicity fix)
  ↓
page markers stripped; each chunk records the last marker it consumed → chunk.page
```

**Page number assignment:** As the chunker assembles each chunk, it tracks the most recent
`<!-- page N -->` marker consumed. That N becomes `chunk.page`. A heading on page 41 with
body text on page 42 records `page = "42"` — the more useful reference for a reader looking
up the source.

No changes to the `Chunk` struct or DuckDB schema.

### Example

```julia
using TomeRAG

src = Source(
    id = "coriolis", name = "Coriolis: The Great Dark",
    system = "YZE", db_path = "sources/coriolis.duckdb",
    embedding_model = "nomic-embed-text", embedding_dim = 768,
    license = :proprietary,
    chunking = ChunkingConfig(min_tokens=100, max_tokens=600),
    content_types = YZE_CONTENT_TYPES,
)
reg = SourceRegistry()
register_source!(reg, src)
initialize_store(src)

extractor = CachingBackend(
    VisionBackend(api_key=ENV["ANTHROPIC_API_KEY"]),
    cache_dir = ".cache/pdf_pages"
)

ingest!(reg, "coriolis", "coriolis-core.pdf";
        doc_id             = "coriolis-core-1e",
        document_type      = :core_rules,
        embed_backend      = OllamaBackend("nomic-embed-text"),
        classify_backend   = HeuristicBackend(),
        extraction_backend = extractor)
```

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `TomeRAG.jl/Project.toml` | Modify | Add `Poppler_jll` dep + compat |
| `TomeRAG.jl/src/extraction.jl` | Create | `ExtractionBackend`, `PageText`, `VisionBackend`, `PopplerBackend`, `CachingBackend`, `extract_pages` |
| `TomeRAG.jl/src/chunker.jl` | Modify | Markdown table atomicity fix |
| `TomeRAG.jl/src/ingest.jl` | Modify | PDF format detection, `extract_pages` call, page marker injection |
| `TomeRAG.jl/src/TomeRAG.jl` | Modify | `include("extraction.jl")`, export new types |
| `TomeRAG.jl/test/test_extraction.jl` | Create | Tests using `MockExtractionBackend` (no PDF/API required) |
| `TomeRAG.jl/test/test_chunker.jl` | Modify | Tests for table atomicity fix |
| `TomeRAG.jl/test/runtests.jl` | Modify | Include `test_extraction.jl` |

---

## Testing Strategy

**`MockExtractionBackend`** (added to `backends.jl`):
Returns canned `PageText` values without touching any PDF or API. Tests run offline.

```julia
struct MockExtractionBackend <: ExtractionBackend
    pages :: Vector{PageText}   # returned verbatim
end
extract_pages(b::MockExtractionBackend, _) = b.pages
```

**`test_extraction.jl` covers:**
- `PopplerBackend`: runs against a minimal 2-page PDF committed as a binary test fixture
  at `TomeRAG.jl/test/fixtures/test.pdf`
- `CachingBackend`: verifies cache hit/miss behaviour with `MockExtractionBackend`,
  checks disk files are written, checks inner is not called on cache hit
- `VisionBackend`: **skipped unless** `ENV["ANTHROPIC_API_KEY"]` is set and
  `ENV["TOMERAG_LIVE_TESTS"] == "1"` — same gate as the Ollama live tests

**`test_chunker.jl` additions:**
- Table spanning the token boundary is kept atomic (not split)
- Table at start/end of section is kept with its section

**`test_ingest.jl` additions:**
- `ingest!` with `MockExtractionBackend` produces chunks with correct `page` metadata
- Page marker injection and stripping roundtrip correctly
- `:auto` format detection works for `.pdf` and `.md` paths

---

## Scope

**In scope:**
- `extraction.jl` with `VisionBackend`, `PopplerBackend`, `CachingBackend`
- Markdown table atomicity fix in `chunker.jl`
- `ingest!` PDF format support
- `MockExtractionBackend` + tests

**Out of scope (deferred):**
- OCR for image-only pages (playbook art, full-page illustrations)
- Cross-page heading continuation detection (page-spanning stat blocks)
- `ClaudeBackend` for classification (deferred from Plan 2, still deferred)
- OpenAI embedding backend (deferred from Plan 2, still deferred)
