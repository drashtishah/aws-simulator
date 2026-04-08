---
name: fix
description: Gather feedback, open Issues, vault decisions, and the latest health-score findings, then delegate plan-writing to superpowers:writing-plans. /fix never edits code or runs tests. Use when user says "fix", "apply feedback", or "propose improvements".
effort: low
references_system_vault: true
---

# fix Skill

/fix has two jobs: (1) gather inputs and hand them to `superpowers:writing-plans`,
and (2) create every GitHub Issue the plan will reference (step 5b, see below).
It never edits code, never runs tests, never rotates logs, never commits, never
runs browser tests, never touches a routing table, never dispatches verifiers.
Those jobs live elsewhere now. /fix is the sole creator of GitHub Issues in
this workspace (Issue #113); plans never run `gh issue create` themselves.

## Plan execution: per-sibling dispatch via spawn-sibling.sh

When the time comes to EXECUTE the sibling plans /fix just wrote, the
canonical model is **one harness background task per sibling**, using
`scripts/spawn-sibling.sh <parent-slug> <part-slug>`. The orchestrating
Claude Code session (this one) dispatches each sibling as a separate
`Bash(run_in_background=true)` call, gets a separate task ID per
sibling, and intervenes between and after each via the harness
notifications. See Issue #148 for the rationale: the old parent
`run-plans.sh` fork-and-wait model batched N siblings into one harness
task and prevented per-sibling intervention.

Dispatch pattern (for a 2-sibling sweep):

```
# Pre-flight (cheap, one call)
Bash: scripts/check-budget.sh

# Dispatch both siblings in parallel as two separate harness tasks
Bash(run_in_background=true): scripts/spawn-sibling.sh <parent> part-1
Bash(run_in_background=true): scripts/spawn-sibling.sh <parent> part-2
```

`spawn-sibling.sh` is resume-safe (Issue #128): re-dispatching a
sibling whose worktree already exists reuses the worktree and branch.
The headless agent's prompt instructs it to cat the per-worktree
`progress.txt` and run `git log master..HEAD` before doing anything,
so a re-dispatch after a rate-limit death picks up where it left off.

Do NOT fall back to the `Agent` tool (shared context, no process
isolation). Do NOT hand-roll a bash loop that spawns multiple `claude
-p` calls in one harness task (defeats the per-sibling notification
goal). Do NOT spawn subagents from the main conversation to execute
plans. Those paths look equivalent but lose one of: process isolation,
per-sibling granularity, or log streaming.

If `spawn-sibling.sh` cannot handle a case, patch the script rather
than bypassing it. The "parent orchestrator" is this Claude Code
session; there is no bash parent script.

### Spot-check at each completion checkpoint

When a sibling's background task notifies completion, run the
spot-check sequence BEFORE dispatching the next sibling or merging:

1. **Cheap status snapshot**: `scripts/sibling-status.sh <parent-slug>`
   gives one line per sibling with commit count, HEAD SHA, log size,
   alive/dead state, and any pending rate-limit reset. Read this first.
2. **Commits match scope**: `git -C .claude/worktrees/<slug> log --stat
   master..HEAD` shows every file touched. Verify the files are ALL
   within the plan group's declared scope. Any surprise files (new
   directories, unrelated skills, sensitive paths) are a red flag.
3. **Commit messages cite the right Issues**: `git -C .claude/worktrees/<slug>
   log master..HEAD | grep -E 'Closes|Ref #'`. Every commit should
   reference at least one of the Issues the plan group was supposed
   to close.
4. **CI is green** (if the sibling opened a PR): `gh pr checks <num>`
   or `gh run view <id>`. Red CI on the sibling's PR means the agent
   shipped broken code; decide whether to fix-forward or revert.
5. **Agent's last real turn** (only if steps 1-4 surface something
   weird): `tail -c 5000 learning/logs/run-<slug>.jsonl | tr ',' '\n'
   | grep -Ei '"result"|"is_error"|sensitive|rate_limit|error'`. Do
   NOT read the full JSON log on every checkpoint — it is expensive
   in context. Only dip into it when sibling-status.sh or the commit
   review flagged something.

The goal is: 60 seconds of targeted checks per completion, not a full
log review. Spot-checks at checkpoints are different from polling
mid-flight: treat the harness notification as the only signal and
never poll while a sibling is alive.

### Checking in with in-flight siblings

While a sibling is running (before the harness notifies), the rule is
**do not poll**. If you need to know whether it is still alive (e.g.
before deciding to dispatch the next one), `scripts/sibling-status.sh
<parent-slug>` is the only sanctioned tool. Do not tail the JSON log,
do not pgrep repeatedly, do not read the worktree log every few
minutes. The harness notification is the checkpoint.

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

## Flow

