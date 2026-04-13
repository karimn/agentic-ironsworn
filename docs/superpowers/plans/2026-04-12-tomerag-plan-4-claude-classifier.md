# TomeRAG.jl Plan 4 — ClaudeBackend Classifier

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ClaudeBackend` classifier that batches chunk classification through the Claude API, with cost forecasting via `forecast_cost`, and migrate API key management to `Preferences.jl` for both `ClaudeBackend` and `VisionBackend`.

**Architecture:** `classify_batch(backend, raws)` is added as the new dispatch point in `ingest!` (default loops over `classify`; `ClaudeBackend` overrides to batch N chunks per API call). `_get_anthropic_key()` reads from `Preferences.jl` first, env var second. `forecast_cost` uses `AnthropicSDK.count_tokens` for exact input token counts and the LiteLLM community pricing JSON for cost-per-token rates.

**Tech Stack:** Julia 1.10+, `AnthropicSDK` (github.com/karimn/anthropic-sdk-julia), `Preferences.jl` (stdlib), `HTTP.jl` + `JSON3.jl` (already deps).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `TomeRAG.jl/Project.toml` | Modify | Add `AnthropicSDK` (GitHub URL), `Preferences` stdlib dep + compat |
| `TomeRAG.jl/src/backends.jl` | Modify | Add `_get_anthropic_key()`, `classify_batch` default, `ClaudeBackend`, `_build_system_prompt`, `_build_batch_prompt`, `_parse_classification`, `classify_batch` ClaudeBackend override, `classify` single-item delegate, `CostEstimate`, `_fetch_pricing`, `_model_pricing`, `forecast_cost` |
| `TomeRAG.jl/src/extraction.jl` | Modify | Change `VisionBackend` `api_key` default from `get(ENV,...)` to `_get_anthropic_key()` |
| `TomeRAG.jl/src/ingest.jl` | Modify | Replace `classify` list comprehension with `classify_batch(classify_backend, raws)` |
| `TomeRAG.jl/src/TomeRAG.jl` | Modify | Export `ClaudeBackend`, `classify_batch`, `CostEstimate`, `forecast_cost` |
| `TomeRAG.jl/test/test_backends.jl` | Modify | Add `_get_anthropic_key`, `classify_batch`, `_build_batch_prompt`, `ClaudeBackend`, `forecast_cost` tests |
| `.gitignore` | Modify | Add `LocalPreferences.toml` |

---

## Task 1: Add AnthropicSDK + Preferences dependencies

**Files:**
- Modify: `TomeRAG.jl/Project.toml`
- Modify: `.gitignore`

- [ ] **Step 1: Add AnthropicSDK via GitHub URL**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.add(url="https://github.com/karimn/anthropic-sdk-julia")'
```

Expected: resolves and installs `AnthropicSDK v0.1.0` plus its deps (`StructTypes`).

- [ ] **Step 2: Add Preferences stdlib**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.add("Preferences")'
```

Expected: adds `Preferences` to `[deps]`.

- [ ] **Step 3: Add compat entries**

Open `TomeRAG.jl/Project.toml`. In the `[compat]` section add:

```toml
AnthropicSDK = "0.1"
Preferences = "1"
```

- [ ] **Step 4: Verify both load**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using AnthropicSDK; using Preferences; println("OK")'
```

Expected: prints `OK`.

- [ ] **Step 5: Add LocalPreferences.toml to .gitignore**

Read `/media/karim/Code-Drive/karimn-code/rpg-rules/.gitignore` first. Append:

```
LocalPreferences.toml
```

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/Project.toml TomeRAG.jl/Manifest.toml .gitignore
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "deps(tomerag): add AnthropicSDK + Preferences; gitignore LocalPreferences.toml

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `_get_anthropic_key()` helper + VisionBackend update

**Files:**
- Modify: `TomeRAG.jl/src/backends.jl`
- Modify: `TomeRAG.jl/src/extraction.jl`
- Modify: `TomeRAG.jl/test/test_backends.jl`

