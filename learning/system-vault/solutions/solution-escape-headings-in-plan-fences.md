---
id: solution-escape-headings-in-plan-fences
kind: solution
title: Escape markdown headings inside plan code fences to prevent false section anchors
tags: [kind/solution, scope/pipeline, stage/planner, cost/trivial]
created: 2026-04-13
updated: 2026-04-13
source_issues: [#237]
confidence: observed
summary: Use four-backtick fences or escape ### as \### when plan edits contain markdown headings to avoid patch-plan false anchors
applies_to: [problem-patch-plan-assumes-template-structure]
preconditions: [plan edit contains file content with markdown headings]
cost: trivial
---

## When to use
Any plan revision that includes file edits containing `### ` headings
(SKILL.md, README, any markdown file). GitHub renders triple-backtick
fences containing `### ` as real headers when the fence is inside a
list item, creating false section anchors for patch-plan.

## How
1. Wrap file-content blocks in four-backtick fences (````), not three.
2. Alternatively, escape heading markers: `\### ` instead of `### `.
3. Never nest triple-backtick fences inside `- new:` bullet lists;
   GitHub's list-item parser terminates the fence early.

## Why trivial
Zero cost. Planner changes one character per fence. Prevents the
structural damage that caused a full body rewrite and extra critic
round in #237.
