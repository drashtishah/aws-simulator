# Plan validator checklist

/fix runs this checklist as step 5c (Issue validation) and step 6b (plan validation) in `.claude/skills/fix/SKILL.md`. Failing checks block handback to the user until fixed. Issue #118.

The validator is a **checklist agents walk manually**, not a runnable script. /fix reads this file in-session and applies each check against the Issue body (via `gh issue view <N> --json body`) or the plan file.

## Step 5c: Issue checklist

Run this checklist against EVERY Issue created in step 5b. Fail loudly on the first missing field; do not proceed to step 6 until every Issue passes.

- [ ] **Context** section present. Explains the user story, the incident, or the feedback quote that triggered the Issue.
- [ ] **Current state** section present. Contains at least one grep/sed/gh/file:line command used to verify the claim. Never "as of recent, X is..." without a verification command.
- [ ] **Scope** section present. Contains exact file:line refs AND the literal edit content (old_string / new_string) for every file that will be touched. Small edits must be quoted verbatim; large edits may be summarized but the function name and starting line must be named.
- [ ] **Architecture note** section present. Names any module or subsystem boundary the edit crosses, any new file created, or "no architectural change" if applicable.
- [ ] **Out of scope** section present. Explicitly lists what the Issue is NOT doing, to prevent scope creep during implementation.
- [ ] **Verification** section present. Contains the exact test file path(s), the exact test command the executing agent will run, AND the phrase "Verified by separate subagent" so the subagent-driven-development skill can verify the claim.
- [ ] **Refers to** section present. Links every related Issue number and the memory / decision article / commit SHA that motivated this Issue.

If any checkbox is missing, run `gh issue edit <N> --body-file /tmp/issue-<N>-body.md` to patch the Issue body, then re-run the checklist. Do NOT delete and recreate the Issue — that loses the Issue number the plan has already been written against.

## Step 6b: Plan checklist

Run this checklist against EVERY plan file produced in step 6. Fail loudly on the first missing field; do not proceed to step 7 until the plan passes.

- [ ] **Every Group section cites at least one Issue number.** Look for `#\d+` or `Closes #\d+` inside every `### Group` section. Orphan groups (no Issue) are forbidden.
- [ ] **Every Group has a Test layer declaration.** One of: unit, integration, sim-test, browser (via sim-test agent), health, markdown.
- [ ] **Every Group declares a per-group test cadence.** Must name what runs per commit (typically `sim-test --changed`), what runs at group exit (typically `npm test`), and what runs pre-PR (typically `npm test + npm run health + npm run doctor`). See `feedback_test_cadence.md`.
- [ ] **Every file path is root-relative or absolute.** No bare filenames. `SKILL.md` without a directory is a fail; `.claude/skills/fix/SKILL.md` or `/Users/.../SKILL.md` passes.
- [ ] **No `gh issue create` anywhere in the plan body.** /fix is the sole Issue creator (Issue #113). The plan references numbers only.
- [ ] **Workflow section references `references/architecture/core-workflow.md`** by §section numbers, not literal duplication.
- [ ] **Cleanup section present** and names the worktree path, branch slug, and Issue numbers to verify closed (per core-workflow.md §9).

If any checkbox fails, edit the plan file in place (plans are gitignored scratch space; no commit churn) and re-run the checklist.

## Manual dry-run (regression check)

Before shipping a new validator rule, `/fix` authors can run a manual dry-run against a known-bad plan fixture. Drop a deliberately broken plan into `.claude/plans/_test-bad.md` with one rule violation per file (missing Issue ref, missing Test cadence, bare filename, `gh issue create` line). Walk the checklist by hand and confirm each violation is caught. Delete the fixture after the test. No committed regression fixture exists: the checklist is the contract, and the tests in `web/test/plan-thin-shape.test.ts` (Issue #115) provide the automated backstop against the subset of rules that are grep-checkable.
