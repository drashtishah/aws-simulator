---
id: pattern-vault-read-write-asymmetry
kind: pattern
title: Vault read and write boundaries are asymmetric across skills
tags: [kind/pattern, scope/vault, scope/skills]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#159, #167, #168]
confidence: observed
summary: Many skills READ the system vault, but only one stage WRITES it; treat READ and WRITE as independently scoped permissions, never bundle them
principle: vault READ permission and vault WRITE permission are separate scopes; almost every skill earns READ, almost none earn WRITE
counter_examples: []
---

## Rule
Skills that consume vault knowledge get READ access. Only one stage
(currently the reflector in GHA) gets WRITE access. Read-side and
write-side rules are tracked separately and never collapsed into a
single "vault access" permission.

## Why
Mixing READ and WRITE under one rule led to cascading mistakes: a
proposed extension to consume `learning/feedback.md` into vault
articles assumed feedback.md was a "raw file for compilation," when
it is actually a direct `/fix` input. The asymmetry forces each skill
to declare exactly which side it touches, surfacing this kind of
category error at design time.

## How to apply
1. When extending a skill's vault touchpoint, label the change
   READ-side or WRITE-side explicitly.
2. READ-side: free for any skill that needs it; just inline the
   query protocol from `references/pipeline/planner.md` Vault Query.
3. WRITE-side: must run from GHA reflector, or commit a documented
   exception to `guard-write.ts` `NEVER_WRITABLE_DIRS`. Local skills
   that touch the vault via Bash bypass the Edit/Write hook by
   design (setup uses this path); be deliberate about it.
