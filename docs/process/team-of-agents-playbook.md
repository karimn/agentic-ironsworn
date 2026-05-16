# Team-of-Agents Playbook

How to ship 4 independent issues in parallel via Claude Code's experimental
agent-teams feature. First proven on umbrella #104 (mode-of-play skills
#95–98), shipped four PRs (#109–112) plus a single sequenced version-bump
commit on main, end-to-end in roughly an hour.

## When this is the right shape

Use a team when:

- **N independent issues** can be worked in parallel without shared state
  (4–8 issues is the sweet spot — fewer is just subagents; more is
  coordination overhead).
- Each issue has a **clear, isolated output** (a skill dir, a feature
  module, a doc set) — minimal cross-file edits between siblings.
- Cross-cutting **shared learnings are valuable** — when one teammate finds
  the right MCP sequence or a frontmatter pattern that triggers reliably,
  the others should adopt it without rediscovering it.
- You can describe the work in 2–4 paragraphs per teammate.

Don't use a team for:

- Sequential work (one PR depends on another's API).
- Single-issue debugging (use systematic-debugging on the lead).
- Refactors that touch shared files in every PR (merge conflicts cascade).

## Prerequisites (one-time)

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "in-process"
}
```

Restart CC if the env var wasn't already set when the session started. The
first session after enabling will surface `TeamCreate`, `TeamDelete`, and
`SendMessage` as deferred tools, plus `team_name` and `name` parameters on
the `Agent` tool.

`teammateMode` choices:

- `"in-process"` — all teammates run inside the lead's terminal; press
  **Shift+Down** to cycle through teammates and message any directly.
  Works without tmux.
- `"tmux"` / `"auto"` — split panes, one per teammate. Better visibility
  but requires tmux or iTerm2 with the `it2` CLI.

## Per-team setup (every time)

Five things, in this order. Don't skip steps — each one survives a CC
restart and you'll be glad later.

### 1. Pre-create worktrees and branches

One worktree per teammate, branched from `origin/main`:

```bash
git fetch origin main
for spec in "<issue>-<slug>" ...; do
  issue=${spec%%-*}; slug=${spec##*-}
  git worktree add -b skill/${issue}-${slug} \
    .claude/worktrees/${spec} origin/main
done
```

This gives each teammate a clean isolated checkout. They can't step on
each other's working tree. **Sandbox note:** `git worktree add` may need
`dangerouslyDisableSandbox: true` because the project's `.mcp.json` is on
the deny-write list and the checkout touches it.

### 2. Write the shared learnings file

Before spawning anyone, drop a file at
`.claude/team-notes/skill-learnings.md` (in the **main** repo — all
worktrees see the same file via absolute path). It's the durable, async
shared scratchpad. Structure:

```markdown
# <Project> — Shared Learnings

## How to use
When you discover something useful to peers, do BOTH:
1. Append `### <date> | <your-name> | <summary>` here (durable)
2. SendMessage each peer (real-time push)

Read this file at the START of every turn so you adopt patterns
peers landed.

## Shared rules of engagement
<bullet list of conventions: template path, word ceilings, frontmatter
rules, version-bump policy, etc.>

## Issue → branch → worktree → owner map
| Issue | Output | Branch | Worktree | Owner |
|-------|--------|--------|----------|-------|

## Learnings (append below this line, oldest first)
```

### 3. Permissions (one-time per project)

The Bash sandbox and the `permissions.allow` system are **separate**. The
sandbox controls OS-level filesystem access for shell commands; the
`permissions` system controls which tool calls run without prompting.
Teammates inherit the lead's permissions and don't have an in-process way
to escalate, so denied prompts queue silently and stall progress.

Add to `.claude/settings.local.json` `permissions.allow`:

```json
"Write(//<repo>/.claude/worktrees/**)",
"Edit(//<repo>/.claude/worktrees/**)",
"MultiEdit(//<repo>/.claude/worktrees/**)",
"NotebookEdit(//<repo>/.claude/worktrees/**)",
"Write(//<repo>/.claude/team-notes/**)",
"Edit(//<repo>/.claude/team-notes/**)",
"Bash(git push *)",
"Bash(git status*)",
"Bash(git diff*)",
"Bash(git checkout *)",
"Bash(git branch *)",
"Bash(git restore *)",
"Bash(git stash *)",
"Bash(git log*)",
"Bash(gh pr *)",
"Bash(gh issue *)"
```

These rules are read live; you don't need to respawn teammates after
adding them.

### 4. Create team and tasks

```
TeamCreate(team_name: "<team>", agent_type: "team-lead",
           description: "<what we're shipping>")
```

Then `TaskCreate` one per issue. **Tasks belong to the team's task list**
(stored at `~/.claude/tasks/<team>/`), so all teammates see them via
`TaskList`. Give each task enough description that the assigned teammate
could pick it up cold.

### 5. Spawn teammates

One `Agent` call per teammate, **all in the same message** so they boot
in parallel. Required parameters:

- `subagent_type: "general-purpose"` (full tool surface, including Write/Edit/Bash)
- `team_name: "<team>"` — registers them in the team's `members` array
- `name: "<short-name>"` — what peers SendMessage them as
- `run_in_background: true` — don't block the lead

The prompt for each teammate must be **fully self-contained** (they don't
inherit lead history). Include:

1. **Identity:** "You are teammate `<name>`. Peers are `a`, `b`, `c`."
2. **Task to claim:** which task ID, what to set owner/status to.
3. **Working directory:** absolute path to their worktree, with the
   instruction to call `EnterWorktree(path: ...)` immediately. **Do not
   tell them to use `cd` per-command** — that's ugly and the
   `EnterWorktree` tool is what cleanly switches the session's working
   directory and clears CWD-dependent caches.
4. **Required reading at the start of every turn:** the shared learnings
   file, the template for what they're building, the issue body.
5. **Team protocol:** when you find something useful, do BOTH (file
   append + SendMessage). Plain-text messages only. No JSON status
   messages — those go through `TaskUpdate`.
6. **Constraints** specific to the work product (size limits, naming,
   cross-link rules, what NOT to do).
7. **Done = PR open.** Explicit steps: stage → commit → push → `gh pr
   create` → SendMessage team-lead with URL → TaskUpdate completed.

Critical constraint to call out: **do NOT bump shared files (e.g.
`plugin.json` version) from inside teammate PRs.** All four parallel PRs
will collide on the same line, forcing painful rebase chains. Have the
lead push a single sequenced bump after all PRs merge.

## Lead's job during the run

Once spawned, teammates work autonomously and surface messages back.
Idle notifications (`{"type":"idle_notification","from":...}`) are
expected after every turn — they mean "waiting for input," not "stuck."
Do **not** poll. Don't comment on idleness. Watch for:

- **Substantive teammate messages** with PR URLs, blockers, or
  cross-team coordination questions.
- **Peer-DM summaries** (one teammate addressing another) — informational;
  no action needed unless the conversation needs steering.
- **Stale `task_assignment` echoes** — sometimes teammates surface a
  re-routed message about a task they already finished. Acknowledge with
  one short SendMessage and move on.

Things you'll need to broadcast partway through:

- Policy changes (e.g., "don't bump plugin.json, lead handles it"). One
  SendMessage per teammate.
- Surgical PR amendments after the first PR opens (e.g., revert the
  version bump). Send specific git steps, not vague advice.

## Merge sequence

Once all PRs are open and clean (plugin.json reverted, CI green):

```bash
gh pr merge -R <owner>/<repo> <pr> --squash --delete-branch
```

Squash-merge each in any order. The squashed commits land on `main`
without conflict if everyone stayed off shared files. After all four are
merged, the lead pulls main and pushes the single version bump:

```
Edit plugin.json: 0.13.0 → 0.14.0
git add plugins/ironsworn/.claude-plugin/plugin.json
git commit -m "chore(plugin): bump version to 0.14.0"
git push origin main
```

## Cleanup

```
SendMessage to: <name>, message: {"type":"shutdown_request","reason":"..."}
```

One per teammate. They each respond with a `shutdown_approved` and
`teammate_terminated` notification. Once all four are down:

```
TeamDelete  # removes ~/.claude/teams/<team>/ and ~/.claude/tasks/<team>/
git worktree remove --force .claude/worktrees/<spec>  # × 4
git branch -D skill/<branch>  # × 4 (squash-merge doesn't update local refs)
```

Squash-merge auto-deletes the **remote** branches via `--delete-branch`
on `gh pr merge`, but local branches and worktrees stick around until
you remove them.

## What worked unusually well

These are the tactics that made the difference, surfaced from running
the umbrella-#104 batch:

- **Single shared file + peer SendMessage.** The file is durable and
  anyone joining late catches up; SendMessage is real-time push for
  hot findings. Either alone is worse: file-only has no urgency,
  message-only loses learnings to context turnover.
- **Read the learnings file at the START of every turn**, not just the
  first. Without this rule, peers don't actually adopt each other's
  patterns; they just dump-and-forget.
- **Highest-cross-cutting teammate writes more.** In our batch, `oracle`
  centralized rules every other skill called into. We told them
  explicitly: "you are most-cross-cutting — push generously." It
  worked: their findings (likelihood semantics, twist rule, Pay the
  Price discipline) shaped every other skill.
- **Lead reverses dependencies post-hoc.** First PR up landed a
  version bump that would have collided with the next three. Telling
  the team mid-flight to revert was cheaper than designing the conflict
  out upfront, and gave the rule retroactively. Don't try to anticipate
  every coordination problem — react fast when one surfaces.
- **`EnterWorktree` over `cd`.** Cleanly switches the session's CWD and
  clears caches. `cd && command` everywhere is noisy and brittle.

## Common pitfalls

- **Forgetting to set `team_name`/`name` on Agent.** You'll spawn ordinary
  subagents instead of teammates; they won't have SendMessage or
  TaskUpdate, and the team config's `members` array stays empty. They
  will tell you this in their result. Stop them, fix the call, respawn.
- **Permissions/sandbox confusion.** A Bash sandbox allow rule does not
  grant the `Write`/`Edit` tools. If teammates are silently stalling on
  edit prompts, check `.claude/settings.local.json` `permissions.allow`.
- **Overlapping word ceilings.** Telling four teammates "≤900 words" gets
  you four ~1500-word skills. The `references/` lazy-loading discipline
  helps but isn't enough alone. If size matters, post-merge edit pass.
- **Stale task_assignment routing.** If a completed task gets a fresh
  `task_assignment` message after the fact, treat it as a no-op; it's
  usually a delayed delivery in the queue. One terse SendMessage to
  acknowledge is enough.
- **Premature claims of completeness.** Teammates will mark
  TaskUpdate→completed when the PR opens. Treat that as "PR is up,"
  not "work is done." Always pull diffs and read the actual SKILL.md
  / source before merging — the team is fast, not infallible.

## Reusable template prompts

When spawning, the per-teammate prompt skeleton is:

```
You are teammate `<name>` on team `<team>`. Team-lead is `team-lead`.
Peers are `<a>`, `<b>`, `<c>`.

## Your task
Claim task #N ("<subject>") via TaskUpdate (owner: "<name>",
status: "in_progress"). <One-sentence outcome.>

## Working directory
EnterWorktree(path: "<absolute-worktree-path>") — do this before any
file work. Output goes at `<output-path-inside-worktree>`.

## Scope
<2–4 sentences: what's in, what's out, key cross-skill handoffs.>

## Required reading at the START of EVERY turn
1. <absolute path to learnings file>
2. <absolute path to template>
3. `gh issue view <N> --json body --jq .body`

## Team protocol
When you discover something useful, do BOTH:
1. Append `### <date> | <name> | <summary>` to <learnings file>
2. SendMessage each peer (`<a>`, `<b>`, `<c>`).

Read the learnings file at the start of every turn. Plain-text
messages only.

## Constraints
<numbered list: size limits, frontmatter rules, version policy,
account/auth, etc.>

## Done = PR open
1. Stage your changes
2. Commit `<conventional commit>` co-authored by Claude
3. `git push -u origin <branch>`
4. `gh pr create` body: "Closes #<N>" + test plan
5. SendMessage `team-lead` with PR URL
6. TaskUpdate task #N → completed

Begin: read the learnings file, read the issue, claim the task,
then plan + implement.
```

Adapt the **Constraints** and **Scope** sections per project; everything
else stays.
