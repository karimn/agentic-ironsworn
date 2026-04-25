"""
extract_structured.jl

Reads the Ironsworn RAG database, sends move/oracle/table chunks through
Claude in batches, and writes structured YAML files for the rules engine.

Output:
  data/ironsworn/moves.yaml
  data/ironsworn/oracles.yaml

Usage:
  julia scripts/extract_structured.jl [--dry-run]

  --dry-run  Connect to DuckDB, print chunk counts, exit without calling Claude.
"""

import Pkg
Pkg.activate(joinpath(@__DIR__, "..", "TomeRAG.jl"))

using DuckDB
using DBInterface
using JSON3
using YAML
using AnthropicSDK
using Preferences

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

const WORKTREE_ROOT = joinpath(@__DIR__, "..")
const DB_PATH       = joinpath(WORKTREE_ROOT, "data", "ironsworn", "ironsworn.duckdb")
const OUT_DIR       = joinpath(WORKTREE_ROOT, "data", "ironsworn")
const MOVES_YAML    = joinpath(OUT_DIR, "moves.yaml")
const ORACLES_YAML  = joinpath(OUT_DIR, "oracles.yaml")

const MODEL         = "claude-haiku-4-5-20251001"
const BATCH_SIZE    = 10

# ---------------------------------------------------------------------------
# API key — mirrors TomeRAG._get_anthropic_key()
# ---------------------------------------------------------------------------

function get_anthropic_key()
    # @load_preference requires the package UUID context; replicate manually.
    prefs_path = joinpath(@__DIR__, "..", "TomeRAG.jl", "LocalPreferences.toml")
    key = ""
    if isfile(prefs_path)
        data = try
            open(prefs_path) do io
                # Simple TOML parse for the TomeRAG section.
                YAML.load(io)   # LocalPreferences.toml is TOML not YAML — use Pkg.TOML
            end
        catch
            nothing
        end
    end
    # Use Pkg.TOML (always available)
    if isfile(prefs_path)
        toml = Pkg.TOML.parsefile(prefs_path)
        key = get(get(toml, "TomeRAG", Dict()), "anthropic_api_key", "")
    end
    if isempty(key)
        key = get(ENV, "ANTHROPIC_API_KEY", "")
    end
    isempty(key) && error(
        "Anthropic API key not set. Run:\n" *
        "  using Preferences\n" *
        "  set_preferences!(\"TomeRAG\", \"anthropic_api_key\" => \"sk-ant-...\")"
    )
    return key
end

# ---------------------------------------------------------------------------
# JSON array extractor — copied from TomeRAG._extract_json_array
# ---------------------------------------------------------------------------

"""
    extract_json_array(text) -> String

Extract a JSON array from Claude's response, handling code fences and noise.
Returns the substring from the first `[` to its matching `]`.
"""
function extract_json_array(text::AbstractString)
    start = findfirst('[', text)
    isnothing(start) && error("No JSON array found in response:\n$text")
    depth = 0
    in_string = false
    escape_next = false
    for i in start:lastindex(text)
        c = text[i]
        if escape_next
            escape_next = false
            continue
        end
        if c == '\\'
            escape_next = in_string
            continue
        end
        if c == '"'
            in_string = !in_string
            continue
        end
        in_string && continue
        if c == '['
            depth += 1
        elseif c == ']'
            depth -= 1
            depth == 0 && return text[start:i]
        end
    end
    error("Unterminated JSON array in response")
end

# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

function build_move_prompt(chunks)
    n = length(chunks)
    io = IOBuffer()
    println(io, "You are extracting structured data from Ironsworn RPG move text chunks.")
    println(io, "Return a JSON array of exactly $n objects, one per numbered chunk below.")
    println(io, "Do NOT wrap in markdown code fences. Return ONLY the JSON array.")
    println(io)
    println(io, "Each object must have these fields:")
    println(io, "  name (string): the move name")
    println(io, "  trigger (string): the \"When you...\" trigger phrase")
    println(io, "  stat_options (array of strings): which stats can be used, e.g. [\"edge\", \"heart\", \"iron\", \"shadow\", \"wits\"]")
    println(io, "  stat_hint (string): brief guidance on choosing which stat based on approach")
    println(io, "  roll_type (string): \"action\" or \"progress\"")
    println(io, "  outcomes (object): { strong_hit, weak_hit, miss } — verbatim outcome text from the rules")
    println(io, "  effects_by_band (object): {")
    println(io, "    strong_hit: array of {kind, amount?},")
    println(io, "    weak_hit: array of {kind, amount?},")
    println(io, "    miss: array of {kind, amount?}")
    println(io, "  }")
    println(io)
    println(io, "Effect kinds: take_momentum, lose_momentum, burn_momentum, take_harm, suffer_stress,")
    println(io, "              consume_supply, pay_the_price, gain_xp, mark_progress, inflict_debility, clear_debility")
    println(io)
    println(io, "Chunks:")
    for (i, chunk) in enumerate(chunks)
        println(io, "[$i] heading: $(chunk.heading_path) | move_trigger: $(something(chunk.move_trigger, ""))")
        println(io, chunk.text)
        println(io)
    end
    return String(take!(io))
