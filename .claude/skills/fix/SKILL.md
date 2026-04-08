---
name: fix
description: Gather feedback, open Issues, vault decisions, and the latest health-score findings, then delegate plan-writing to superpowers:writing-plans. /fix never edits code or runs tests. Use when user says "fix", "apply feedback", or "propose improvements".
effort: low
references_system_vault: true
---

# fix Skill

/fix has one job: gather inputs and hand them to `superpowers:writing-plans`.
It never edits code, never runs tests, never rotates logs, never creates
GitHub Issues, never commits, never runs browser tests, never touches a
routing table, never dispatches verifiers. Those jobs live elsewhere now.

## Plan execution: always use scripts/run-plans.sh

When the time comes to EXECUTE the plan(s) /fix just wrote, the canonical
dispatcher is `scripts/run-plans.sh <parent-slug>`. It spawns one real
`claude -p` subprocess per sibling plan with proper process isolation,
per-worktree branches, and streaming JSON logs at
`learning/logs/run-<slug>.jsonl`. Do NOT fall back to the `Agent` tool,
do NOT hand-roll `claude -p` invocations, do NOT spawn subagents from the
main conversation to execute plans. Those paths look equivalent but skip
the process-level isolation and the log stream. If `run-plans.sh` cannot
handle a case (for example, one sibling is already merged), patch the
script or move the finished sibling aside before running it, rather than
bypassing it.

### Checking in with in-flight siblings

While sibling plans run headless, the way to monitor and unblock them is
file-based, not interactive:

1. **Status at a glance**: `git -C .claude/worktrees/<slug> log --oneline
   master..HEAD && git -C .claude/worktrees/<slug> status --porcelain`.
   Commit count + working tree delta tells you how far each sibling got.
2. **What the agent was doing**: `tail -c 5000
   learning/logs/run-<slug>.jsonl | tr ',' '\n' | grep -Ei
   '"result"|"is_error"|sensitive|rate_limit|error'` surfaces the last
   real turn and any exit reason. For full trace, `jq -c . <
   learning/logs/run-<slug>.jsonl | tail -40`.
3. **Process check**: `pgrep -af "claude -p"` confirms whether a sibling
   is still alive. An exited `claude -p` with a non-zero exit code
   almost always means either a permission wall or a rate limit.
4. **Notify yourself**: treat each sibling's background task completion
   as the checkpoint. Do not poll; wait for the harness notification
   and then read the tail of the JSON log to decide next action.

### When a headless run stops on a rate limit

`claude -p` honors the same 5-hour rolling limit as interactive Claude
Code. Symptoms: the JSON log ends with a `rate_limit_event` record and
a synthetic assistant message "You've hit your limit · resets <time>".
Overage is org-disabled for this account, so the run cannot self-resume.

Correct response:

1. Read the final `rate_limit_event.resetsAt` (epoch seconds) from the
   log to know exactly when dispatch is possible again.
2. Do NOT re-spawn the sibling before the reset — it will fail
   identically and waste shell cycles.
3. Check the branch state (`git log master..HEAD`) to confirm what the
   sibling managed to commit before it was cut off. Uncommitted working
   tree changes are lost; committed work is safe.
4. Every sibling prompt must tell the agent to inspect `git log
   master..HEAD` first and resume from wherever the plan left off.
   Sibling prompts should be idempotent on resume for this reason.
5. If multiple siblings are in flight, stagger future dispatches or run
   them sequentially to avoid co-exhausting the limit. Headless runs
   are cheap in wall clock but not in tokens; two parallel Opus runs
   each spending $1-$2 can burn the whole 5-hour budget.

### When a headless run stops on a permission prompt

`claude -p --permission-mode acceptEdits` still blocks on a small set of
sensitive paths (notably `.claude/hooks/**`, `.claude/settings.json`,
`.mcp.json`, and a few others). If a sibling run exits early with a
"requested permissions to edit ... which is a sensitive file" message,
the correct response is:

1. Identify the exact path and the literal edit the plan required.
2. Make the edit manually from an interactive session (or widen the
   local workspace permission config in `.claude/settings.json` to
   allowlist the path for future headless runs).
3. Commit it on the sibling's feature branch with a `Ref #N` trailer
   tying it to the originating Issue, and a commit body noting that the
   edit was made interactively to unblock the headless run.
4. Re-spawn the sibling with `--permission-mode acceptEdits` (the same
   mode, NOT `bypassPermissions`) so the rest of the plan finishes
   autonomously.

