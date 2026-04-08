# /fix plan, 2026-04-08, example-sibling, part 1 of 2

## Workflow

This plan follows `references/architecture/core-workflow.md`. Issue-first,
small revertable commits, TDD strict, verifier subagent separation.

### Sibling plans

- Part 1 (this file): `/Users/drashti/experiments/aws-simulator/.claude/plans/example-sibling-part-1.md`
- Part 2: `/Users/drashti/experiments/aws-simulator/.claude/plans/example-sibling-part-2.md`
- Parent decision article: `/Users/drashti/experiments/aws-simulator/learning/system-vault/decisions/example-sibling.md`

Each sibling owns its own worktree, branch, and PR.

## Testing

Unit tests in `web/test/fix-plan-format.test.ts`.

## Group 1: example

- Closes #999

Files:
- /Users/drashti/experiments/aws-simulator/.claude/skills/fix/SKILL.md

Steps:
1. Edit the file.
2. Run the tests.
