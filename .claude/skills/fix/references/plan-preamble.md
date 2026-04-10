# Canonical /fix plan preamble

Every plan written by /fix (via `superpowers:writing-plans`) prepends
the two sections below verbatim. These sections are non-negotiable.

## Workflow

**This plan MUST follow `references/architecture/core-workflow.md` end to end. Every section is non-negotiable.** Section 1 (issue-first), section 3 (plan if non-trivial), section 4 (TDD red-green), section 5 (small revertable commits and merge strategy), section 6 (targeted tests), section 6b (note per commit), section 7 (verifier subagent separation), section 8 (revert not history rewrite), section 9 (cleanup including Issue-closure verification). The executing agent does not get to skip, reorder, or reinterpret any section. If a section seems to conflict with the plan, stop and surface the conflict to the human; do not work around core-workflow.md.

The /fix-specific addition: every plan group below cites at least one open Issue created by /fix in step 5b of `.claude/skills/fix/SKILL.md`. Plans never run `gh issue create` (Issue #113). The final group's Cleanup step includes the doc-sync check from `references/architecture/core-workflow.md` §9 (README, workspace-map, testing-system, doctor, setup, CLAUDE.md), with minimal-change discipline per memory `feedback_minimal_doc_changes.md` (Issue #116).

**Integrity signal**: any time the executing agent feels tempted to weaken a test, relax an assertion, downgrade a FAIL to a WARN or advisory, skip a test, broaden a regex past precision, or extend a skip list to dodge a real signal, it MUST record a `workaround` or `decision` note via `scripts/note.ts` in the moment. Body: what was tempting, why the shortcut was resisted or taken, what was done instead. This matters more for test code than any other category. A committed paper trail is the contract.

If this plan is part of a sibling-plan split, the sibling paths and the parent decision article are listed at the top under a `### Sibling plans` subsection. Each sibling owns its own worktree, branch, and PR; never edit a sibling's files from this plan.

## Testing

This plan tests through the layers documented in
`references/architecture/testing-system.md`. Choose the right layer per
group:

- Unit tests in `web/test/*.test.ts` for pure logic.
- Integration tests in `web/test/` that touch the filesystem or the
  unified log.
- `npx tsx scripts/test.ts run` for the full unit/integration suite.
- Browser tests via the test agent (see `scripts/test.ts agent`)
  for any UI change. The pre-commit-ui-tests hook enforces this.
- `npm run health` after each commit for code-health regressions.

Each plan group must declare which layer applies and which commands the
executing agent will run. TDD red-green is mandatory.

### Test cadence

Every plan follows the three-tier cadence in `references/architecture/core-workflow.md` §6 and memory `feedback_test_cadence.md`:

1. **Inside a TDD red-green cycle**: run ONLY the specific test file you just wrote via `tsx --test --test-force-exit web/test/<name>.test.ts`. Use `superpowers:test-driven-development`.
2. **After every commit**: run `npx tsx scripts/test.ts run --changed --json`. Maps the files in `git diff HEAD~1 HEAD` to their affected tests and runs only that subset (~1 second typical). This is the §6 per-commit rule. Plans NEVER run `npm test` per commit.
3. **At group boundaries** (every 3 to 6 commits): run `npm test` once as a cross-file regression checkpoint.
4. **Before opening the PR**: run `npm test` + `npm run health` + `npm run doctor`. Full verification per §6, §5, §9.

Every `### Group` section in this plan MUST include a `**Test cadence:**` block declaring the three tiers explicitly:

```
**Test cadence:**
- Per commit: `npx tsx scripts/test.ts run --changed --json`
- Group exit: `npm test`
- Pre-PR (last group only): `npm test` + `npm run health` + `npm run doctor`
```

Plans that say `Run: npm test` after a task step are wrong. `npm test` belongs only in Group exit or Pre-PR gate contexts.

## Cleanup

The final group of this plan runs the cleanup commands from `references/architecture/core-workflow.md` section 9, adapted to the plan's own worktree path and branch slug. If this plan is part of a sibling-plan split, each sibling owns its own worktree cleanup; never remove a sibling's worktree from this plan. Cleanup runs only after the PR has merged to master.

## File path convention

Every file path in this plan is absolute or repo-root-relative. No bare
filenames. Inline code references use backticks.
