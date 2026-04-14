---
id: solution-resummarize-before-ui-commit
kind: solution
title: Re-run agent-browser-summarize right before committing so pre-commit-ui-tests artifact stays aligned with HEAD
tags: [kind/solution, scope/ci, stage/implementer, tool/pre-commit-ui-tests]
created: 2026-04-14
updated: 2026-04-14
source_issues: [#266]
confidence: observed
summary: Re-run agent-browser-summarize just before git commit so committed_at_head and staged_files_hash in the artifact match current HEAD and staged UI files
applies_to: []
preconditions: test agent already produced a valid pass status, but HEAD or staged set moved between that run and commit
cost: trivial
---

## Steps
1. After staging UI edits and before `git commit`, run:
   ```
   tsx scripts/agent-browser-summarize.ts --status pass
   ```
2. The summarizer recomputes `committed_at_head` from current HEAD and
   `staged_files_hash` from currently staged UI files, overwriting
   `web/test-results/agent-browser-latest.json`.
3. `git commit`. The `.claude/hooks/pre-commit-ui-tests.ts` hook
   reads the refreshed artifact, both hashes match, commit proceeds.

## Why this works
The hook enforces freshness, not veracity: it checks that the
artifact's `committed_at_head` equals current HEAD and
`staged_files_hash` equals the hash of staged UI files. Any commit
between the test agent run and the real commit invalidates
`committed_at_head`; any new staged UI file invalidates
`staged_files_hash`. Re-summarizing recomputes both against the
current state.

## When NOT to use
Do not re-summarize to convert a failing test run into a passing one.
Status comes from the `--status` flag you pass, so misuse is possible.
Only re-summarize when the underlying browser test result is still
valid and only the git metadata drifted.
