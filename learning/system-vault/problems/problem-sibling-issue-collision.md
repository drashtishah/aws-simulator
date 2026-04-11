---
id: problem-sibling-issue-collision
kind: problem
title: Ad-hoc commit duplicates work a live sibling worktree already owns
tags: [kind/problem, scope/skills, signal/loop, signal/frustration]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#126, #151]
confidence: observed
summary: Direct commit or new Issue while a sibling worktree owns the same scope creates an inferior duplicate that requires a revert
triggers: [gh issue create without search, direct commit during sweep, sibling worktree active, duplicate Issue]
severity: degraded
solutions: [solution-search-issues-before-create, solution-revert-to-let-sibling-win]
related_problems: []
---

## Symptom
A sibling worktree was actively working on Issue #126 (a richer
14-line .yml + workspace-map paragraph). Without searching the open
Issue list, an ad-hoc Issue #151 was created and a 2-line direct
commit landed on master as bc78057. The sibling's PR then could not
merge cleanly. Revert d8513f0 unwound the direct commit so the
sibling could land. Logged as a frustration: real gut-drop, the
sibling had done the work better and the race was caused by ignorance.

## Why it happens
1. Mid-session focus blinds you to the open-Issue list.
2. `gh issue create` has no built-in dedupe.
3. Sibling worktrees write to remote branches, not master, so
   their work is invisible to a local `git log master`.

## Explore (try one, then another)
- A. [[solution-search-issues-before-create]] is the cheapest
  prevention; one extra command before any create.
- B. [[solution-revert-to-let-sibling-win]] is the recovery once
  collision has happened; pair with a comment on the duplicate
  Issue explaining the merge order.
