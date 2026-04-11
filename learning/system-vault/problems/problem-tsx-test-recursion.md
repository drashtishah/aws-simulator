---
id: problem-tsx-test-recursion
kind: problem
title: tsx --test refuses to run itself recursively
tags: [kind/problem, scope/testing, tool/tsx, tool/node-test]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#93]
confidence: observed
summary: Spawning tsx --test from inside a tsx --test process via execSync silently skips the inner suite and exits 0; outer test reports false PASS
triggers: [tsx --test, execSync from test, run() being called recursively, integration test silent pass]
severity: degraded
solutions: [solution-extract-cli-helpers-then-unit-test]
related_problems: []
---

## Symptom
A test file calls `execSync('tsx --test ...')` to integration-test
another tsx-driven CLI. The inner process emits
`run() being called recursively, skipping running files` to stderr
and exits 0. The outer test reports PASS even though the inner
suite never ran.

## Why it happens
node:test detects that it is already running and refuses to bootstrap
a second test runner in the same process tree. tsx inherits this
behavior. The skip is silent (exit 0) which makes the failure mode
invisible to the outer test.

## Explore
- A. [[solution-extract-cli-helpers-then-unit-test]] is the right
  shape: pull the per-file logic into a pure function and unit-test
  the function directly. Avoids the recursion entirely.
- B. Spawn the inner CLI via `node` (not `tsx --test`) if you must
  do a true subprocess test. Slower and more brittle than option A.
