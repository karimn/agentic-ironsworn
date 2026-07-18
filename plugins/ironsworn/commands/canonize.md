---
description: Walk campaign-scoped lore candidates and bless the deliberate ones into shared world canon
---

Run the canonize ritual: surface what has stabilized into world-level fact this pass, gate on open contradictions, and let the player decide what crosses into shared canon. This works whether you're closing out a session or just checking in mid-play — there is no "right moment" to invoke it, and no assumption that a session is ending.

1. Call `list_canonize_candidates` (optionally with `limit`) to get ranked campaign-scoped entities and relations — ordered by how much they've recurred and connected this pass (scene appearances, relation degree). Each candidate carries `blocked` / `blocked_reason`: true when an unresolved contradiction touches it.

2. If there are no candidates, say so plainly ("nothing campaign-scoped has stabilized enough to consider yet") and stop — don't force a walk-through.

3. Walk the candidates **in the ranked order returned**, one at a time:
   - **If `blocked` is true:** do not offer to bless it. Tell the player which contradiction blocks it (`blocked_reason`) and that `resolve_contradiction` must be called first — after adjudicating it in the fiction (or, if the player wants to settle it right now, call `list_contradictions` for the full detail and `resolve_contradiction` once it's decided, then continue this pass). **Never call `canonize_entity` or `canonize_relation` on a blocked candidate, even if asked — resolve first, canonize second.**
   - **If not blocked:** present it plainly — name (or `from_name` —[`label`]→ `to_name` for a relation) and a one-line reason it ranked here (e.g. "appeared in N scenes this campaign") — and ask the player to choose:
     - **bless** — promotes it to world canon, visible to every sibling campaign. Call `canonize_entity` (entities) or `canonize_relation` (relations) with the candidate's id.
     - **keep** — stays campaign-scoped for now. No tool call.
     - **discard** — not canon-worthy. No tool call; nothing is deleted, so it may resurface on a future `/canonize` pass if it keeps recurring.
   - Honor "stop here" / "that's enough" at any point — this is not an all-or-nothing pass, and the player can resume later.

4. When the walk ends (all candidates handled, or the player stopped early), give a brief summary: what became world canon this pass (names), what stayed campaign-scoped, what was set aside, and how many candidates are still waiting on contradiction resolution.

Canonize deliberately — it is the one thing that crosses campaign boundaries. When genuinely unsure, keep it campaign-scoped; it can always be blessed on a later pass.
