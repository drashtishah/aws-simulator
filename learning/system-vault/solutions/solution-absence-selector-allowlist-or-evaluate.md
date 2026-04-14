---
id: solution-absence-selector-allowlist-or-evaluate
kind: solution
title: Add removed selector to absenceSelectors set or switch the spec step to evaluate_script
tags: [kind/solution, scope/testing, stage/implementer, tool/cross-file-consistency]
created: 2026-04-14
updated: 2026-04-14
source_issues: [#266]
confidence: observed
summary: cross-file-consistency.test.ts flags YAML selectors missing from current DOM; allowlist intentional absences or use evaluate_script to bypass the drift check
applies_to: []
preconditions: YAML browser spec asserts visible:false or element count on a selector whose DOM node was deleted in the same change
cost: trivial
---

## Steps
1. Identify the selector the spec asserts is absent (for example
   `#select-reveal-speed`).
2. Pick one of:
   - Add the literal selector string to the `absenceSelectors` set in
     `web/test/cross-file-consistency.test.ts` (around line 398). The
     drift check then skips it. Use when the selector is a stable,
     named DOM id you want on record as intentionally removed.
   - Rewrite the spec step to `evaluate_script:
     document.getElementById('foo') === null`. The drift check only
     parses structural selectors, so `evaluate_script` bodies bypass
     it. Use when the check is one-off and the selector is not worth
     enshrining.
3. Re-run `npm test`. The cross-file drift failure clears.

## Why this works
`cross-file-consistency.test.ts` extracts every selector literal from
every YAML browser spec and fails when the current DOM defines none
of them. That is the right default for typo detection, but removing a
selector intentionally is a legitimate case. The allowlist encodes
"removed on purpose"; `evaluate_script` hides the selector behind a
JS expression the extractor does not parse.

## When NOT to use
Do not add a selector to `absenceSelectors` just to silence an error
caused by a typo or an accidental DOM rename. Confirm the element is
genuinely and intentionally gone first.