Never escalate to `--permission-mode bypassPermissions` as a shortcut.
Bypass is not sandboxed to the worktree (the child process still has
full filesystem access) and the permission wall is there for a reason.
The fix is either a targeted manual edit or a targeted permission
allowlist, never a blanket bypass.

## Flow (8 steps)

1. List open Issues: `gh issue list --state open --json number,title,labels,body --limit 200`. Group by label.
2. Read `learning/feedback.md` and any `learning/system-vault/feedback/` articles since the last /fix run. Feedback that matches an existing Issue attaches with "user reinforced this." Orphan feedback flags "propose creating an Issue."
3. Run `system-vault-query` on the themes surfaced by steps 1 and 2 to pull prior decisions and workarounds.
4. Read the latest entry of `learning/logs/health-scores.jsonl`. Pull `findings[]` (top 10 ranked by `expected_gain_if_fixed`).
5. Group by label, root cause, and shared file references using the heuristics in `.claude/skills/fix/references/issue-grouping.md`. Then run the two scanners below and append their results to the input bundle.
6. Invoke `superpowers:writing-plans` with the input bundle, the canonical preamble at `.claude/skills/fix/references/plan-preamble.md`, and a target plan path under the gitignored .claude/plans directory. `superpowers:writing-plans` runs its own exploration and writes the plan; /fix does not write plan steps itself.
7. Write a `learning/system-vault/decisions/<plan-slug>.md` article recording why this group is being tackled together and which Issues + feedback notes drove it.
8. Hand back to the user with the plan path. Done.

## Splitting a big plan

Split the input bundle into 2 or 3 sibling plans (cap at 3) when ANY of these is true:

- The bundle spans 3 or more distinct skills or top-level directories (for example `web/`, `.claude/skills/`, `references/architecture/`).
- There are 2 or more independent PR-worthy groups, each already mapping to a distinct Issue per the issue-first rule, that could land on master in either order without breaking the build.
- The estimated commit count is 15 or more.
- The estimated file-touch count is 20 or more.
- The groups share NO file edits across the split. Shared edits would force rebasing and cancel the parallelism win.

Do NOT split when:

- The bundle is a single skill or a single subsystem.
- Any group depends on another (for example, group B is blocked until group A's refactor lands).
- Groups share file edits.

If the split would produce more than 3 siblings, /fix picks the top 3 by `expected_gain_if_fixed` from the health-scores findings and lists the rest in a `## Pending items` section of the last sibling, as informational references to Issue numbers /fix already created. The plan never runs `gh issue create` itself (Issue #113); /fix is the sole Issue creator.

Mechanics:

- Each sibling plan file lives at `.claude/plans/<parent-slug>-part-N.md` for N in 1..3.
- Each sibling's Workflow section includes a `### Sibling plans` subsection listing the other siblings by absolute path and the parent decision article path.
- /fix writes all N siblings atomically in one run and records one decision article at `learning/system-vault/decisions/<parent-slug>.md` that links all of them.
- /fix hands back all N plan paths to the user at the end.
- Each sibling owns its own worktree at `.claude/worktrees/<parent-slug>-part-N`, its own feature branch `feature/<parent-slug>-part-N`, and its own PR.

## Scanners (run in step 5)

- **Contradictory-instructions scanner**: sweep `CLAUDE.md`, every skill `SKILL.md` `## Rules` section, and the per-user memory files for conflicting rules on the same topic. Surface conflicts as findings in the input bundle so `superpowers:writing-plans` can include a "rule reconciliation" group.
- **Old-plan staleness scanner**: list every file under the gitignored .claude/plans directory and flag any that reference paths no longer present on disk. Surface as cleanup proposals.

## Rules

1. /fix never modifies code or tests. Only writes one plan (delegated) and one decision article.
2. Every plan group must reference at least one open Issue OR at least one feedback note by date. Orphan-feedback groups must propose creating an Issue.
3. Every file path in the plan is absolute or repo-root-relative, never bare.
4. Every plan (or each sibling plan when the bundle is split per the Splitting a big plan section) begins with the Workflow section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/core-workflow.md`.
5. Every plan includes a Testing section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/testing-system.md` and names the right test layer (unit, integration, sim-test, browser via sim-test agent, health).
6. /fix writes salience-triggered notes during its input gathering and plan authoring. Any moment that feels surprising, exciting, frustrating, or like a self-correction gets a `scripts/note.ts` entry in the moment, not at the end of the session. Any emotion, positive or negative, is a valid signal. Rule: memory `feedback_note_on_salience.md`.