- [ ] **Step 1: Write failing test**

Read `TomeRAG.jl/test/test_backends.jl` first. Append:

```julia
using TomeRAG: _get_anthropic_key

@testset "_get_anthropic_key — reads from ANTHROPIC_API_KEY env var" begin
    withenv("ANTHROPIC_API_KEY" => "sk-test-from-env") do
        @test _get_anthropic_key() == "sk-test-from-env"
    end
end

@testset "_get_anthropic_key — errors with helpful message when unset" begin
    withenv("ANTHROPIC_API_KEY" => nothing) do
        err = try
            _get_anthropic_key()
            nothing
        catch e
            e
        end
        @test err isa ErrorException
        @test occursin("set_preferences!", err.msg)
    end
end

@testset "VisionBackend constructs with explicit api_key" begin
    b = VisionBackend(api_key="sk-fake-key")
    @test b.api_key == "sk-fake-key"
end
```

NOTE: The `_get_anthropic_key` error test uses `withenv("ANTHROPIC_API_KEY" => nothing)` — this clears the env var for the duration of the block. If `Preferences` is set on this machine, the test may not catch the error; wrap the assertion in a try/catch as shown above.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `_get_anthropic_key` not defined.

- [ ] **Step 3: Add `_get_anthropic_key()` to backends.jl**

Read `TomeRAG.jl/src/backends.jl`. Add `using Preferences` at the top (with the other `using` statements) and add the helper as the first function in the file, right after the abstract type declarations:

At top of file:
```julia
using SHA
using HTTP
using JSON3
using Preferences
using AnthropicSDK
```

After `function classify end`, add:

```julia
# ---- API key management ------------------------------------------------------

"""
    _get_anthropic_key() -> String

Read the Anthropic API key. Preference `anthropic_api_key` (in `LocalPreferences.toml`)
takes priority over the `ANTHROPIC_API_KEY` environment variable.

To set via Preferences (recommended — survives shell restarts):
    using Preferences
    set_preferences!("TomeRAG", "anthropic_api_key" => "sk-ant-...")
"""
function _get_anthropic_key()
    k = @load_preference("anthropic_api_key", get(ENV, "ANTHROPIC_API_KEY", ""))
    isempty(k) && error(
        "Anthropic API key not set. Run:\n" *
        "  using Preferences\n" *
        "  set_preferences!(\"TomeRAG\", \"anthropic_api_key\" => \"sk-ant-...\")"
    )
    return k
end
```

- [ ] **Step 4: Update VisionBackend api_key default in extraction.jl**

Read `TomeRAG.jl/src/extraction.jl`. Find the `VisionBackend` struct. Change the `api_key` field default:

Old:
```julia
    api_key     :: String = get(ENV, "ANTHROPIC_API_KEY", "")
```

New:
```julia
    api_key     :: String = _get_anthropic_key()
```

NOTE: `_get_anthropic_key()` is defined in `backends.jl` which is included after `extraction.jl` in `TomeRAG.jl`. This is safe because Julia `@kwdef` defaults are evaluated at construction time (when `VisionBackend()` is called), not at include time. By construction time, `_get_anthropic_key` is in the module namespace.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass including new `_get_anthropic_key` tests.

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/backends.jl TomeRAG.jl/src/extraction.jl \
      TomeRAG.jl/test/test_backends.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): Preferences.jl API key management for VisionBackend + ClaudeBackend

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `classify_batch` default + `ingest!` update

**Files:**
- Modify: `TomeRAG.jl/src/backends.jl`
- Modify: `TomeRAG.jl/src/ingest.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_backends.jl`

- [ ] **Step 1: Write failing test**

Append to `TomeRAG.jl/test/test_backends.jl`:

