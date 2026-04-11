---
id: solution-baseline-via-worktree
kind: solution
title: Establish a master test baseline via worktree, not stash on the main clone
tags: [kind/solution, scope/testing, stage/verifier, tool/git]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#195]
confidence: observed
summary: git worktree add a throwaway master checkout to compare pre-existing test failures; stash/checkout on the main clone leaves generated files dirty
applies_to: []
preconditions: master is fetched locally
cost: trivial
---

## Steps
1. Create a throwaway worktree at master:
   ```bash
   git worktree add /tmp/baseline master
   ```
2. Run the same test command you just ran on the branch:
   ```bash
   cd /tmp/baseline && npm test
   ```
3. Diff the failing suites. Failures present in both are pre-existing
   and not a branch regression. Any failure new on the branch is the
   branch's responsibility.
4. Remove when done:
   ```bash
   git worktree remove /tmp/baseline
   ```

For a single-file peek at master (no test run), prefer
`git show master:<path>` over a full checkout.

## Why this works
The stash, `git checkout master`, stash-pop dance on the main clone
can leave tracked files (path-registry.csv, agent-index.md, other
regen outputs) modified after pop, because scripts run during the
master-side command write regenerated content that does not match
the branch state. The worktree is isolated, so any regen stays under
/tmp and the main clone never moves off the branch HEAD.

## When NOT to use
If the pipeline stage already runs in a fresh ephemeral container,
master is already baseline-clean; skip the worktree. See
[[solution-worktree-symlink-node-modules]] to avoid a slow
`npm install` inside the baseline worktree.

## Note
npm test on master may fail for environment reasons unrelated to the
branch (e.g., missing mypy on the runner image). A failing baseline
is still a baseline: compare failure messages, not exit codes.