end

function build_oracle_prompt(chunks)
    n = length(chunks)
    io = IOBuffer()
    println(io, "You are extracting random oracle tables from Ironsworn RPG text chunks.")
    println(io, "Return a JSON array of exactly $n objects, one per numbered chunk below.")
    println(io, "Do NOT wrap in markdown code fences. Return ONLY the JSON array.")
    println(io)
    println(io, "Each object must have these fields:")
    println(io, "  name (string): the oracle table name")
    println(io, "  dice (string): \"d6\", \"d10\", or \"d100\"")
    println(io, "  rolls (array): [{min, max, outcome}] — every row of the table")
    println(io)
    println(io, "Chunks:")
    for (i, chunk) in enumerate(chunks)
        println(io, "[$i] heading: $(chunk.heading_path)")
        println(io, chunk.text)
        println(io)
    end
    return String(take!(io))
end

# ---------------------------------------------------------------------------
# Claude API call
# ---------------------------------------------------------------------------

function call_claude(client, prompt::String, n_items::Int)
    resp = create(client.messages;
                  model     = MODEL,
                  max_tokens = max(4096, n_items * 400),
                  messages  = [Message("user", prompt)])
    raw_text = resp.content[1].text
    json_str = extract_json_array(raw_text)
    return JSON3.read(json_str)
end

# ---------------------------------------------------------------------------
# Batch processing helpers
# ---------------------------------------------------------------------------

function process_move_batch(client, batch)
    prompt  = build_move_prompt(batch)
    parsed  = call_claude(client, prompt, length(batch))
    results = Dict{String,Any}[]
    n_got   = length(parsed)
    if n_got < length(batch)
        @warn "Move batch: expected $(length(batch)) items, got $n_got"
    end
    for i in 1:min(n_got, length(batch))
        item = parsed[i]
        d = Dict{String,Any}(
            "name"         => get(item, "name", "Unknown"),
            "trigger"      => get(item, "trigger", ""),
            "stat_options" => String[s for s in get(item, "stat_options", [])],
            "stat_hint"    => get(item, "stat_hint", ""),
            "roll_type"    => get(item, "roll_type", "action"),
            "outcomes"     => Dict{String,Any}(
                "strong_hit" => get(get(item, "outcomes", Dict()), "strong_hit", ""),
                "weak_hit"   => get(get(item, "outcomes", Dict()), "weak_hit", ""),
                "miss"       => get(get(item, "outcomes", Dict()), "miss", ""),
            ),
            "effects_by_band" => Dict{String,Any}(
                "strong_hit" => _normalise_effects(get(get(item, "effects_by_band", Dict()), "strong_hit", [])),
                "weak_hit"   => _normalise_effects(get(get(item, "effects_by_band", Dict()), "weak_hit", [])),
                "miss"       => _normalise_effects(get(get(item, "effects_by_band", Dict()), "miss", [])),
            ),
        )
        push!(results, d)
    end
    return results
end

function process_oracle_batch(client, batch)
    prompt  = build_oracle_prompt(batch)
    parsed  = call_claude(client, prompt, length(batch))
    results = Dict{String,Any}[]
    n_got   = length(parsed)
    if n_got < length(batch)
        @warn "Oracle batch: expected $(length(batch)) items, got $n_got"
    end
    for i in 1:min(n_got, length(batch))
        item = parsed[i]
        raw_rolls = get(item, "rolls", [])
        rolls = Dict{String,Any}[]
        for r in raw_rolls
            push!(rolls, Dict{String,Any}(
                "min"     => get(r, "min", 1),
                "max"     => get(r, "max", 1),
                "outcome" => string(get(r, "outcome", "")),
            ))
        end
        d = Dict{String,Any}(
            "name"  => get(item, "name", "Unknown"),
            "dice"  => get(item, "dice", "d100"),
            "rolls" => rolls,
        )
        push!(results, d)
    end
    return results
end

function _normalise_effects(raw)
    effects = Dict{String,Any}[]
    isnothing(raw) && return effects
    for e in raw
        if e isa AbstractDict || hasproperty(e, :kind)
            k = string(get(e, "kind", "unknown"))
            amt = get(e, "amount", nothing)
            d = Dict{String,Any}("kind" => k)
            isnothing(amt) || (d["amount"] = amt)
            push!(effects, d)
        end
    end
    return effects
