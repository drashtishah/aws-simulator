---
id: problem-plan-ignores-source-invariant-tests
kind: problem
title: Plan edits collide with pre-existing tests that assert on source content
tags: [kind/problem, scope/pipeline, stage/planner, signal/self-correction]
created: 2026-04-15
updated: 2026-04-23
source_issues: [#276, #322, #326]
confidence: observed
summary: Plans that change a file miss pre-existing invariant tests asserting on that file's source content, flipping green tests red post-implementation
triggers: [plan touches source file, pre-existing test reads that file as fs/string, registry.includes or content.match assertion, implementer runs tests and hits unexpected failures]
severity: degraded
solutions: [solution-grep-source-invariants-before-edit]
related_problems: [problem-orphaned-rule-targets-absent-field]
---

## Symptom
In #276 the implementer applied the plan to `scripts/agent-test-runner.ts`
(add `allowedTools: []`) and `web/lib/claude-process.ts` (remove
`bypassPermissions`). Two pre-existing tests flipped:
1. `web/test/agent-test-runner.test.ts` asserted the file must NOT
   contain `allowedTools`; the plan's addition broke it.
2. `web/test/audit-permissions.test.ts` asserted
   `registry.includes('claude-process')` as a "known usage" check;
   removing the bypass made the assertion false.

Implementer caught both by running `npm test` and self-corrected
(dropped the `allowedTools` addition; inverted the registry
assertion). Neither planner nor critic surfaced the conflicts.

## Why it happens
1. Plan template asks for files-to-change and files-to-read, but not
   files-that-test-the-changed-files. Source-invariant tests live in
   a parallel tree (`web/test/`) and do not appear in grep-by-import.
2. Invariant tests read source as a string (`fs.readFileSync`), not
   as an import; standard dependency tracing misses them.
3. Critic reviews plan against the plan template; template does not
   require naming invariant tests, so the omission is not caught.
4. These tests encode contracts decided in earlier PRs; their
   assertions are the contract, not documentation of it.

## Fix
See [[solution-grep-source-invariants-before-edit]]. For every file
the plan edits, grep the test tree for `readFileSync.*<basename>`
and bare string matches of the file path. List every hit in the
plan's Files-to-read and state whether the change will flip the
assertion and how the plan will update the test.
