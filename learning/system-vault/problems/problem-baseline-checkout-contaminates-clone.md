---
id: problem-baseline-checkout-contaminates-clone
kind: problem
title: Running a master checkout on the main clone contaminates feature-branch reads
tags: [kind/problem, scope/testing, stage/verifier, tool/git, signal/loop]
created: 2026-04-14
updated: 2026-04-14
source_issues: [#195, #253]
confidence: observed
summary: Checking out master files onto the main clone to probe a baseline leaves the feature branch working tree dirty; subsequent reads return master content
triggers: [git checkout master -- ., git checkout origin/master -- path, stash + checkout master + pop, verifier probing baseline test failures, feature-branch file reads return master content mid-verify]
severity: degraded
solutions: [solution-baseline-via-worktree, solution-worktree-symlink-node-modules]
related_problems: []
---

## Symptom
Verifier or implementer wants to know whether a failing test is
pre-existing on master. They run `git checkout origin/master -- .` or
`git stash && git checkout master` on the main clone. The working tree
now holds master content; later reads of feature-branch files return
master snapshots and tests appear to regress in both directions.

## Why it happens
1. Main clone is feature branch's working tree; mutating it for a
   one-off probe rarely resets cleanly.
2. Regen scripts (path-registry, agent-index) triggered during the
   probe write outputs that do not match either branch on pop.
3. Partial `git checkout origin/master -- .` leaves staged deletions
   and reintroduced files silently; `git status` noise hides the
   contamination across several commands.

## Fix
See [[solution-baseline-via-worktree]]. Add a throwaway worktree at
master and run the baseline there; main clone never moves.
For a single-file peek use `git show master:<path>` instead of a
checkout. Use [[solution-worktree-symlink-node-modules]] if the
baseline worktree needs node_modules.