```julia
using TomeRAG: classify_batch, RawChunk

@testset "classify_batch default — same result as classify loop" begin
    b = HeuristicBackend()
    raws = [
        RawChunk(heading_path=["Moves", "Iron Vow"],
                 text="**When you swear upon iron**, roll +heart. On a 10+, your vow is strong.",
                 chunk_order=1),
        RawChunk(heading_path=["Bestiary", "Ironclad"],
                 text="HP 15, Armor 2, Attack: Blade 1d6.",
                 chunk_order=2),
        RawChunk(heading_path=["The World", "Geography"],
                 text="The Ironlands stretch far to the north, cold and unforgiving.",
                 chunk_order=3),
    ]

    batch_results  = classify_batch(b, raws)
    single_results = [classify(b; text=r.text, heading_path=r.heading_path) for r in raws]

    @test length(batch_results) == 3
    for i in 1:3
        @test batch_results[i].content_type == single_results[i].content_type
        @test batch_results[i].move_trigger == single_results[i].move_trigger
    end
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `classify_batch` not defined.

- [ ] **Step 3: Add `classify_batch` default to backends.jl**

Read `TomeRAG.jl/src/backends.jl`. After the `function classify end` declaration (and the `_get_anthropic_key` helper you added in Task 2), add:

```julia
"""
    classify_batch(backend, raws) -> Vector{NamedTuple}

Classify a vector of `RawChunk` values. The default implementation calls
`classify` once per chunk; backends may override for batched efficiency.

Each result is a NamedTuple with fields:
`content_type`, `tags`, `move_trigger`, `scene_type`, `encounter_key`, `npc_name`.
"""
function classify_batch(backend::ClassifyBackend, raws::Vector{RawChunk})
    return [classify(backend; text=r.text, heading_path=r.heading_path) for r in raws]
end
```

- [ ] **Step 4: Update ingest.jl**

Read `TomeRAG.jl/src/ingest.jl`. Find the classify section:

```julia
    # Classify all chunks.
    classified = [classify(classify_backend; text=r.text, heading_path=r.heading_path)
                  for r in raws]
```

Replace with:

```julia
    # Classify all chunks (batched — ClaudeBackend overrides for API efficiency).
    classified = classify_batch(classify_backend, raws)
```

- [ ] **Step 5: Export `classify_batch` from TomeRAG.jl**

Read `TomeRAG.jl/src/TomeRAG.jl`. Add `classify_batch` to the exports. Change:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend,
       embed, classify
```

to:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend,
       embed, classify, classify_batch
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass including the new `classify_batch` test.

- [ ] **Step 7: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/backends.jl TomeRAG.jl/src/ingest.jl \
      TomeRAG.jl/src/TomeRAG.jl TomeRAG.jl/test/test_backends.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): classify_batch interface — default loops, ingest! uses it

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: `ClaudeBackend` struct + `classify_batch` override

**Files:**
- Modify: `TomeRAG.jl/src/backends.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_backends.jl`

- [ ] **Step 1: Write failing tests**

Append to `TomeRAG.jl/test/test_backends.jl`:

