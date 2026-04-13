---
id: problem-misapplied-label-persists-through-pipeline
kind: problem
title: Misapplied issue label persists through all pipeline stages
tags: [kind/problem, scope/pipeline, signal/waste]
created: 2026-04-12
updated: 2026-04-12
source_issues: [#218]
confidence: observed
summary: A wrong label applied at issue creation persists through every pipeline stage because no stage can remove or correct labels
triggers: [label does not match file scope, critic flags label mismatch, verifier runs irrelevant checks]
severity: nuisance
solutions: []
related_problems: []
---

## Symptom
Issue #218 (text/docs only, 5 pipeline prompt files) was labeled `ui`.
The critic flagged the mismatch in 3 consecutive reviews. The label
persisted to the verifier, which noted that browser-testing requirements
were inapplicable but could not remove the label either.

## Why it happens
1. Labels are set at issue creation or by the dispatcher. No downstream
   stage (critic, planner, implementer, verifier) removes labels.
2. The critic can only request plan revisions, not label changes.
3. The `ui` label injects browser-testing instructions into the verifier
   prompt. When inapplicable, the verifier wastes cycles acknowledging
   irrelevant requirements.

## Fix
Not yet implemented. Candidate: give the critic or planner a
`gh issue edit --remove-label` step when the label demonstrably
does not match the file scope in the plan.
