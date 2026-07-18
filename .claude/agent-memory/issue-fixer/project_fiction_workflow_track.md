---
name: project_fiction_workflow_track
description: Status of the fiction-workflow track (umbrella #201, items FW1-FW5) — which are done and by which PR.
type: project
---

The fiction-workflow track (umbrella issue #201) has 5 items, sequenced by
leverage, tracked in `docs/design/agentic-rpg-v1.md`'s v1-priorities table:

- **FW1** (#196) — surface open contradictions into live GM context. Done, PR #203.
- **FW2** (#197) — operationalize the canonize ritual (`/canonize` command +
  `list_canonize_candidates`). Done, PR #204.
- **FW3** (#198) — new-campaign-in-existing-world onramp + canon briefing.
  Done, PR #205 (2026-07-18).
- **FW4** (#199) — inheriting a *published* setting's canon (setting-seed
  migration step #4). Not started as of 2026-07-18.
- **FW5** (#200) — narration-quality eval (research spike, not blocking v1).
  Not started as of 2026-07-18.

**Why this matters:** each FW issue explicitly says "don't start on
FW4/FW5" etc. when working a specific one — these are meant to land as
separate, individually-scoped PRs, not bundled. When picking up the next FW
item, re-check `docs/design/agentic-rpg-v1.md`'s table for the current ✅
markers before assuming what's done, since this file decays fast.

**How to apply:** if asked to work FW4 or FW5, check the doc for the latest
status first — don't rely solely on this memory being current.
