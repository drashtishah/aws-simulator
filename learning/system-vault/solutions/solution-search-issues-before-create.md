---
id: solution-search-issues-before-create
kind: solution
title: Always run gh issue list before gh issue create
tags: [kind/solution, scope/skills, tool/gh]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#126, #151]
confidence: observed
summary: gh issue list --state all --search before gh issue create; prefer commenting on existing Issues over creating duplicates that race siblings
applies_to: [problem-sibling-issue-collision]
preconditions: gh CLI is authenticated for this repo
cost: trivial
---

## Steps
1. Pick the 2 to 3 strongest keywords from the proposed Issue title.
2. Run:
   ```bash
   gh issue list --state all --search "<keyword1> <keyword2>" --json number,title,state,labels
   ```
   Use `--state all` so closed dupes show up too. Use `--state open`
   if you only care about live races.
3. If a hit looks substantively related, prefer commenting on the
   existing Issue over creating a new one.
4. If you must create, link the existing Issue in the new Issue body
   for backwards traceability.

## Why this works
The dedupe is constant-time (one gh call) and catches both stale
duplicates and live sibling work. Empirically, the alternative
(create-then-revert) costs a master commit, a force-push window,
and a frustration episode.
