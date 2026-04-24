---
id: problem-unenforced-schema-drifts-from-plan
kind: problem
title: Unenforced JSON schema rejects fields plans require, forcing impl to pick which rule to break
tags: [kind/problem, scope/pipeline, stage/implementer, signal/insight]
created: 2026-04-23
updated: 2026-04-23
source_issues: [#340]
confidence: observed
summary: Schema file with additionalProperties false is not loaded by any test; plan demands out-of-schema field; impl ships it silently and divergence compounds
triggers: [manifest-schema.json additionalProperties false, schema not referenced by any test, plan requires field outside schema, fix_criteria options sub-array, schema present but unloaded]
severity: degraded
solutions: []
related_problems: []
---

## Symptom
In #340 the plan required documenting all three Aurora fix options
inside `fix_criteria`. `.claude/skills/create-sim/assets/manifest-schema.json`
declares `additionalProperties: false` on `fix_criteria` items, which
rejects the `options` sub-array. No test loads the schema, so the
implementer shipped the out-of-schema field and the verifier flagged
it as informational only. Schema and plan requirements diverge with
nothing to force reconciliation.

## Why it happens
1. Schema exists as a skill asset but no test or CI step validates
   manifests against it.
2. Plan templates and critic review do not grep the schema before
   approving Files-to-change requirements.
3. Implementer chooses plan over schema because only the plan is
   enforced downstream.
4. Each new sim widens the drift because the de-facto shape
   (manifests in the wild) supersedes the written shape (schema).

## Fix
Either load the schema in `web/test/manifest-shape.test.ts` with
ajv and fail on extra fields, or update the schema to reflect the
current required shape (add `options` to `fix_criteria` items).
Pick one: the schema must match reality or gate reality. Planner and
critic grep the schema for every field they add to a manifest plan.