```julia
using TomeRAG: ClaudeBackend, _build_batch_prompt

@testset "ClaudeBackend — constructs with required fields" begin
    b = ClaudeBackend(
        api_key       = "sk-fake",
        content_types = Set([:move, :mechanic, :lore]),
    )
    @test b.model == "claude-haiku-4-5-20251001"
    @test b.batch_size == 20
    @test :move in b.content_types
end

@testset "_build_batch_prompt — structure" begin
    b = ClaudeBackend(
        api_key       = "sk-fake",
        content_types = Set([:move, :mechanic, :lore]),
        system_hint   = "PbtA",
    )
    raws = [
        RawChunk(heading_path=["Chapter 3", "Iron Vow"],
                 text="**When you swear upon iron**, roll +heart.",
                 chunk_order=1),
        RawChunk(heading_path=["The World"],
                 text="The Ironlands are cold.",
                 chunk_order=2),
    ]
    prompt = _build_batch_prompt(b, raws)
    @test occursin("[1]", prompt)
    @test occursin("[2]", prompt)
    @test occursin("Iron Vow", prompt)
    @test occursin("move", prompt)        # content type listed
    @test occursin("mechanic", prompt)
    @test occursin("content_type", prompt)
    @test occursin("move_trigger", prompt)
end

@testset "ClaudeBackend — classify_batch live (requires API key + TOMERAG_LIVE_TESTS=1)" begin
    if get(ENV, "TOMERAG_LIVE_TESTS", "0") != "1" || !haskey(ENV, "ANTHROPIC_API_KEY")
        @test_skip "Set TOMERAG_LIVE_TESTS=1 and ANTHROPIC_API_KEY to run"
    else
        b = ClaudeBackend(
            content_types = Set([:move, :mechanic, :lore, :stat_block, :table,
                                 :gm_guidance, :flavor, :procedure, :boxed_text]),
            system_hint   = "PbtA",
        )
        raws = [
            RawChunk(heading_path=["Moves", "Iron Vow"],
                     text="**When you swear upon iron**, roll +heart. On a 10+, your vow is strong.",
                     chunk_order=1),
            RawChunk(heading_path=["Bestiary", "Troll"],
                     text="HP 30, Armor 1, Attack: Club 2d6. Regenerates 2 HP per round.",
                     chunk_order=2),
            RawChunk(heading_path=["The World", "History"],
                     text="The Ironlands were settled generations ago by refugees fleeing the Old World.",
                     chunk_order=3),
        ]
        results = classify_batch(b, raws)
        @test length(results) == 3
        for r in results
            @test r.content_type in b.content_types
        end
        # Move chunk should be classified as :move
        @test results[1].content_type == :move
    end
end
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: FAIL — `ClaudeBackend`, `_build_batch_prompt` not defined.

- [ ] **Step 3: Implement ClaudeBackend in backends.jl**

Append to `TomeRAG.jl/src/backends.jl` (after the `HeuristicBackend` section, before the mock extraction backend):

```julia
# ---- ClaudeBackend -----------------------------------------------------------

Base.@kwdef struct ClaudeBackend <: ClassifyBackend
    model         :: String      = "claude-haiku-4-5-20251001"
    api_key       :: String      = _get_anthropic_key()
    batch_size    :: Int         = 20
    content_types :: Set{Symbol}           # required — source-specific valid types
    system_hint   :: String      = ""      # e.g. "PbtA", "YZE" — added to the system prompt
end

function _build_system_prompt(backend::ClaudeBackend)
    hint = isempty(backend.system_hint) ? "" : " ($(backend.system_hint) system)"
    return "You are classifying chunks of text from an RPG rulebook$(hint). " *
           "Return ONLY a JSON array with no commentary, markdown, or code fences."
end

function _build_batch_prompt(backend::ClaudeBackend, batch::Vector{RawChunk})
    types_str = join(sort(collect(backend.content_types), by=string), ", ")
    io = IOBuffer()
    println(io, "Classify these RPG rulebook chunks. Return a JSON array, one object per chunk, in order.")
    println(io)
    println(io, "Valid content_types: $types_str")
    println(io)
    println(io, "Each object must have these fields:")
    println(io, "  content_type  : one of the valid types above (string)")
    println(io, "  tags          : array of relevant keyword strings (may be empty)")
    println(io, "  move_trigger  : the trigger phrase if content_type is \"move\", else null")
    println(io, "  scene_type    : scene category if applicable, else null")
    println(io, "  encounter_key : encounter identifier if applicable, else null")
    println(io, "  npc_name      : NPC name if content_type is \"stat_block\", else null")
    println(io)
    for (i, raw) in enumerate(batch)
        heading = isempty(raw.heading_path) ? "(no heading)" : join(raw.heading_path, " / ")
        println(io, "[$i] heading: $heading")
        println(io, "text: $(raw.text)")
        println(io)
    end
    return String(take!(io))
end