end

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function main(args)
    dry_run = "--dry-run" in args

    # Resolve DB path: prefer local data/ironsworn/ironsworn.duckdb,
    # fall back to the main repo location.
    db_path = DB_PATH
    if !isfile(db_path)
        fallback = joinpath(WORKTREE_ROOT, "..", "..", "data", "ironsworn.duckdb")
        if isfile(fallback)
            db_path = realpath(fallback)
        else
            # Try the main repo worktree sibling
            alt = "/home/karim/Code/rpg-rules/data/ironsworn.duckdb"
            isfile(alt) || error("Cannot find ironsworn.duckdb. Expected at: $DB_PATH")
            db_path = alt
        end
    end

    println("Opening DuckDB: $db_path")
    conn = DBInterface.connect(DuckDB.DB, db_path; readonly=true)

    query = """
        SELECT id, text, heading_path, content_type, move_trigger
        FROM chunks
        WHERE content_type IN ('move', 'oracle', 'table')
    """
    rows = collect(DBInterface.execute(conn, query))
    DBInterface.close!(conn)

    # Struct-like named tuples for each chunk row
    move_chunks   = filter(r -> r[:content_type] == "move",            rows)
    oracle_chunks = filter(r -> r[:content_type] in ("oracle", "table"), rows)

    println("Found $(length(move_chunks)) move chunks, $(length(oracle_chunks)) oracle/table chunks")

    if dry_run
        println("\n-- DRY RUN: not calling Claude. Summary:")
        println("  Move chunks  : $(length(move_chunks))")
        println("  Oracle chunks: $(length(oracle_chunks))")
        println("  (oracle includes 'table' content_type)")
        println("\nFirst 5 move headings:")
        for r in move_chunks[1:min(5, end)]
            println("  $(r[:heading_path])")
        end
        println("\nFirst 5 oracle/table headings:")
        for r in oracle_chunks[1:min(5, end)]
            println("  $(r[:heading_path])")
        end
        return
    end

    # Full run — call Claude
    api_key = get_anthropic_key()
    client  = Anthropic(api_key=api_key)

    # ---------- Moves ----------
    println("\nProcessing $(length(move_chunks)) move chunks in batches of $BATCH_SIZE...")
    all_moves = Dict{String,Any}[]
    for batch_start in 1:BATCH_SIZE:length(move_chunks)
        batch = move_chunks[batch_start:min(batch_start + BATCH_SIZE - 1, length(move_chunks))]
        batch_num = div(batch_start - 1, BATCH_SIZE) + 1
        n_batches  = ceil(Int, length(move_chunks) / BATCH_SIZE)
        print("  Batch $batch_num/$n_batches ($(length(batch)) chunks)...")
        try
            results = process_move_batch(client, batch)
            append!(all_moves, results)
            println(" got $(length(results)) moves")
        catch e
            @warn "Move batch $batch_num failed" exception=e
        end
    end

    # ---------- Oracles ----------
    println("\nProcessing $(length(oracle_chunks)) oracle/table chunks in batches of $BATCH_SIZE...")
    all_oracles = Dict{String,Any}[]
    for batch_start in 1:BATCH_SIZE:length(oracle_chunks)
        batch = oracle_chunks[batch_start:min(batch_start + BATCH_SIZE - 1, length(oracle_chunks))]
        batch_num = div(batch_start - 1, BATCH_SIZE) + 1
        n_batches  = ceil(Int, length(oracle_chunks) / BATCH_SIZE)
        print("  Batch $batch_num/$n_batches ($(length(batch)) chunks)...")
        try
            results = process_oracle_batch(client, batch)
            append!(all_oracles, results)
            println(" got $(length(results)) oracles")
        catch e
            @warn "Oracle batch $batch_num failed" exception=e
        end
    end

    # ---------- Write YAML ----------
    mkpath(OUT_DIR)

    println("\nWriting $MOVES_YAML...")
    open(MOVES_YAML, "w") do io
        YAML.write(io, all_moves)
    end

    println("Writing $ORACLES_YAML...")
    open(ORACLES_YAML, "w") do io
        YAML.write(io, all_oracles)
    end

    # ---------- Validation summary ----------
    println("\n=== Extraction Summary ===")
    println("Moves   : $(length(all_moves))")
    println("Oracles : $(length(all_oracles))")
    println("\nMove names extracted:")
    for m in all_moves
        println("  - $(get(m, "name", "(unnamed)"))")
    end
end

main(ARGS)
