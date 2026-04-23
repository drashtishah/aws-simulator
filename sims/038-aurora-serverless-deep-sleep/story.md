---
tags:
  - type/simulation
  - service/aurora
  - service/rds
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# Thirty Seconds of Silence

## Opening

- company: Plover Analytics
- industry: B2B financial reporting SaaS
- product: hosted reporting dashboards for ~80 small business clients; customers log in Monday mornings to review weekly summaries
- scale: 12-person startup; database is a single Aurora Serverless v2 PostgreSQL cluster; overnight traffic is effectively zero
- time: Monday 09:02 UTC, start of business
- scene: Customer success Slack channel. A client emailed: "Dashboard wouldn't load this morning. Showed an error for about 30 seconds, then worked fine on refresh." Three other clients sent the same note within five minutes.
- alert: no automated alarm fired; the complaints arrived via email and Slack, not PagerDuty
- stakes: four clients saw a 504 on their first login of the week; no data loss, no extended outage, but the pattern repeats every Monday and erodes client trust
- early_signals: API Gateway logs show HTTP 504 for POST /report at 09:00:12; Lambda logs show Task timed out after 29.00 seconds on the same invocation; no RDS errors in the event log; all subsequent requests that morning succeeded within 300ms
- investigation_starting_point: You have access to the API Gateway execution logs, the Lambda function logs, the RDS cluster configuration, and CloudWatch metrics for the Aurora cluster. The database is healthy and serving requests normally right now.

## Resolution

- root_cause: The Aurora Serverless v2 cluster has MinCapacity=0, which enables auto-pause. After 300 seconds of inactivity (SecondsUntilAutoPause=300), the cluster pauses and ServerlessDatabaseCapacity drops to 0. The cluster was last used Friday at 17:45 UTC and paused by 17:50 UTC. It sat at 0 ACU for 63 hours. When the first Lambda invocation arrived Monday at 09:00 UTC, Aurora began resuming. Resume took approximately 15 seconds. The Lambda's pg driver blocked on the TCP connect() call for the full resume window, then had to open the connection and run the query. Total elapsed time exceeded 29 seconds, hitting both the Lambda function timeout and the API Gateway integration timeout. API Gateway returned HTTP 504. The cluster itself resumed successfully; the failure was entirely in the caller's timeout.
- mechanism: Aurora Serverless v2 with MinCapacity=0 is designed for workloads that can tolerate cold starts. The 15-second resume window is a documented characteristic of the auto-pause feature. The Lambda used a direct pg driver connection with no retry or connection-pool warm-up. API Gateway REST APIs cap integration time at 29 seconds; there is no way to raise this limit. The 15-second resume plus connection setup plus query execution summed to more than 29 seconds on the first Monday invocation. All subsequent invocations succeeded because Aurora was already running.
- fix: Raise MinCapacity from 0 to 0.5 ACU in the cluster's ServerlessV2ScalingConfiguration. This disables auto-pause entirely. The cluster stays warm at 0.5 ACU at a cost of approximately $43/month. Apply via aws rds modify-db-cluster with the updated ServerlessV2ScalingConfiguration; no reboot required. Add a CloudWatch alarm on ServerlessDatabaseCapacity=0 to detect any future regression.
- contributing_factors: The migration to Aurora Serverless v2 was done to save cost during overnight idle. The engineer set MinCapacity=0 without accounting for the resume latency. No warm-up strategy was implemented. The Lambda timeout (29 seconds) was set to the API Gateway maximum without leaving headroom for database resume. No CloudWatch alarm existed on ServerlessDatabaseCapacity. Client complaints were the only detection mechanism.
