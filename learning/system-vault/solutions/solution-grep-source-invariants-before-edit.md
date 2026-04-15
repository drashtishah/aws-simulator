---
id: solution-grep-source-invariants-before-edit
kind: solution
title: Grep the test tree for source-invariant assertions before planning an edit
tags: [kind/solution, scope/pipeline, stage/planner, cost/trivial]
created: 2026-04-15
updated: 2026-04-15
source_issues: [#276]
confidence: observed
summary: Before finalizing a plan, grep the test tree for readFileSync/execSync/string-literal references to each edited file and reconcile flipped assertions
applies_to: [problem-plan-ignores-source-invariant-tests]
preconditions: [plan edits one or more source files, repo has tests that read source via fs]
cost: trivial
---

## When to use
Any plan that modifies a `.ts`, `.js`, or `.md` file in a repo where
tests read source content as strings. Common shapes: contract
tests, audit-registry tests, permission-policy tests, config-drift
tests.

## How
1. For each file in Files-to-change, run:
   `rg "readFileSync.*<basename>|execSync.*<basename>|'<path>'" --glob 'web/test/**' --glob 'test/**'`
2. Also grep for the file's registry-visible name (e.g.
   `claude-process` when editing `claude-process.ts`) in case tests
   assert on audit output rather than source directly.
3. For every hit, read the assertion. State in the plan whether the
   planned change flips the assertion. If yes, add the test to
   Files-to-change with an `old:` / `new:` block.
4. Critic: when reviewing a plan, spot-check one edited file by
   running the grep from step 1. Fail the plan if a flipped
   assertion is not addressed.

## Why trivial
One ripgrep per edited file at plan time. In #276 the skipped grep
cost the implementer two test-fix commits and a self-correction
reflection. Catching it at plan time keeps the implementer's diff
scoped to what the plan promised.

## Related
- [[problem-plan-ignores-source-invariant-tests]] the failure mode
- [[problem-orphaned-rule-targets-absent-field]] same family: a
  config change that leaves paired rules dangling in a sibling file
