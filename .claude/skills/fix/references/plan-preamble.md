# Canonical /fix plan preamble

Every plan written by /fix (via `superpowers:writing-plans`) prepends
the two sections below verbatim. These sections are non-negotiable.

## Workflow

This plan follows `references/architecture/core-workflow.md` end to end (section 1 issue-first, section 3 plan if non-trivial, section 4 TDD red-green, section 5 small revertable commits and merge strategy, section 6 targeted tests, section 6b note per commit, section 7 verifier subagent separation, section 8 revert not history rewrite, section 9 cleanup). The /fix-specific addition: every plan group below cites at least one open Issue created by /fix in step 5b of `.claude/skills/fix/SKILL.md`. Plans never run `gh issue create` (Issue #113).

If this plan is part of a sibling-plan split, the sibling paths and the parent decision article are listed at the top under a `### Sibling plans` subsection. Each sibling owns its own worktree, branch, and PR; never edit a sibling's files from this plan.

## Testing

This plan tests through the layers documented in
`references/architecture/testing-system.md`. Choose the right layer per
group:

- Unit tests in `web/test/*.test.ts` for pure logic.
- Integration tests in `web/test/` that touch the filesystem or the
  unified log.
- `npx tsx scripts/sim-test.ts run` for the full unit/integration suite.
- Browser tests via the sim-test agent (see `scripts/sim-test.ts agent`)
  for any UI change. The pre-commit-ui-tests hook enforces this.
- `npm run health` after each commit for code-health regressions.

Each plan group must declare which layer applies and which commands the
executing agent will run. TDD red-green is mandatory.

## Cleanup

This plan follows the worktree-cleanup rules in
`references/architecture/core-workflow.md` section 9. The final group of
this plan runs the section 9 commands adapted to the plan's own
worktree path and branch slug. If this plan is part of a sibling-plan
split, each sibling owns its own worktree cleanup; never remove a
sibling's worktree from this plan. Cleanup runs only after the PR has
merged to master.

**Explicit Issue-closure step**: section 9 requires verifying that every Issue referenced by this plan is closed after the PR merges. Auto-close via the `Closes #N` commit trailer usually works, but can fail silently (typo, trailer on the wrong commit, rebase re-author, branch protection). The executing agent MUST run the section 9 verification query, `gh issue list --state open --search "<space-separated issue numbers referenced by this plan>"`, as the final cleanup action. Any still-open Issue must be manually closed with `gh issue close <N> --comment "Closed by PR #<pr>, see <merge-sha>"` before the cleanup group is complete.

## File path convention

Every file path in this plan is absolute or repo-root-relative. No bare
filenames. Inline code references use backticks.
