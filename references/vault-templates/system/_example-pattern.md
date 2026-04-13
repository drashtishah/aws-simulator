---
id: pattern-surgical-changes
kind: pattern
title: Prefer the smallest diff that resolves the symptom
tags: [kind/pattern, scope/vault]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#165]
confidence: observed
summary: Karpathy rule; one concept per commit, revertable via git revert, no collateral refactors or speculative abstractions
principle: smallest diff that resolves the symptom, nothing more
counter_examples: []
---

## Rule
When resolving an incident, change only what the incident requires. No
surrounding cleanup, no "while I'm here" refactors, no speculative
abstractions.

## Why
Surgical diffs are cheaper to review, safer to revert, and easier to
reason about across the git log. Bundled cleanup hides the root cause
behind noise.

## Counter examples
None recorded yet. A counter example would be a case where bundling
unrelated cleanup saved effort net-net; file one via the evaluator if
you hit it.
