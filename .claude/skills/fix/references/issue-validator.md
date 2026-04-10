# Issue validator checklist

/fix runs this checklist as step 4 (Issue validation) in `.claude/skills/fix/SKILL.md`. Failing checks block handback to the user until fixed. Issue #118.

The validator is a **checklist agents walk manually**, not a runnable script. /fix reads this file in-session and applies each check against the Issue body (via `gh issue view <N> --json body`).

## Issue checklist

Run this checklist against EVERY Issue created in step 3. Fail loudly on the first missing field; do not proceed to step 5 until every Issue passes.

- [ ] **Context** section present. Explains the user story, the incident, or the feedback quote that triggered the Issue.
- [ ] **Current state** section present. Contains at least one grep/sed/gh/file:line command used to verify the claim. Never "as of recent, X is..." without a verification command.
- [ ] **Scope** section present. Contains exact file:line refs AND the literal edit content (old_string / new_string) for every file that will be touched. Small edits must be quoted verbatim; large edits may be summarized but the function name and starting line must be named.
- [ ] **Architecture note** section present. Names any module or subsystem boundary the edit crosses, any new file created, or "no architectural change" if applicable.
- [ ] **Out of scope** section present. Explicitly lists what the Issue is NOT doing, to prevent scope creep during implementation.
- [ ] **Verification** section present. Contains the exact test file path(s), the exact test command the executing agent will run, AND the phrase "Verified by separate subagent" so the verifier workflow can verify the claim.
- [ ] **Refers to** section present. Links every related Issue number and the memory / decision article / commit SHA that motivated this Issue.

If any checkbox is missing, run `gh issue edit <N> --body-file /tmp/issue-<N>-body.md` to patch the Issue body, then re-run the checklist. Do NOT delete and recreate the Issue.
