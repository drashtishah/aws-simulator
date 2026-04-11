---
id: problem-floor-snap-deletion-race
kind: problem
title: Code-health floor auto-snap captures the pre-deletion count, creating a false bucket_floor advisory
tags: [kind/problem, scope/code, signal/regression, tool/code-health]
created: 2026-04-11
updated: 2026-04-11
source_issues: []
confidence: observed
summary: Running health BEFORE staging a tracked-file deletion captures the wrong floor; the same commit then trips its own bucket_floor advisory
triggers: [bucket_floor advisory, file deletion, npm test before git rm, metrics.config.json floor]
severity: nuisance
solutions: [solution-revert-floor-config-pre-commit]
related_problems: []
---

## Symptom
Commit N deletes a tracked file. The diff also bumps a floor in
`scripts/metrics.config.json` upward by mistake. Health gate at PR
time fires `bucket_floor[X]: bucket X dropped from floor Y to Y-1`
on the very commit that did the cleanup.

## Why it happens
`scripts/code-health.ts` auto-snaps floors UPWARD when current counts
exceed the recorded floor. If you run `npm test` (which calls health)
before staging the deletion, the snap captures the higher count. Then
staging the deletion drops the count below the just-snapped floor,
producing the false-positive advisory in the same commit.

## Explore
- A. [[solution-revert-floor-config-pre-commit]] is the cleanest
  fix: revert metrics.config.json to match the post-deletion actuals
  before committing.
- B. Always stage deletions FIRST, then run npm test. Order discipline
  prevents the snap from racing the deletion.
