---
id: pattern-rules-in-duplicate-places-get-ignored
kind: pattern
title: Rules duplicated in two places get ignored even by the agent that just read both
tags: [kind/pattern, scope/skills, scope/docs, signal/drift]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#114, #117]
confidence: observed
summary: A rule split across multiple files gets followed in the canonical place and ignored everywhere else; pick one home and reference it
principle: keep every behavioral rule in exactly one canonical home; reference, never duplicate
counter_examples: []
---

## Rule
When a rule needs to apply across files, write it once in the canonical
home (e.g., `references/architecture/core-workflow.md`) and reference
it from every other location instead of restating it.

## Why
Empirical evidence: agents read core-workflow.md saying `test --changed
per commit, npm test only at PR boundaries`, then immediately wrote
plans saying `Run: npm test` after every step. The rule was followed
where it was first read and ignored everywhere it was duplicated.

## How to apply
1. Before adding a rule, grep for the same topic in CLAUDE.md, every
   `.claude/skills/*/SKILL.md` `## Rules` section, and the memory dir.
2. If the rule already exists somewhere, link to it (file:line). Do
   not paraphrase.
3. If the rule must be enforced from multiple call sites, fold them
   into the canonical home and add a one-line pointer in each caller.
