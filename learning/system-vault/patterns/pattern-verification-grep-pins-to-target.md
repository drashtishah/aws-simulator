---
id: pattern-verification-grep-pins-to-target
kind: pattern
title: Verification greps must pin to the exact target, not a blanket pattern
tags: [kind/pattern, scope/pipeline, stage/planner, signal/insight]
created: 2026-04-23
updated: 2026-04-23
source_issues: [#326]
confidence: observed
summary: Issue verification greps using broad regex match pre-existing legitimate code, so the check never reaches zero even after a correct fix
principle: a verification grep must match only code the fix removes; if it also matches out-of-scope code, reword it to the specific symbol or path being changed
counter_examples: []
---

## Rule
When an issue lists a grep as its verification command, scope the
pattern to the exact symbol, import path, or line being removed. A
blanket regex over an import family keeps matching legitimate
pre-existing imports, so the check cannot reach 0 after a correct fix.

## Why
In #326 the issue's check was `grep -rn "^import .* from .*scripts/"
web/lib/`. The stated problem was one violating import
(`scripts/consolidator`), but `web/lib/claude-process.ts` and
`web/lib/claude-stream.ts` already held `scripts/model-config` imports
that were out of scope. The blanket grep would never reach 0 even
after a correct fix, forcing the planner to replace the check with a
targeted `scripts/consolidator` grep mid-pipeline.

## How to apply
1. Identify the exact symbol or path being removed (e.g.
   `scripts/consolidator`), not the family (`scripts/`).
2. Write the verification grep against that exact target.
3. If a broader grep is unavoidable, list known legitimate hits and
   assert on the count delta, not 0.
4. Before writing the plan, dry-run the verification grep against
   master and note the starting count; if it is already nonzero on
   master, the check needs a qualifier, not a rewrite mid-pipeline.