function _parse_classification(item)
    ct = get(item, "content_type", nothing)
    content_type = isnothing(ct) ? :mechanic : Symbol(ct)

    raw_tags = get(item, "tags", nothing)
    tags = isnothing(raw_tags) ? String[] : String[String(t) for t in raw_tags]

    raw_trigger = get(item, "move_trigger", nothing)
    move_trigger = (isnothing(raw_trigger) || raw_trigger == "null") ? nothing : String(raw_trigger)

    raw_scene = get(item, "scene_type", nothing)
    scene_type = (isnothing(raw_scene) || raw_scene == "null") ? nothing : Symbol(raw_scene)

    raw_enc = get(item, "encounter_key", nothing)
    encounter_key = (isnothing(raw_enc) || raw_enc == "null") ? nothing : String(raw_enc)

    raw_npc = get(item, "npc_name", nothing)
    npc_name = (isnothing(raw_npc) || raw_npc == "null") ? nothing : String(raw_npc)

    return (content_type=content_type, tags=tags, move_trigger=move_trigger,
            scene_type=scene_type, encounter_key=encounter_key, npc_name=npc_name)
end

function classify_batch(backend::ClaudeBackend, raws::Vector{RawChunk})
    isempty(raws) && return NamedTuple[]
    fallback = HeuristicBackend()
    client   = Anthropic(api_key=backend.api_key)
    system   = _build_system_prompt(backend)
    results  = Vector{NamedTuple}(undef, length(raws))

    for chunk_start in 1:backend.batch_size:length(raws)
        batch = raws[chunk_start:min(chunk_start + backend.batch_size - 1, length(raws))]
        prompt = _build_batch_prompt(backend, batch)
        try
            resp = create(client.messages;
                          model    = backend.model,
                          messages = [Message("user", prompt)],
                          max_tokens = 2048,
                          system   = system)
            text   = resp.content[1].text
            parsed = JSON3.read(text)
            for (i, item) in enumerate(parsed)
                results[chunk_start + i - 1] = _parse_classification(item)
            end
        catch e
            @warn "ClaudeBackend batch failed, using HeuristicBackend fallback" exception=e
            for (i, raw) in enumerate(batch)
                results[chunk_start + i - 1] = classify(fallback; text=raw.text,
                                                         heading_path=raw.heading_path)
            end
        end
    end
    return collect(results)
end

# Single-item classify delegates to classify_batch so ClaudeBackend satisfies the interface.
function classify(backend::ClaudeBackend; text, heading_path)
    raw = RawChunk(heading_path=heading_path, text=text, chunk_order=0)
    return classify_batch(backend, [raw])[1]
end
```

- [ ] **Step 4: Export ClaudeBackend from TomeRAG.jl**

Read `TomeRAG.jl/src/TomeRAG.jl`. Change:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend,
       embed, classify, classify_batch
```

to:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend, ClaudeBackend,
       embed, classify, classify_batch
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass. The live `classify_batch` test is skipped (`@test_skip`).

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/backends.jl TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_backends.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): ClaudeBackend — batched LLM chunk classification

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `CostEstimate` + `forecast_cost`

**Files:**
- Modify: `TomeRAG.jl/src/backends.jl`
- Modify: `TomeRAG.jl/src/TomeRAG.jl`
- Modify: `TomeRAG.jl/test/test_backends.jl`

- [ ] **Step 1: Write failing tests**

Append to `TomeRAG.jl/test/test_backends.jl`:

