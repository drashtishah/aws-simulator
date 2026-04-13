---
id: problem-plan-scope-change-stale-residue
kind: problem
title: Scope narrowing in plan revision leaves stale sections that burn critic rounds
tags: [kind/problem, scope/pipeline, stage/planner, signal/loop]
created: 2026-04-13
updated: 2026-04-13
source_issues: [#209]
confidence: observed
summary: Planner narrows scope mid-revision but retains duplicate sections from prior scope; critic blocks on contradictions each round
triggers: [plan revised 3+ times, scope checkbox changed between revisions, duplicate section headers in plan body, plan contains content for deferred work]
severity: degraded
solutions: [solution-reread-master-before-plan-revision]
related_problems: [problem-patch-plan-assumes-template-structure]
---

## Symptom
In #209 the planner narrowed from a 3-file split to rank-display.ts
extraction only. The plan body retained two New files sections and two
Files NOT to touch sections: one for the narrow scope, one stale from
the wide scope. Critic blocked on the contradiction. Five plan revisions
hit the cap; human patched manually.

## Why it happens
1. Planner appends revised sections instead of replacing them.
2. Scope narrowing removes work but does not audit every section for
   residue from the dropped scope.
3. patch-plan failed on the non-standard section name, forcing a full
   rewrite that still carried stale content forward.

## Fix
On any scope change, grep the plan body for keywords from the dropped
scope (file names, module names) and delete matching sections before
submitting the revision. Treat scope change as a full-plan rewrite
trigger, not a patch.
