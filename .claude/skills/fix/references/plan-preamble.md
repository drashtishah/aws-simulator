# Canonical /fix plan preamble

Every plan written by /fix (via `superpowers:writing-plans`) prepends
the two sections below verbatim. These sections are non-negotiable.

## Workflow

**This plan MUST follow `references/architecture/core-workflow.md` end to end. Every section is non-negotiable.** Section 1 (issue-first), section 3 (plan if non-trivial), section 4 (TDD red-green), section 5 (small revertable commits and merge strategy), section 6 (targeted tests), section 6b (note per commit), section 7 (verifier subagent separation), section 8 (revert not history rewrite), section 9 (cleanup including Issue-closure verification). The executing agent does not get to skip, reorder, or reinterpret any section. If a section seems to conflict with the plan, stop and surface the conflict to the human; do not work around core-workflow.md.

The /fix-specific addition: every plan group below cites at least one open Issue created by /fix in step 5b of `.claude/skills/fix/SKILL.md`. Plans never run `gh issue create` (Issue #113).

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

The final group of this plan runs the cleanup commands from `references/architecture/core-workflow.md` section 9, adapted to the plan's own worktree path and branch slug. If this plan is part of a sibling-plan split, each sibling owns its own worktree cleanup; never remove a sibling's worktree from this plan. Cleanup runs only after the PR has merged to master.

## File path convention

Every file path in this plan is absolute or repo-root-relative. No bare
filenames. Inline code references use backticks.
