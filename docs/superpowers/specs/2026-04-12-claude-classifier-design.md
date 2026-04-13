# ClaudeBackend Classifier — Design

**Date:** 2026-04-12
**Status:** Approved

---

## Overview

Add a `ClaudeBackend` implementation of `ClassifyBackend` that classifies chunks by calling the Claude API in batches. This replaces or supplements `HeuristicBackend` for production ingestion, giving more accurate `content_type` detection and full metadata extraction (`move_trigger`, `npc_name`, `tags`, etc.) from RPG rulebook content.

Also: migrate API key management from bare environment variables to Julia `Preferences.jl` (with env var fallback), applied to both `ClaudeBackend` and the existing `VisionBackend`. And add a `forecast_cost(backend, raws)` function so callers can estimate API cost before committing to a full ingest.

---

## Design Decisions

**Why batching?**
A 300-page RPG book produces 200–400 chunks. One API call per chunk is slow and expensive. Batching N chunks into a single prompt with a JSON array response cuts API calls by ~20×.

**Why `classify_batch` instead of changing `classify`?**
The existing `classify(backend; text, heading_path)` interface is called one-at-a-time. Adding `classify_batch(backend, raws)` with a default loop implementation means all existing backends work without changes. `ingest!` calls `classify_batch` throughout; `ClaudeBackend` overrides it to batch. Clean extension without breaking the interface.

**Why Preferences.jl?**
Environment variables require setting in every shell session and are easy to forget. `Preferences.jl` stores values in `LocalPreferences.toml` (gitignored) in the project directory. Set once per checkout, works everywhere. Env var is still accepted as fallback for CI and scripts.

**Why LiteLLM pricing JSON for cost estimation?**
Anthropic has no pricing API. The LiteLLM community JSON (`model_prices_and_context_window.json`) covers all Anthropic models with `input_cost_per_token` / `output_cost_per_token`, is actively maintained, and is machine-readable. Fetched once per session and cached in memory. Falls back to a conservative hardcoded default if unreachable.

**Why AnthropicSDK?**
The project already has a Julia Claude SDK at `karimn/anthropic-sdk-julia`. Using it gives cleaner message construction and — critically — access to `count_tokens`, which hits the Anthropic token-counting endpoint for exact input token counts. This makes `forecast_cost` accurate rather than approximate.

---

## New Abstraction: classify_batch

```julia
# Default implementation — existing backends get this for free
function classify_batch(backend::ClassifyBackend, raws::Vector{RawChunk})
    return [classify(backend; text=r.text, heading_path=r.heading_path) for r in raws]
end
```

`ingest!` is updated to call `classify_batch(classify_backend, raws)` instead of the list comprehension.

---

## API Key Management

A shared private helper, used by both `VisionBackend` and `ClaudeBackend`:

```julia
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

`VisionBackend`'s `api_key` field default changes from `get(ENV, "ANTHROPIC_API_KEY", "")` to `_get_anthropic_key()`.

`LocalPreferences.toml` is added to `.gitignore`.

---

## ClaudeBackend

```julia
Base.@kwdef struct ClaudeBackend <: ClassifyBackend
    model         :: String      = "claude-haiku-4-5-20251001"
    api_key       :: String      = _get_anthropic_key()
    batch_size    :: Int         = 20
    content_types :: Set{Symbol}           # required — source-specific valid types
    system_hint   :: String      = ""      # e.g. "PbtA", "YZE" — added to the prompt
end
```

### classify_batch override

Groups `raws` into batches of `batch_size`. For each batch, builds a user message:

```
Classify these RPG rulebook chunks. Return a JSON array, one object per chunk, in order.

Valid content_types: move, mechanic, lore, table, stat_block, gm_guidance, flavor,
                     procedure, boxed_text, ...

Each object must have these fields:
  content_type  : one of the valid types above (string)
  tags          : array of relevant keyword strings (may be empty)
  move_trigger  : the trigger phrase if content_type is "move", else null
  scene_type    : scene category symbol if applicable, else null
  encounter_key : encounter identifier if applicable, else null
  npc_name      : NPC name if content_type is "stat_block", else null

[1] heading: ["Chapter 3 / Vows", "Iron Vow"]
text: **When you swear upon iron**, roll +heart...

