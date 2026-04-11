---
id: playbook-investigate-test-flake
kind: playbook
title: Investigate a reported browser test flake
tags: [kind/playbook, scope/testing, stage/verifier]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#201]
confidence: observed
summary: Four-step triage when verifier reports an intermittent spec failure, before filing a bug or rerunning the suite
when: verifier reports an intermittent fail on a browser spec
steps: 4
related: [problem-mcp-chrome-devtools-timeout, solution-mcp-retry-with-fresh-page]
---

## Steps
1. Reread the spec output: first failure, not the retry. Look for a dialog,
   timeout, or fetch error.
2. Grep `learning/system-vault/problems/` for the symptom keyword (timeout,
   dialog, fetch). Follow the first matching note.
3. Apply the cheapest `solutions:` entry. Do not escalate to global config
   changes on the first attempt.
4. Record outcome in the issue comment: `vault consulted, applied [[id]]`
   or `vault consulted, no match`.
