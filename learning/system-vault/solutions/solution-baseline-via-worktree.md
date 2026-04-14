---
id: solution-baseline-via-worktree
kind: solution
title: Establish a master test baseline via worktree, not stash on the main clone
tags: [kind/solution, scope/testing, stage/verifier, tool/git]
created: 2026-04-11
updated: 2026-04-14
source_issues: [#195, #253]
confidence: observed
summary: git worktree add a throwaway master checkout to compare pre-existing test failures; stash/checkout on the main clone leaves generated files dirty
applies_to: [problem-baseline-checkout-contaminates-clone]
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

## When NOT to use
If the pipeline stage already runs in a fresh ephemeral container,
master is already baseline-clean; skip the worktree. See
[[solution-worktree-symlink-node-modules]] to avoid a slow
`npm install` inside the baseline worktree.

## Anti-pattern
`git checkout origin/master -- .` or `git stash && git checkout master`
on the main clone. Regen scripts write outputs that never match on
pop, and partial checkouts leave staged deletions that later reads
silently pick up. See [[problem-baseline-checkout-contaminates-clone]].

## Note
npm test on master may fail for environment reasons unrelated to the
branch (e.g., missing mypy on the runner image). A failing baseline
is still a baseline: compare failure messages, not exit codes.
