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

## Scanners (run in step 5)

- **Contradictory-instructions scanner**: sweep `CLAUDE.md`, every skill `SKILL.md` `## Rules` section, and the per-user memory files for conflicting rules on the same topic. Surface conflicts as findings in the input bundle so `superpowers:writing-plans` can include a "rule reconciliation" group.
- **Old-plan staleness scanner**: list every file under the gitignored .claude/plans directory and flag any that reference paths no longer present on disk. Surface as cleanup proposals.

## Rules

1. /fix never modifies code or tests. Only writes one plan (delegated) and one decision article.
2. Every plan group must reference at least one open Issue OR at least one feedback note by date. Orphan-feedback groups must propose creating an Issue.
3. Every file path in the plan is absolute or repo-root-relative, never bare.
4. Every plan begins with the Workflow section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/core-workflow.md`.
5. Every plan includes a Testing section from `.claude/skills/fix/references/plan-preamble.md`, which cites `references/architecture/testing-system.md` and names the right test layer (unit, integration, sim-test, browser via sim-test agent, health).
