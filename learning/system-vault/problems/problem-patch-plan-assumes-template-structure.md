---
id: problem-patch-plan-assumes-template-structure
kind: problem
title: patch-plan fails when issue body lacks plan-template section headers
tags: [kind/problem, scope/pipeline, stage/planner, signal/loop]
created: 2026-04-12
updated: 2026-04-13
source_issues: [#217, #209, #236, #237, #246]
confidence: observed
summary: patch-plan calls fail on free-form issue specs because they expect template section headers to already exist in the body
triggers: [free-form issue body without plan-template headers, planner uses patch-plan on non-templated issue, plan contains non-standard section names like New files that patch-plan cannot match, template-defined section (Files NOT to touch) absent from patch-plan valid-sections list, plan edit embeds markdown headings inside code fences that GitHub renders as real section headers creating false indexOf anchors]
severity: degraded
solutions: [solution-escape-headings-in-plan-fences, solution-fence-aware-patch-body]
related_problems: [problem-plan-scope-change-stale-residue]
---

## Symptom
In #217 the issue body was a free-form spec (no Scope, Files to read,
Files to change sections). The planner's patch-plan calls failed
because they require those section headers to already exist in the
issue body as anchors.

In #237 the plan embedded `### ` headings inside triple-backtick fences
(SKILL.md edit steps). GitHub rendered them as real section headers,
creating duplicate anchors. patch-plan matched the false anchors,
exited 0, but left orphaned content between duplicate headers. No
sanctioned recovery path exists: full rewrite triggers only on non-zero
exit.

## Why it happens
patch-plan edits the issue body in place by matching section headers.
When the issue is written as a plain spec rather than following
`references/pipeline/plan-template.md`, there are no headers to match.
When plan content itself contains `### ` strings (even inside fences),
GitHub Markdown rendering promotes them to real headers, and patch-plan
finds false positives via indexOf.

## Fix
When the issue body does not follow the template structure, write the
full plan directly instead of patching. Detect template compliance
first: grep for `### Scope`, `### Files to change`, or similar
anchors. If absent, skip patch-plan and write the complete plan body.
For embedded headings, use four-backtick fences or escape as `\###`.
Callee-side fix landed in #246: patchBody now uses a fence-aware line
tokenizer, ignoring `### ` inside backtick or tilde fences.
