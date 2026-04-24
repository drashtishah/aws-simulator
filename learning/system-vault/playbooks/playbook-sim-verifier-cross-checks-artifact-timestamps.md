---
id: playbook-sim-verifier-cross-checks-artifact-timestamps
kind: playbook
title: Sim verifier cross-checks timestamps across every artifact before PASS
tags: [kind/playbook, scope/sim-content, stage/verifier, signal/insight]
created: 2026-04-23
updated: 2026-04-23
source_issues: [#340]
confidence: observed
summary: Sim artifacts look realistic in isolation but contradict each other on timestamps; verifier must cross-reference every timeline artifact before PASS
when: sim-content PR touches two or more time-stamped artifacts (cloudwatch CSV, rds-events.json, api-gateway-logs.txt, lambda-logs.txt)
steps: [list every time-stamped artifact, pick canonical timeline source per window, walk each artifact against canonical timeline, verify day-of-week of absolute dates, verify downstream timeout arithmetic adds up to user-visible symptom]
related: []
---

## Why
In #340 `api-gateway-logs.txt` showed HTTP 200 responses at 08:45,
08:52, 08:58 for POST /report while `cloudwatch-metrics.csv` showed
ServerlessDatabaseCapacity=0 through 09:00:00 and `rds-events.json`
showed no resume until 09:00:12. Each file was internally consistent.
The contradiction was only visible when read together. A player
running the sim would reach incompatible conclusions.

## Steps
1. List every artifact that contains a timestamp, event, or status
   column.
2. Pick the single source of truth for each time window. For incidents
   with a paused-then-resumed resource, the resource event log
   (`rds-events.json`, etc.) is canonical.
3. Walk each artifact line against the canonical timeline. Flag any
   row that implies state contradicting the canonical log.
4. Verify day-of-week of every absolute date. A Friday-evening pause
   on a Saturday is a latent bug.
5. Verify the downstream timeout arithmetic: resume duration plus
   driver retry plus integration timeout must add up to the
   user-visible symptom the story claims.

## Gate
Do not PASS the sim until every artifact agrees with the canonical
timeline. Fix contradictions in place, commit as a small follow-up.
