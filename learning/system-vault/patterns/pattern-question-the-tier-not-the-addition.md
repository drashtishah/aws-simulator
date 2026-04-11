---
id: pattern-question-the-tier-not-the-addition
kind: pattern
title: When a proposed addition's killer use case is already covered, question the whole tier
tags: [kind/pattern, scope/testing, signal/scope-creep]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#106, #123]
confidence: observed
summary: If the strongest justification for a new feature is already handled by an existing layer, do not weaken it; reassess whether the tier itself pulls weight
principle: when a proposed addition's killer use case is already covered, question the whole tier, not just the addition
counter_examples: []
---

## Rule
When you propose adding feature X to layer L, and the user points out
that the strongest justification for X is already handled by another
layer, the right move is to reassess whether L is pulling weight, not
to find a weaker justification for X.

## Why
Concrete instance: proposed adding a learner persona to Layer 3 of the
test stack to cover teaching quality. User pointed out teaching
quality is already covered by Layer 4 evals (11 categories, 7 directly
about teaching). Instead of finding a weaker reason for the persona,
the honest move was to reassess whether Layer 3 (persona-based testing)
adds marginal value at this stage. Conclusion: it does not, because
Layer 2 browser specs are not saturated yet and hostile-input concerns
are better served by deterministic unit tests + axe-core.

## How to apply
1. When defending a proposed addition, list its top 3 use cases.
2. For each use case, name the existing layer that handles it.
3. If 2 of 3 are already handled elsewhere, the addition is probably
   redundant; the question is whether the tier hosting the addition
   still earns its slot.
