---
id: solution-fence-aware-patch-body
kind: solution
title: Fence-aware line tokenizer in patchBody prevents false section anchors
tags: [kind/solution, scope/pipeline, stage/planner, cost/trivial]
created: 2026-04-13
updated: 2026-04-13
source_issues: [#246]
confidence: observed
summary: patchBody splits on newlines, tracks fence state, and only matches ### headers outside code fences
applies_to: [problem-patch-plan-assumes-template-structure]
preconditions: [plan body contains code fences with markdown headings]
cost: trivial
---

## When to use
Callee-side defense: always active in `scripts/patch-plan.ts`.
Complements [[solution-escape-headings-in-plan-fences]] (caller-side).

## How
1. Split body into lines; track fence state via `/^(`{3,}|~{3,})/`.
2. Only lines outside fences matching `### <section>` are section anchors.
3. Byte-position arithmetic reconstructs slices for replacement.

## Why trivial
Single-function rewrite (~28 lines changed). No API or caller changes.
Existing tests pass; one new test covers the fenced-heading case.
