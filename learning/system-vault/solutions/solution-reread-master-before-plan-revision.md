---
id: solution-reread-master-before-plan-revision
kind: solution
title: Re-read master HEAD before each plan revision, use content-addressed old/new blocks
tags: [kind/solution, scope/pipeline, stage/planner, cost/trivial]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#201]
confidence: observed
summary: On each planner revision re-read every edited file from master HEAD and regenerate old/new blocks; never copy them from the prior plan
applies_to: [problem-plan-old-string-master-drift]
preconditions: [planner/critic loop reached revision 2 or later, master is mutable during planning]
cost: trivial
---

## When to use
Any time the planner is writing a REVISE-response plan. The prior plan
is a draft, not source of truth: the file on master may have mutated
while the critic was reviewing.

## How
1. Before transcribing any `old:` block in a revision pass, Read the
   target file from master HEAD. Do not copy from the prior plan.
2. Use content-addressed anchors: quote a unique phrase near the edit
   site so the block survives line-number shifts.
3. If the original `old:` no longer matches, regenerate both `old:`
   and `new:`, and announce the drift in the plan so the critic
   notices. Silent rewrites mask the real cause of the next bug.
4. Critic: pick one `old:` block per pass, diff it against
   `git show origin/master:<path>`, and fail the plan if it drifts.
   Do not trust transcription alone.

## Why trivial
One extra Read per edited file per revision. Cheap compared to a
4-round planning loop that would have reverted a sibling PR. In #201
the cost of the missed drift was one manual owner intervention and
one more full critic round.

## Related
- [[problem-plan-old-string-master-drift]] the failure mode this guards against
