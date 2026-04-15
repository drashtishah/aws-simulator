---
id: pattern-negative-prompt-assertion-leaks-excluded-name
kind: pattern
title: Negative assertions on prompt text fail when the prompt names the excluded resource
tags: [kind/pattern, scope/testing, tool/claude-sdk, signal/self-correction]
created: 2026-04-15
updated: 2026-04-15
source_issues: [#280]
confidence: observed
summary: A "Do NOT read X" line in an LLM prompt contains literal X, so assert(!prompt.includes('X')) flips true; describe excluded resources indirectly
principle: if a test asserts a string is absent from prompt content, the prompt must not name that string at all, not even in a prohibition clause
counter_examples: []
---

## Rule
When a test asserts `!prompt.includes('foo.json')`, the prompt under
test must not contain the literal `foo.json`, even inside a "do not
read foo.json" instruction. Substring match does not care about
intent.

## Why
In #280 `buildClassifierPrompt` included a "Do NOT read" paragraph
listing `profile.json` and `catalog.csv` to forbid Tier 1 from
touching them. The negative assertion
`!prompt.includes('profile.json')` flipped red because the prohibition
text named the file. Two test failures, one self-correction commit.

## How to apply
1. When writing an LLM prompt whose absence of a term is an invariant,
   describe the excluded resource by role, not by name. Example:
   instead of `Do NOT read profile.json`, say `read no files outside
   learning/sessions/{simId}/`.
2. When writing the assertion, prefer `!prompt.includes('<exact
   path>')` only if you also own the prompt text. Otherwise assert on
   allowed paths instead.
3. When revising a prompt to pass an absence assertion, grep the
   prompt source for the forbidden literal; rephrase every hit.