```julia
using TomeRAG: CostEstimate, forecast_cost

@testset "forecast_cost live (requires ANTHROPIC_API_KEY + TOMERAG_LIVE_TESTS=1)" begin
    if get(ENV, "TOMERAG_LIVE_TESTS", "0") != "1" || !haskey(ENV, "ANTHROPIC_API_KEY")
        @test_skip "Set TOMERAG_LIVE_TESTS=1 and ANTHROPIC_API_KEY to run"
    else
        b = ClaudeBackend(
            content_types = Set([:move, :mechanic, :lore]),
            system_hint   = "PbtA",
        )
        raws = [
            RawChunk(heading_path=["Moves", "Iron Vow"],
                     text="**When you swear upon iron**, roll +heart. On a 10+, your vow is strong.",
                     chunk_order=1),
            RawChunk(heading_path=["The World"],
                     text="The Ironlands are cold and ancient.",
                     chunk_order=2),
            RawChunk(heading_path=["Bestiary", "Troll"],
                     text="HP 30, Armor 1, Attack: Club 2d6.",
                     chunk_order=3),
        ]
        est = forecast_cost(b, raws)
        @test est isa CostEstimate
        @test est.model == b.model
        @test est.n_chunks == 3
        @test est.n_batches == 1            # 3 chunks < batch_size=20
        @test est.input_tokens > 0
        @test est.output_tokens == 3 * 50   # 50 tokens/chunk estimate
        @test est.total_cost_usd > 0.0f0
    end
end
```

- [ ] **Step 2: Run tests to confirm the new test is skipped (not failing)**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass; `forecast_cost` test is skipped.

- [ ] **Step 3: Implement CostEstimate + forecast_cost in backends.jl**

Append to `TomeRAG.jl/src/backends.jl` (after the `ClaudeBackend` section):

```julia
# ---- CostEstimate + forecast_cost --------------------------------------------

"""
    CostEstimate

Estimated API cost for classifying a set of chunks with `ClaudeBackend`.

- `input_tokens`: exact count from Anthropic's `count_tokens` endpoint
- `output_tokens`: estimated at 50 tokens per chunk
- `total_cost_usd`: input + output cost in US dollars
"""
struct CostEstimate
    model          :: String
    n_chunks       :: Int
    n_batches      :: Int
    input_tokens   :: Int
    output_tokens  :: Int
    total_cost_usd :: Float32
end

function Base.show(io::IO, e::CostEstimate)
    @printf(io, "CostEstimate: %d chunks, %d batches | input %d tok + output ~%d tok | \$%.4f (%s)",
            e.n_chunks, e.n_batches, e.input_tokens, e.output_tokens,
            e.total_cost_usd, e.model)
end

# Conservative fallback when LiteLLM pricing fetch fails (Sonnet rates).
const _FALLBACK_PRICING = (input=3.00f0, output=15.00f0)  # USD per MTok

const _PRICING_CACHE = Ref{Union{Dict,Nothing}}(nothing)

function _fetch_pricing()
    isnothing(_PRICING_CACHE[]) || return _PRICING_CACHE[]
    try
        resp = HTTP.get(
            "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
            readtimeout=10, status_exception=false)
        HTTP.iserror(resp) && return nothing
        _PRICING_CACHE[] = JSON3.read(resp.body, Dict)
    catch
        _PRICING_CACHE[] = nothing
    end
    return _PRICING_CACHE[]
end

function _model_pricing(model::String)
    data = _fetch_pricing()
    if !isnothing(data) && haskey(data, model)
        entry = data[model]
        if haskey(entry, :input_cost_per_token) && haskey(entry, :output_cost_per_token)
            return (
                input  = Float32(entry[:input_cost_per_token]  * 1_000_000),
                output = Float32(entry[:output_cost_per_token] * 1_000_000),
            )
        end
    end
    return _FALLBACK_PRICING
end

"""
    forecast_cost(backend, raws) -> CostEstimate

Estimate the cost of classifying `raws` with `backend`. Builds the same batch
prompts `classify_batch` would send, calls `count_tokens` for exact input token
counts, and fetches per-token pricing from the LiteLLM community JSON (cached
per session; falls back to conservative Sonnet rates on failure).

No chunks are classified — this is a read-only preflight operation.
"""
function forecast_cost(backend::ClaudeBackend, raws::Vector{RawChunk})
    isempty(raws) && return CostEstimate(backend.model, 0, 0, 0, 0, 0.0f0)

    client    = Anthropic(api_key=backend.api_key)
    system    = _build_system_prompt(backend)
    total_in  = 0
    n_batches = 0

    for chunk_start in 1:backend.batch_size:length(raws)
        batch  = raws[chunk_start:min(chunk_start + backend.batch_size - 1, length(raws))]
        prompt = _build_batch_prompt(backend, batch)
        tr     = count_tokens(client.messages;
                              model    = backend.model,
                              messages = [Message("user", prompt)],
                              system   = system)
        total_in  += tr.input_tokens
        n_batches += 1
    end

    est_output = length(raws) * 50
    pricing    = _model_pricing(backend.model)
    cost       = Float32(total_in   * pricing.input  / 1_000_000 +
                         est_output * pricing.output / 1_000_000)

    return CostEstimate(backend.model, length(raws), n_batches, total_in, est_output, cost)
end
```

