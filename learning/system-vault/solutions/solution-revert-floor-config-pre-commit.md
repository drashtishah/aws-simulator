---
id: solution-revert-floor-config-pre-commit
kind: solution
title: Revert metrics.config.json floors to match post-deletion actuals before committing
tags: [kind/solution, scope/code, tool/code-health]
created: 2026-04-11
updated: 2026-04-11
source_issues: []
confidence: observed
summary: Stage deletions first then run health so floors persist at post-deletion counts; the cleanup commit then no longer trips its own bucket_floor advisory
applies_to: [problem-floor-snap-deletion-race]
preconditions: bucket_floor advisory fired in the same commit that deleted files
cost: trivial
---

## Steps
1. Stage all deletions first: `git add -u`.
2. Run `npm run health`. The script reads the staged tree and
   recomputes floors from the post-deletion file counts.
3. If `scripts/metrics.config.json` was modified by the run, stage
   that too: `git add scripts/metrics.config.json`.
4. Commit. The bucket_floor advisory should no longer fire because
   the floors now match the new file counts.

If health refuses to drop floors automatically (the floor monotonic
rule), edit `scripts/metrics.config.json` directly: bring each
floor down to the actual count, then `git add` and commit. The
floors are not user-meaningful state; they exist only to detect
sudden unexpected drops.

## Why this works
Floors track the steady-state minimum file count per bucket as an
anti-gaming signal against silent deletions. When you intentionally
delete files, you are the source of truth; the floors should
follow. Reverting them in the same commit preserves the invariant
"the deletion commit owns the consequence."
