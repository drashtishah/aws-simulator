---
id: solution-revert-to-let-sibling-win
kind: solution
title: Revert your direct commit so the sibling PR can land cleanly
tags: [kind/solution, scope/skills, tool/git]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#126]
confidence: observed
summary: When a sibling worktree owns the same scope, git revert your direct commit so the richer sibling PR merges cleanly
applies_to: [problem-sibling-issue-collision]
preconditions: the sibling branch has a richer or more complete version of the same change
cost: trivial
---

## Steps
1. Confirm the sibling branch has a richer change:
   ```bash
   git fetch origin
   git diff HEAD origin/<sibling-branch> -- <conflicted-paths>
   ```
2. Revert your direct commit (not amend, not force-push):
   ```bash
   git revert <your-direct-commit-sha>
   git push origin master
   ```
3. Comment on the sibling PR linking your revert SHA so the merge
   order is auditable.
4. Let the sibling PR merge through its normal flow.

## Why this works
`git revert` creates a new commit, so the original direct commit
stays in history (auditable) but its effect is undone. The sibling
branch can fast-forward merge without conflicts.

## When NOT to use
If your direct commit contained NEW work the sibling has not yet
done, do not revert blindly. Either coordinate with the sibling to
fold your work in, or accept the merge conflict and resolve it
manually. See [[solution-search-issues-before-create]] for the
prevention path.