1. List open Issues: `gh issue list --state open --json number,title,labels,body --limit 200`. Group by label.
2. Read `learning/feedback.md` and any `learning/system-vault/feedback/` articles since the last /fix run. Feedback that matches an existing Issue attaches with "user reinforced this." Orphan feedback is tagged for Issue creation in step 5b.
3. Run `system-vault-query` on the themes surfaced by steps 1 and 2 to pull prior decisions and workarounds.
4. Read the latest entry of `learning/logs/health-scores.jsonl`. Pull `findings[]` (top 10 ranked by `expected_gain_if_fixed`).
5. Group by label, root cause, and shared file references using the heuristics in `.claude/skills/fix/references/issue-grouping.md`. Then run the two scanners below and append their results to the input bundle.
5b. For every orphan-feedback theme surfaced in step 2 and every cut item from the splitting heuristic, create a GitHub Issue NOW via `gh issue create`. Use the depth template in memory `feedback_detailed_issues.md` (Context, Current state verified, Scope with file:line refs, Architecture note, Out of scope, Verification naming exact test file paths + the test command + "Verified by separate subagent", Refers to). Capture every Issue number into the input bundle so the plan only ever references numbers, never runs `gh issue create`. This is the ONLY write operation /fix performs against external state (Issue #113).
5c. Validate every Issue created in step 5b against the Issue checklist in `.claude/skills/fix/references/plan-validator.md` (Context present, Current state verified with grep/gh/sed commands, Scope with exact file:line refs and literal edit content, Architecture note, Out of scope, Verification naming exact test file paths + the test command + "Verified by separate subagent", Refers to). If ANY section is missing from ANY Issue, /fix refuses to proceed to step 6 and reports the gap to the user. Fix the gap via `gh issue edit <N> --body-file ...` then re-run step 5c (Issue #118).
6. Invoke `superpowers:writing-plans` with the input bundle, the canonical preamble at `.claude/skills/fix/references/plan-preamble.md`, and a target plan path under the gitignored .claude/plans directory. `superpowers:writing-plans` runs its own exploration and writes the plan; /fix does not write plan steps itself.
6b. Validate the produced plan file against the plan checklist in `.claude/skills/fix/references/plan-validator.md`: (1) every Group section cites at least one Issue number, (2) every Group has a Test section naming a test layer, (3) every Group declares a per-group test cadence (per commit / group exit / pre-PR), (4) every file path is root-relative or absolute (never bare), (5) no `gh issue create` appears anywhere in the plan body. If ANY check fails, /fix refuses to hand back and reports the gap to the user. Fix the plan file in place then re-run step 6b (Issue #118).
7. Write a `learning/system-vault/decisions/<plan-slug>.md` article recording why this group is being tackled together and which Issues + feedback notes drove it.
8. Hand back to the user with the plan path. Done.

## Splitting a big plan

Split the input bundle into 2 sibling plans (cap at 2) when ANY of these is true:

- The bundle spans 3 or more distinct skills or top-level directories (for example `web/`, `.claude/skills/`, `references/architecture/`).
- There are 2 independent PR-worthy groups, each already mapping to a distinct Issue per the issue-first rule, that could land on master in either order without breaking the build.
- The estimated commit count is 15 or more.
- The estimated file-touch count is 20 or more.
- The groups share NO file edits across the split. Shared edits would force rebasing and cancel the parallelism win.

Do NOT split when:

- The bundle is a single skill or a single subsystem.
- Any group depends on another (for example, group B is blocked until group A's refactor lands).
- Groups share file edits.

The cap is 2, not 3, for two hard reasons: (1) parallel Opus sessions draw from the same 5-hour rolling token budget, so 3 in flight can co-exhaust and lose all committed work to rate limits, proven empirically on 2026-04-08; (2) the orchestrating session can only hold so much spot-check context before the judgment suffers. Two is the sweet spot for both budget and orchestrator-context limits.

If the split would produce more than 2 groups, /fix picks the top 2 by `expected_gain_if_fixed` from the health-scores findings (tie-broken by compound value: infrastructure improvements beat per-feature work) and lists the rest in a `## Pending items` section of the decision article as informational references to Issue numbers. The pending items wait for a future /fix run to pick up. The plan never runs `gh issue create` itself (Issue #113); /fix is the sole Issue creator.

Mechanics:

- Each sibling plan file lives at `.claude/plans/<parent-slug>-part-N.md` for N in 1..2.
- Each sibling's Workflow section includes a `### Sibling plans` subsection listing the other sibling by absolute path and the parent decision article path.
- /fix writes both siblings atomically in one run and records one decision article at `learning/system-vault/decisions/<parent-slug>.md` that links both of them plus the pending items.
- /fix hands back both plan paths to the user at the end.
- Each sibling owns its own worktree at `.claude/worktrees/<parent-slug>-part-N`, its own feature branch `feature/<parent-slug>-part-N`, and its own PR.

## Scanners (run in step 5)

- **Contradictory-instructions scanner**: sweep `CLAUDE.md`, every skill `SKILL.md` `## Rules` section, and the per-user memory files for conflicting rules on the same topic. Surface conflicts as findings in the input bundle so `superpowers:writing-plans` can include a "rule reconciliation" group.
- **Old-plan staleness scanner**: list every file under the gitignored .claude/plans directory and flag any that reference paths no longer present on disk. Surface as cleanup proposals.

## Rules

1. /fix never modifies code or tests. Writes one plan (delegated), one decision article, and creates GitHub Issues per step 5b (Issue #113).
2. Every plan group must reference at least one open Issue. /fix creates the Issue in step 5b before the plan is written; the plan body only ever cites `#N`, never runs `gh issue create`. Orphan feedback surfaced in step 2 becomes a fresh Issue in step 5b (Issue #113).
3. Every file path in the plan is absolute or repo-root-relative, never bare.
4. Every plan (or each sibling plan when the bundle is split per the Splitting a big plan section) begins with the Workflow section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/core-workflow.md`.
5. Every plan includes a Testing section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/testing-system.md` and names the right test layer (unit, integration, sim-test, browser via sim-test agent, health).
6. /fix writes salience-triggered notes during its input gathering and plan authoring. Any moment that feels surprising, exciting, frustrating, or like a self-correction gets a `scripts/note.ts` entry in the moment, not at the end of the session. Any emotion, positive or negative, is a valid signal. Rule: memory `feedback_note_on_salience.md`.
7. /fix must not hand back a plan until the plan-validator checklist in `.claude/skills/fix/references/plan-validator.md` passes for every Issue it created (step 5c) and for the plan file (step 6b). Failing checks are surfaced to the user with the gap named explicitly (Issue #118).
