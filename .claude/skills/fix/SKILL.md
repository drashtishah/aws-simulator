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
