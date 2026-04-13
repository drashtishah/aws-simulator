---
id: pattern-pin-third-party-before-planning
kind: pattern
title: Resolve exact pinned version of third-party deps before writing the plan
tags: [kind/pattern, scope/pipeline, stage/planner, signal/insight]
created: 2026-04-12
updated: 2026-04-12
source_issues: [#217]
confidence: observed
summary: Plans installing third-party tools must specify exact commit SHA or versioned URL; placeholders delegate decisions to implementers and fail critique
principle: resolve the exact pinned version of third-party dependencies before writing the plan, not during implementation
counter_examples: []
---

## Rule
When a plan installs a third-party tool (curl-pipe-sh, npm package,
binary download), the plan must contain the exact commit SHA, tag, or
versioned URL. A placeholder like `<LATEST_TAG>` is not a contract; it
delegates a supply-chain decision to the implementer and will be
rejected by the critic.

## Why
In #217 the first plan revision used an unpinned master-branch URL for
RTK. The critic correctly flagged it as a supply-chain risk and
rejected the plan. A second revision was needed solely to resolve the
version (SHA `8a7106c8f2996ebc75b38a71c5f342f17811ce39`, RTK v0.35.0).
WebFetch to the releases page was required to unblock. The version
lookup cost one full planner/critic round.

## How to apply
1. Before writing the plan, look up the latest stable release and its
   immutable identifier (commit SHA, not tag; tags are mutable).
2. Write the pinned identifier directly into old/new strings.
3. Document the version in Risks / open questions so the critic can
   verify the pin.
