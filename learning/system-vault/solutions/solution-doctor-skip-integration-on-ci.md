---
id: solution-doctor-skip-integration-on-ci
kind: solution
title: Set DOCTOR_SKIP_INTEGRATION=1 in CI so flaky web-server boot checks do not gate the run
tags: [kind/solution, scope/ci, tool/doctor]
created: 2026-04-11
updated: 2026-04-11
source_issues: [#137]
confidence: observed
summary: scripts/doctor.ts honors DOCTOR_SKIP_INTEGRATION=1; ci.yml sets it before npm run doctor so the 12s web-server boot check does not flake on cold runners
applies_to: []
preconditions: the integration check in question is genuinely flaky in CI but stable locally
cost: trivial
---

## Steps
1. In `.github/workflows/ci.yml`, set the env var before invoking
   doctor:
   ```yaml
   - name: doctor
     run: DOCTOR_SKIP_INTEGRATION=1 npm run doctor
   ```
2. Local invocations keep running integration checks by default
   (the env var is unset). This is the inverse of "skip everywhere":
   you only skip in the environment that flakes.
3. The in-repo `web/test/doctor.test.ts` suite asserts both branches
   so the env-var contract does not regress.

## Why this works
Cold CI runners take 10 to 12s to bind port 3200. The doctor
web_server_boot check times out at 12s. Local runs are faster (warm
node_modules, warm filesystem) and pass reliably. Skipping only on
the slow side preserves coverage where it works.

## When NOT to use
If a check is flaky everywhere, skipping it in CI hides the bug.
Fix the underlying race instead. The skip env var is for CI-specific
flakes only.
