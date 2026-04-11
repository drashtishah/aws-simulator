---
id: problem-shell-bsd-gnu-drift
kind: problem
title: Shell scripts pass on macOS, fail in Linux CI due to BSD vs GNU coreutils drift
tags: [kind/problem, scope/ci, signal/regression, tool/bash]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#137]
confidence: observed
summary: BSD-only flags (date -r, sed -i '', readlink -f) pass on macOS, fail every Linux CI run; cost N consecutive failed CI runs before noticing
triggers: [date -r, sed -i empty, readlink -f, stat -f, base64 -D, check-budget, CI failed locally passed]
severity: degraded
solutions: [solution-shell-portable-python-bridge]
related_problems: []
---

## Symptom
A `.sh` script written and tested on macOS passes locally then fails
4+ consecutive Linux CI runs with cryptic flag-not-recognized errors.
Concrete instance: `scripts/check-budget.sh` used `date -r EPOCH`
(BSD/macOS only); GNU date wants `date -d @EPOCH`. Failed runs
eaa44db, 2bcd4b2, 52166bb, 57a9e78 before the pattern was spotted.

## Why it happens
macOS ships BSD coreutils; Linux CI ships GNU coreutils. The flag
surface diverges silently. Bash test runners do not flag this. Local
"green" gives false confidence.

## Common BSD-only forms to grep for
- `date -r` instead of GNU `date -d @`
- `sed -i ''` (BSD requires the empty string after -i; GNU does not)
- `readlink` without -f on macOS
- `stat -f` vs GNU `stat -c`
- `base64 -D` vs GNU `base64 -d`

## Explore
- A. Replace the BSD-only call with the portable workaround from
  [[solution-shell-portable-python-bridge]] (cheapest).
- B. Add a CI matrix that runs the test suite on both ubuntu and
  macos-latest so portability bugs surface immediately. Higher
  cost, catches the next bug too.