[2] heading: ["Bestiary", "Ironclad"]
text: HP 15, Armor 2, Attack: Blade 1d6...
```

The system prompt carries RPG genre context and `system_hint` if set.

Uses `AnthropicSDK`: `create(client.messages; model, messages, max_tokens, system)`.

Response is parsed with `JSON3`. If JSON parsing fails for a batch, each chunk in that batch falls back to `HeuristicBackend` classification.

### single classify fallback

`classify(backend::ClaudeBackend; text, heading_path)` is implemented as a one-item `classify_batch` call — so `ClaudeBackend` still satisfies the `ClassifyBackend` interface for callers that use `classify` directly.

---

## CostEstimate + forecast_cost

```julia
struct CostEstimate
    model          :: String
    n_chunks       :: Int
    n_batches      :: Int
    input_tokens   :: Int      # exact — from count_tokens API
    output_tokens  :: Int      # estimated: 50 tokens × n_chunks
    total_cost_usd :: Float32
end
```

```julia
forecast_cost(backend::ClaudeBackend, raws::Vector{RawChunk}) -> CostEstimate
```

Steps:
1. Build the same batch prompts `classify_batch` would send.
2. Call `count_tokens(client.messages; model, messages, system)` for each batch (no generation).
3. Sum input tokens across all batches.
4. Estimate output tokens at 50 per chunk.
5. Fetch per-token pricing from the LiteLLM JSON (cached for the session); fall back to conservative defaults on failure.
6. Return `CostEstimate`.

### Pricing fetch

```julia
const _PRICING_CACHE = Ref{Union{Dict,Nothing}}(nothing)

function _fetch_pricing()
    isnothing(_PRICING_CACHE[]) || return _PRICING_CACHE[]
    try
        resp = HTTP.get("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
                        readtimeout=10, status_exception=false)
        HTTP.iserror(resp) && return nothing
        _PRICING_CACHE[] = JSON3.read(resp.body, Dict)
    catch
        _PRICING_CACHE[] = nothing
    end
    return _PRICING_CACHE[]
end
```

Fallback pricing (conservative — Sonnet rates):
```julia
const _FALLBACK_PRICING = (input=3.00f0, output=15.00f0)  # USD per MTok
```

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `TomeRAG.jl/Project.toml` | Modify | Add `AnthropicSDK` (GitHub URL), `Preferences` |
| `TomeRAG.jl/src/backends.jl` | Modify | Add `_get_anthropic_key()`, `classify_batch` default, `ClaudeBackend`, `CostEstimate`, `forecast_cost`, `_fetch_pricing`. Update `VisionBackend` default api_key |
| `TomeRAG.jl/src/ingest.jl` | Modify | Replace classify list comprehension with `classify_batch(classify_backend, raws)` |
| `TomeRAG.jl/src/TomeRAG.jl` | Modify | Export `ClaudeBackend`, `CostEstimate`, `classify_batch`, `forecast_cost` |
| `TomeRAG.jl/test/test_backends.jl` | Create | `forecast_cost` test (live-gated), `classify_batch` with `ClaudeBackend` (live-gated) |
| `TomeRAG.jl/test/runtests.jl` | Modify | Include `test_backends.jl` |
| `.gitignore` | Modify | Add `LocalPreferences.toml` |

---

## Testing Strategy

**`test_backends.jl` covers:**

- `forecast_cost`: live-gated (`ANTHROPIC_API_KEY + TOMERAG_LIVE_TESTS=1`). Passes 3 canned `RawChunk` values, asserts `CostEstimate` has positive token counts, positive cost, and correct model name.
- `classify_batch` with `ClaudeBackend`: live-gated. Sends 3 chunks (a move, a stat block, a lore paragraph), asserts each returned `content_type` is a member of the backend's `content_types` set.
- `classify_batch` with `HeuristicBackend`: offline. Asserts the default `classify_batch` implementation produces the same results as calling `classify` in a loop.

**Existing tests unaffected:** `HeuristicBackend`, `MockClassifyBackend`, and `ingest!` tests all continue to pass — the default `classify_batch` delegates to `classify`, preserving existing behaviour.

---

## Scope

**In scope:**
- `ClaudeBackend` with batched `classify_batch` override
- `CostEstimate` + `forecast_cost` with live token counting and LiteLLM pricing
- `Preferences.jl` key management for `ClaudeBackend` and `VisionBackend`
- `ingest!` updated to use `classify_batch`

**Out of scope:**
- Caching classifications to disk (avoids re-classifying on re-ingest)
- Streaming responses (not needed for batch JSON)
- OpenAI embedding backend (previously deferred, still deferred)
