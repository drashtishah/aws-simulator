---
id: problem-patch-plan-assumes-template-structure
kind: problem
title: patch-plan fails when issue body lacks plan-template section headers
tags: [kind/problem, scope/pipeline, stage/planner]
created: 2026-04-12
updated: 2026-04-12
source_issues: [#217]
confidence: observed
summary: patch-plan calls fail on free-form issue specs because they expect template section headers to already exist in the body
triggers: [free-form issue body without plan-template headers, planner uses patch-plan on non-templated issue]
severity: degraded
solutions: []
related_problems: []
---

## Symptom
In #217 the issue body was a free-form spec (no Scope, Files to read,
Files to change sections). The planner's patch-plan calls failed
because they require those section headers to already exist in the
issue body as anchors.

## Why it happens
patch-plan edits the issue body in place by matching section headers.
When the issue is written as a plain spec rather than following
`references/pipeline/plan-template.md`, there are no headers to match.

## Fix
When the issue body does not follow the template structure, write the
full plan directly instead of patching. Detect template compliance
first: grep for `### Scope`, `### Files to change`, or similar
anchors. If absent, skip patch-plan and write the complete plan body.
