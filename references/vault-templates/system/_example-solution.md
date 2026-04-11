---
id: solution-mcp-retry-with-fresh-page
kind: solution
title: Close and reopen page between MCP retries
tags: [kind/solution, scope/testing, tool/mcp/chrome-devtools]
created: 2026-03-14
updated: 2026-04-09
source_issues: [#188, #201]
confidence: observed
summary: On MCP stall, call close_page then new_page before retrying; resolves about 80 percent of navigate_page timeouts with no config change
applies_to: [problem-mcp-chrome-devtools-timeout]
preconditions: page state is not load-bearing for the current spec
cost: trivial
---

## Steps
1. Catch the timeout from `mcp__chrome-devtools__navigate_page`.
2. Call `mcp__chrome-devtools__close_page` on the stalled page id.
3. Call `mcp__chrome-devtools__new_page` with the same target URL.
4. Retry the original action once. If it fails again, escalate to
   [[solution-mcp-close-dialog-first]] or mark the spec a flake.

## Why this works
A fresh page id bypasses any CDP queue left by unacknowledged dialogs or
orphaned fetch handlers.

## When NOT to use
If the spec depends on accumulated page state (cookies, in-memory auth,
open SSE stream), this destroys it. Use [[solution-mcp-close-dialog-first]]
instead. See [[pattern-surgical-changes]] for why we prefer retry over
raising the global MCP timeout.
