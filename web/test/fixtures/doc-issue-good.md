## Finding
scripts/lib/graph-metrics.ts reports a freshness finding for learning/logs/raw.jsonl: last activity entry is more than 30 days old, dragging the memory_link bucket score down by twelve points.

## Bucket and metric
- Bucket: memory_link
- Metric: freshness
- Current score: 88
- Expected score after fix: 100
- Point gain: 12

## Evidence
- `/home/runner/work/aws-simulator/aws-simulator/learning/logs/raw.jsonl:1` , last entry timestamp is 2026-02-20T10:00:00Z, which is 62 days before the current run
- `/home/runner/work/aws-simulator/aws-simulator/scripts/lib/graph-metrics.ts:1` , activityFreshness threshold is 30 days

## Current behavior
The learning log has not been updated in over 60 days. The scorer emits a freshness finding for the memory_link bucket, reducing its composite by twelve points.

## Expected behavior
The learning log is updated regularly so freshness findings do not appear. Alternatively, the player has run /play recently enough that raw.jsonl has a recent entry.

## Suggested approach
1. Run `/home/runner/work/aws-simulator/aws-simulator/scripts/code-health.ts` after a /play session to confirm the freshness finding disappears.
2. Add a regression test in `/home/runner/work/aws-simulator/aws-simulator/web/test/code-health.test.ts` covering the freshness threshold for learning/logs/raw.jsonl.

## Verification
```bash
npm run health
npx tsx scripts/test.ts run --files web/test/code-health.test.ts
```

## Review excerpts
- **Challenger lens:** The learning log has not been updated in 62 days; the freshness threshold is 30 days. Evidence: `/home/runner/work/aws-simulator/aws-simulator/learning/logs/raw.jsonl:1`
- **Defender lens:** Inactivity was intentional during a hiatus period; conceded after checking that the scorer has no exemption for planned pauses.
- **Steelman pass:** Running a /play session is the cleanest fix; it updates raw.jsonl and clears the finding without any code change.

## Labels
- source:doc
- priority:high
- bucket:memory_link
- metric:freshness
- needs-human

## Linked context
- Health score entry: learning/logs/health-scores.jsonl line 42, run 2026-04-07T10:00:00Z
