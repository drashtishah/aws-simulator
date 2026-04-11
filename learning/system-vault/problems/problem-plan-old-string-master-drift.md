---
id: problem-plan-old-string-master-drift
kind: problem
title: Iterated plan old_string block goes stale when master merges mid-revision
tags: [kind/problem, scope/pipeline, stage/planner, signal/loop]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#201]
confidence: observed
summary: Copy-pasted old_string from a prior plan pass goes stale when a sibling PR merges mid-revision; match fails or silently reverts sibling work
triggers: [plan revised 3+ times, copy-pasted old blocks in revised plan, sibling PR merged during planner/critic loop, old_string would revert prior commit]
severity: degraded
solutions: [solution-reread-master-before-plan-revision]
related_problems: []
---

## Symptom
Text-only issue #201 ran 4 planner passes and 4 critic rounds. On pass
3 the critic caught that the plan's Edit C `old_string` for
`references/pipeline/reflector.md` still contained `[skip ci]`, which
sibling PR #204 had removed mid-revision (commit c376288). The planner
had copy-pasted its own pass-2 block instead of re-reading master HEAD.
Two failure modes were live at once: the literal `old_string` would no
longer match, and the `new_string` would have silently reverted PR
#204's prerequisite cleanup. The owner posted a manual heads-up
comment to unblock the loop.

## Why it happens
1. Between revisions the planner's working set is its prior plan, not
   master HEAD. Re-reading every edited file feels redundant.
2. Line-numbered `old:` blocks hide drift: line numbers look stable
   even when content changes under them.
3. Critic rubric does not require a per-pass file re-read; drift is
   only spotted when the critic happens to re-verify each block.
4. Sibling worktrees merge constantly. A 4-round planning loop is long
   enough for at least one unrelated PR to land.

## Fix
See [[solution-reread-master-before-plan-revision]]. On every plan
revision re-read each file being edited from master HEAD and
regenerate both `old:` and `new:` blocks. Prefer content-addressed
anchors over line-number references. Critic should spot-check at least
one `old:` block per pass against master HEAD, not against the prior
plan text.
