---
id: problem-plan-targets-gitignored-path
kind: problem
title: Plan targets a gitignored path, implementation produces zero committable diff
tags: [kind/problem, scope/pipeline, stage/planner, signal/loop]
created: 2026-04-23
updated: 2026-04-23
source_issues: [#325]
confidence: observed
summary: Plan names a file under a gitignored glob; implementer writes it, commit contains no changes, critic only catches it after reviewing content
triggers: [plan Files-to-change under learning/, plan Files-to-change under any path with negative-allowlist gitignore, planner never reads .gitignore, critic reviews plan content before checking tracked-status]
severity: degraded
solutions: [solution-critic-check-gitignore-for-plan-paths]
related_problems: [problem-plan-ignores-source-invariant-tests]
---

## Symptom
In #325 the first plan targeted `learning/feedback.md`. `.gitignore`
line 2 is `learning/*` with only `!learning/system-vault/` exempted;
any file created at `learning/feedback.md` would not be tracked, so
the implementer's commit would contain zero changes. Critic caught
it on round 1 but only after full content review. Four plan rounds
followed: add `.gitignore` allowlist line, restate scope, cite
classification authority, tighten verification regex. Implementer ran
cleanly once the plan was actionable.

## Why it happens
1. Plan template lists Files-to-change and Files-to-read but does not
   require a tracked-status check.
2. `learning/` uses a broad glob ignore plus narrow allowlist; the
   exclusion is not obvious from filename alone.
3. Critic reads plan content (scope, steps, verification) before
   checking invariants, so the gitignore conflict is not surfaced
   until one or two critique cycles in.
4. Once caught, reclassifying a path as tracked requires citing an
   authority (prior issue, doc), which itself takes multiple
   revisions to get right.

## Fix
See [[solution-critic-check-gitignore-for-plan-paths]]. For every
path in Files-to-change, the critic runs `git check-ignore` before
reading plan prose. If the path is ignored, the plan is
non-actionable until it either moves to a tracked location or adds
an explicit `!` allowlist line with justification.
