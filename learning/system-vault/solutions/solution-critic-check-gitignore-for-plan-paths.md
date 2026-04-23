---
id: solution-critic-check-gitignore-for-plan-paths
kind: solution
title: Critic cross-checks .gitignore against Files-to-change before reviewing plan content
tags: [kind/solution, scope/pipeline, stage/critic, cost/trivial]
created: 2026-04-23
updated: 2026-04-23
source_issues: [#325]
confidence: observed
summary: For every path in Files-to-change, run git check-ignore first; if matched, block plan until path is moved or an explicit allowlist line is added
applies_to: [problem-plan-targets-gitignored-path]
preconditions: [repo uses negative-allowlist gitignore patterns, plan Files-to-change lists concrete paths]
cost: trivial
---

## When to use
Any plan whose Files-to-change includes a path under a broadly
ignored directory (`learning/`, `node_modules/`, `dist/`, build
artifacts). Especially repos with `<dir>/*` plus `!<dir>/<allowed>/`
patterns where tracked status hinges on narrow allowlist lines.

## How
1. Before reading plan prose, extract every path from
   Files-to-change.
2. For each path, run `git check-ignore -v <path>`. Exit 0 means
   ignored; exit 1 means tracked.
3. If any path is ignored, block the plan. Require one of:
   - Move the path to a tracked location.
   - Add an explicit allowlist line in Files-to-change with old/new
     block and cite the authority that permits tracking.
4. Only after paths pass this check, proceed to content review.

## Why trivial
One `git check-ignore` per edited path at critic time. In #325 the
skipped check cost three extra critic rounds while the plan was
rewritten to add the allowlist line, reclassify scope from
reconciliation to new authoring, and cite a tracking authority.
Catching at round 0 collapses those rounds into one.

## Related
- [[problem-plan-targets-gitignored-path]] the failure mode
- [[solution-grep-source-invariants-before-edit]] same family: cheap
  critic-time grep that prevents multi-round revisions