- [ ] **Step 4: Export CostEstimate + forecast_cost from TomeRAG.jl**

Read `TomeRAG.jl/src/TomeRAG.jl`. Change:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend, ClaudeBackend,
       embed, classify, classify_batch
```

to:

```julia
export EmbeddingBackend, ClassifyBackend,
       MockEmbeddingBackend, MockClassifyBackend,
       OllamaBackend, HeuristicBackend, ClaudeBackend,
       embed, classify, classify_batch
export CostEstimate, forecast_cost
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass; `forecast_cost` live test is skipped.

- [ ] **Step 6: Commit**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  add TomeRAG.jl/src/backends.jl TomeRAG.jl/src/TomeRAG.jl \
      TomeRAG.jl/test/test_backends.jl
git -C /media/karim/Code-Drive/karimn-code/rpg-rules \
  commit -m "feat(tomerag): CostEstimate + forecast_cost for ClaudeBackend

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Final verification + tag

- [ ] **Step 1: Run full test suite**

```bash
julia --project=/media/karim/Code-Drive/karimn-code/rpg-rules/TomeRAG.jl \
  -e 'using Pkg; Pkg.test("TomeRAG")'
```

Expected: all tests pass. Broken/skipped: the two live-gated ClaudeBackend tests + the existing VisionBackend live test = 3 skipped total. Test count materially higher than 195 (Plan 3 baseline).

- [ ] **Step 2: Tag**

```bash
git -C /media/karim/Code-Drive/karimn-code/rpg-rules tag tomerag-plan-4-complete
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `Preferences.jl` + `AnthropicSDK` deps | Task 1 |
| `_get_anthropic_key()` — Preferences → ENV fallback | Task 2 |
| `VisionBackend` updated to use `_get_anthropic_key()` | Task 2 |
| `LocalPreferences.toml` gitignored | Task 1 |
| `classify_batch` default implementation | Task 3 |
| `ingest!` uses `classify_batch` | Task 3 |
| `ClaudeBackend` struct with `model`, `api_key`, `batch_size`, `content_types`, `system_hint` | Task 4 |
| `_build_system_prompt` + `_build_batch_prompt` helpers | Task 4 |
| `_parse_classification` for JSON → NamedTuple | Task 4 |
| `classify_batch(::ClaudeBackend, ...)` batching + HeuristicBackend fallback | Task 4 |
| `classify(::ClaudeBackend; ...)` single-item delegate | Task 4 |
| `CostEstimate` struct with all fields | Task 5 |
| `_fetch_pricing()` — LiteLLM JSON, session cache, fallback | Task 5 |
| `forecast_cost` using `count_tokens` for exact input tokens | Task 5 |
| All exports: `ClaudeBackend`, `classify_batch`, `CostEstimate`, `forecast_cost` | Tasks 3, 4, 5 |
| Tests for all offline paths | Tasks 2, 3, 4 |
| Live-gated tests for `classify_batch` + `forecast_cost` | Tasks 4, 5 |
| Final tag | Task 6 |

All spec requirements covered. ✅
