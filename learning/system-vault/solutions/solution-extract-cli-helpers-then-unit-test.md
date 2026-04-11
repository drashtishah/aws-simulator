---
id: solution-extract-cli-helpers-then-unit-test
kind: solution
title: Extract per-file logic into pure helpers and unit-test those
tags: [kind/solution, scope/testing, tool/node-test]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#93]
confidence: observed
summary: Pull per-file CLI logic into a pure helper module and unit-test the helper directly; the CLI shrinks to argument parsing only
applies_to: [problem-tsx-test-recursion]
preconditions: the CLI's per-file logic can be expressed as a pure function (input -> output, no global state)
cost: moderate
---

## Steps
1. Identify the part of the CLI that does real work (parse args
   excluded). For sim-test, this was "given a single sim path,
   return pass/fail/details."
2. Move that work into a new module under `scripts/lib/` or
   `scripts/<name>-runner.ts`. Export it as a pure function.
3. The CLI becomes: parse args, call the helper, format output.
4. Write unit tests against the helper. They run inside the same
   tsx --test process with no recursion, so they actually execute.
5. Optional: keep one smoke-test that shells out to the CLI binary
   for argument-parsing coverage. Run it via `node` not `tsx --test`.

## Why this works
The recursion problem only exists when you try to run a test runner
inside a test runner. Pure functions have no test runner; they are
just functions. Testing them is straightforward.

## When NOT to use
If the helper would have to take 10+ arguments to capture all the
CLI's state, the extraction is fighting the design. Reconsider the
CLI's responsibilities first.
