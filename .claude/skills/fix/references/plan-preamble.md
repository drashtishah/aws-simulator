# Canonical /fix plan preamble

Every plan written by /fix (via `superpowers:writing-plans`) prepends
the two sections below verbatim. These sections are non-negotiable.

## Workflow

This plan follows the canonical workflow in
`references/architecture/core-workflow.md`. Specifically:

- Issue-first: every plan group references at least one open GitHub
  Issue OR at least one dated feedback note. Orphan-feedback groups
  must propose creating an Issue as their first numbered step.
- Small revertable commits: each group becomes one or more commits,
  each independently revertable via `git revert <sha>`.
- TDD strict: tests first, watch them fail, then implement.
- Verifier subagent separation: the agent that wrote a change must not
  be the agent that verifies it.
- Reference the Issue in every commit body (Closes #N on the last
  commit of a group, Ref #N on the rest).
- After every commit, log one `learning/logs/notes.jsonl` entry via
  `scripts/note.ts` (kind: `finding`, `decision`, `workaround`, or
  `none --reason ...`). This is enforced per session by the Stop hook
  and required per commit by `references/architecture/core-workflow.md`
  section 6b. The notes stream compiles into the system vault, so
  every commit grows long-term agent memory.

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

## File path convention

Every file path in this plan is absolute or repo-root-relative. No bare
filenames. Inline code references use backticks.
