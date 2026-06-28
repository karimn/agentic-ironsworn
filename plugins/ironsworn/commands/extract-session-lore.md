---
description: Extract lore entities and relations from all unprocessed scenes this session
---

Optional backfill. The GM records canon on the beat during play; run this only to catch lore from scenes where structured recording was missed. It dedups against already-recorded entities and relations.

Call the `extract_session_lore` MCP tool to batch-extract lore from all scenes recorded since the last extraction run.

After the tool returns, report the results to the player in a brief, friendly summary:
- How many scenes were processed vs skipped
- How many entities were created and updated
- How many relations were created
- How many items were skipped (low confidence or unresolvable)

If no scenes were processed (all already extracted), say so clearly.

If the tool returns an error (e.g., missing ANTHROPIC_API_KEY), report the error directly.
