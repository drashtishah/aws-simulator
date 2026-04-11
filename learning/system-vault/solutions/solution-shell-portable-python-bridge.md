---
id: solution-shell-portable-python-bridge
kind: solution
title: Replace BSD-only shell flags with python3 one-liners
tags: [kind/solution, scope/ci, tool/bash, tool/python]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#137]
confidence: observed
summary: Drop BSD-only date/sed/readlink invocations and call python3 -c instead; works on both macOS and Linux without a CI matrix
applies_to: [problem-shell-bsd-gnu-drift]
preconditions: python3 is available on every target system (it is on every supported macOS and Linux CI runner)
cost: trivial
---

## Steps
1. Identify the BSD-only form. Common cases:
   `date -r EPOCH '+%Y-%m-%d'`
   `sed -i '' 's/old/new/' file`
2. Replace with a python3 one-liner. Example for date:
   ```bash
   python3 -c "import datetime, sys; print(datetime.datetime.fromtimestamp(int(sys.argv[1])).strftime('%Y-%m-%d'))" "$EPOCH"
   ```
   Example for sed -i:
   ```bash
   python3 -c "import sys; p=sys.argv[1]; s=open(p).read().replace('old','new'); open(p,'w').write(s)" file
   ```
3. Run the script in a Linux container locally to verify. Or push and
   watch CI.

## Why this works
python3's stdlib is identical across platforms; coreutils is not.
Trading 1 line of bash for 1 line of python is a constant-time fix.

## When NOT to use
For tight loops or scripts called millions of times, the python
startup cost matters. For dispatch scripts and CI helpers, it does
not. See [[pattern-rules-in-duplicate-places-get-ignored]] for why
we do not maintain BSD and GNU forks of the same script.
