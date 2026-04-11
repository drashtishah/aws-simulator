---
id: problem-mcp-chrome-devtools-timeout
kind: problem
title: Chrome DevTools MCP hangs on navigate during browser tests
tags: [kind/problem, scope/testing, stage/verifier, signal/timeout, tool/mcp/chrome-devtools]
created: 2026-03-14
updated: 2026-04-09
source_issues: [#188, #194, #201]
confidence: observed
summary: MCP navigate_page stalls past 30s when a prior page left dialog state open; verifier marks the browser test FAIL on first run
triggers:
  - navigate_page
  - MCP timeout
  - browser test intermittent
  - handle_dialog
severity: degraded
solutions: [solution-mcp-close-dialog-first, solution-mcp-retry-with-fresh-page]
related_problems: [problem-verifier-test-flake]
---

## Symptom
Verifier runs a browser spec. The first `mcp__chrome-devtools__navigate_page`
call stalls past the 30s MCP deadline and the spec fails. Rerunning the same
spec passes about 80 percent of the time.

## Why it happens
Prior spec left an `alert()` dialog unacknowledged. Chrome DevTools Protocol
queues navigation behind dialog resolution; the agent never sent
`handle_dialog`, so navigate blocks indefinitely.

## Explore (try one, then another)
- A. [[solution-mcp-close-dialog-first]] first when a prior spec is known to
  raise dialogs.
- B. [[solution-mcp-retry-with-fresh-page]] when the trigger is unknown.
- C. See [[problem-verifier-test-flake]] for the broader flake family.
