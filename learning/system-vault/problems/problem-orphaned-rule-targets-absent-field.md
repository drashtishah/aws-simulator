---
id: problem-orphaned-rule-targets-absent-field
kind: problem
title: Eval rules targeting a removed field silently pass, inflating pass rate
tags: [kind/problem, scope/pipeline, stage/implementer, signal/regression, tool/eval-runner]
created: 2026-04-14
updated: 2026-04-14
source_issues: [#254]
confidence: observed
summary: Removing a field from eval-runner fieldMap without grepping eval-scoring.yaml leaves orphan rules that return empty string and pass by default
triggers: [extractField fieldMap change, eval-scoring.yaml rule removal, not_contains_any rule, check count assertion change, silent pass inflation]
severity: degraded
solutions: []
related_problems: []
---

## Symptom
In #254 the implementer removed `cp_valid_structure` and
`nb_no_cross_service_refs` because their target field was absent from
`TurnEntry`. Three sibling rules in the `console_purity` category
(`cp_no_analysis_phrases`, `cp_no_hint_text`,
`cp_no_narrator_commentary`) targeted the same absent field
`console_data` but were not removed. `not_contains_any` against an
empty string always passes. Verifier caught the orphans post-impl.
Before: checks skipped (orphan transcript file never existed). After:
checks silently pass, inflating pass rate.

## Why it happens
1. fieldMap removal and rule removal are conceptually linked but
   physically separated across `scripts/eval-runner.ts` and
   `references/config/eval-scoring.yaml`.
2. Planner's diagnostic ("rule targets absent field") was applied to
   the two rules named in the issue, not exhaustively to every rule
   referencing the removed field.
3. Default-pass rule semantics (`not_contains_any` of empty) hides
   the break from unit tests: nothing errors, everything passes.

## Fix
Before committing any fieldMap removal, grep `eval-scoring.yaml` for
every `target:` referencing the removed field. Delete all matching
rule entries in the same commit. Apply the planner's own diagnostic
systematically, not just to named rules. Critic should demand this
grep step whenever a plan touches `extractField`.
