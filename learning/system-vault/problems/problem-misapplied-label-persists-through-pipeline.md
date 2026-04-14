---
id: problem-misapplied-label-persists-through-pipeline
kind: problem
title: Misapplied issue label persists through all pipeline stages
tags: [kind/problem, scope/pipeline, signal/waste, signal/loop]
created: 2026-04-12
updated: 2026-04-14
source_issues: [#218, #254]
confidence: observed
summary: Wrong label applied at issue creation persists because workflow re-applies it across stages, even after critic removal
triggers: [label does not match file scope, critic flags label mismatch, verifier runs irrelevant checks, ui label reapplied after removal]
severity: nuisance
solutions: []
related_problems: []
---

## Symptom
Issue #218 (text/docs, 5 pipeline prompt files) was labeled `ui`.
Critic flagged mismatch in 3 consecutive reviews. Issue #254 showed
the same pattern: scope touched `web/lib/*.ts`, `scripts/*.ts`,
`references/**`, zero `ui` files. Critic removed `ui` via
`gh issue edit --remove-label`, but the next stage dispatch re-applied
it. Third consecutive `ui` relabel on #254 without the issue touching
ui files.

## Why it happens
1. Labels are set at issue creation or by the dispatcher. No
   downstream stage owns label correctness.
2. Critic can now remove labels, but dispatcher re-applies them on
   next stage handoff, so removal is not durable across stages.
3. The `ui` label injects browser-testing instructions into the
   verifier prompt. When inapplicable, the verifier wastes cycles
   acknowledging irrelevant requirements.

## Fix
Not fully implemented. Critic-level removal is necessary but not
sufficient. Durable fix: dispatcher must stop re-applying labels that
a prior stage removed, or label-routing must be computed from plan
scope rather than issue-creation metadata.
