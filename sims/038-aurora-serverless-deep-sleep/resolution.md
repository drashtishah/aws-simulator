---
tags:
  - type/resolution
  - service/aurora
  - service/rds
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# Resolution: Thirty Seconds of Silence

## Root Cause

The Aurora Serverless v2 cluster `plover-reporting-db` has `MinCapacity=0`, which enables the auto-pause feature. After `SecondsUntilAutoPause=300` seconds (5 minutes) of inactivity, the cluster stops all compute. `ServerlessDatabaseCapacity` drops to 0. Storage is preserved; the cluster is not crashed.

The cluster was last active Friday at 17:45 UTC. With no weekend traffic, it paused by 17:50 UTC and remained at 0 ACU for 63 hours.

On Monday at 09:00 UTC the first Lambda invocation opened a TCP connection to the cluster endpoint. Aurora began resuming. Resume takes approximately 15 seconds. The `pg` driver's `connect()` call blocked for the entire resume window. Once Aurora accepted the connection, the Lambda still needed to run the report query. Total elapsed time exceeded 29 seconds, which is both the Lambda function timeout and the API Gateway REST API integration timeout maximum. API Gateway returned HTTP 504. The Lambda was terminated with:

```
Task timed out after 29.00 seconds
```

The database itself has no errors. Aurora resumed successfully 15 seconds into the first Lambda invocation. All subsequent requests that Monday morning completed in under 300ms.

## Timeline

| Time (UTC) | Event |
|---|---|
| Friday 17:45 | Last customer request of the week; Lambda closes its connection |
| Friday 17:50 | SecondsUntilAutoPause=300 elapses; Aurora pauses; ServerlessDatabaseCapacity=0 |
| Friday 17:50 to Monday 08:59 | Cluster paused; 63 hours of 0 ACU |
| Monday 09:00:12 | First customer opens reporting dashboard; API Gateway forwards POST /report to Lambda |
| Monday 09:00:12 | Lambda invocation begins; pg driver calls connect() to cluster endpoint |
| Monday 09:00:12 | RDS emits "Resuming DB cluster" event; Aurora begins 15-second resume |
| Monday 09:00:27 | Aurora resumes; TCP handshake completes; Lambda opens connection |
| Monday 09:00:41 | Lambda 29-second timeout fires before query returns; Lambda terminated |
| Monday 09:00:41 | API Gateway returns HTTP 504 to customer browser |
| Monday 09:00:43 | Second customer request arrives; Aurora already running; completes in 280ms |
| Monday 09:02:00 | Three more client emails arrive reporting the initial hang |

## Correct Remediation

1. **Confirm the cluster was paused.** Open CloudWatch, select the `plover-reporting-db` cluster, and graph the `ServerlessDatabaseCapacity` metric over the past 7 days with 5-minute granularity. A flat line at 0 from Friday evening through Monday morning, followed by a spike at exactly the error timestamp, is the fingerprint.

2. **Confirm the resume event.** Open the RDS console, navigate to Events, filter by the cluster identifier `plover-reporting-db`. Look for two events near Monday 09:00: `Aurora DB cluster paused` (Friday evening) and `Resuming DB cluster` (Monday 09:00:12). The timestamps will align with the 504 errors.

3. **Read the cluster configuration.** Call `aws rds describe-db-clusters --db-cluster-identifier plover-reporting-db` and inspect `ServerlessV2ScalingConfiguration`. You will see `MinCapacity: 0` (enables auto-pause) and `SecondsUntilAutoPause: 300`.

4. **Confirm the Lambda and API Gateway timeouts.** The Lambda timeout and the API Gateway integration timeout are both at the 29-second ceiling. There is no slack for a 15-second resume plus connection plus query.

5. **Apply the recommended fix: raise MinCapacity to 0.5 ACU.**
   ```bash
   aws rds modify-db-cluster \
     --db-cluster-identifier plover-reporting-db \
     --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=16
   ```
   No reboot is required. The change takes effect within a few minutes. With `MinCapacity=0.5`, auto-pause is disabled. The cluster stays warm at 0.5 ACU continuously.

6. **Verify.** After applying, confirm `ServerlessDatabaseCapacity` in CloudWatch no longer drops to 0. The Monday morning first-request latency should return to normal (under 300ms).

7. **Add a CloudWatch alarm.** Create an alarm on `ServerlessDatabaseCapacity` with threshold `< 0.1` for 15 consecutive minutes. This fires if someone sets `MinCapacity` back to 0 via Terraform drift or a manual change.

## Alternative Fixes and Tradeoffs

| Fix | Cost | Complexity | Tradeoff |
|---|---|---|---|
| Raise MinCapacity to 0.5 ACU (recommended) | ~$43/month | Trivial: one API call | Eliminates auto-pause entirely; cluster always warm. No retry logic needed. |
| Add RDS Proxy | ~$11/month + traffic | Moderate: new resource, update connection string | Proxy absorbs resume latency from Lambda's view. Adds operational surface. Does not fix root cause; masks it. |
| Warm-up Lambda on EventBridge schedule | Near-zero | Low: one Lambda + one rule | Pre-warms cluster before business hours. Brittle if schedule changes or usage expands beyond Monday mornings. |

## Key Concepts

### Aurora Serverless v2 Auto-Pause

`MinCapacity=0` enables auto-pause. After `SecondsUntilAutoPause` seconds of no connections, Aurora stops all compute. Resume is triggered by the next connection attempt and takes approximately 15 seconds. The cluster is not terminated: storage, snapshots, and configuration are intact.

The 15-second resume window is a documented characteristic, not a bug. It is appropriate for batch or async workloads that can queue or retry. It is incompatible with synchronous HTTP callers whose timeout is shorter than `resume time + connection time + query time`.

### API Gateway Integration Timeout

API Gateway REST APIs have an absolute maximum integration timeout of 29 seconds. This limit cannot be raised. If the Lambda backend does not return a response within 29 seconds, API Gateway returns HTTP 504 regardless of whether the Lambda eventually succeeds.

This means the effective budget for `resume + connect + query` is at most 29 seconds. With a 15-second resume, only 14 seconds remain for connection setup and query execution.

### Why the Database Shows No Errors

Aurora resumed successfully. From the cluster's perspective, the connection was opened after resume completed, a query ran, and then the Lambda's process was terminated by the runtime timeout. The database logs show a normal connection and disconnection. The failure was in the calling layer, not in Aurora.

This is a common pattern that confuses first-time investigators: RDS events and CloudWatch show a healthy cluster while API Gateway logs show 504. The disconnect between "database is fine" and "requests are failing" points toward a timeout race condition in the caller, not a database fault.

## SOP Best Practices

- Never set `MinCapacity=0` on an Aurora Serverless v2 cluster that serves synchronous callers with timeouts under 20 seconds. The 15-second resume is a hard floor.
- When a 504 occurs only on the first request after a long idle period, check `ServerlessDatabaseCapacity` before anything else. A zero-to-positive spike at the error time is the defining signal.
- Pair every Aurora Serverless v2 cluster with a CloudWatch alarm on `ServerlessDatabaseCapacity=0` so accidental auto-pause configuration is detected before it causes customer-facing failures.
- The cost of `MinCapacity=0.5` (~$43/month) is almost always less than the cost of one incident escalation. Default to 0.5 for production workloads; use 0 only for development or batch clusters where cold starts are acceptable.

## Learning Objectives

1. **Aurora Serverless v2 auto-pause mechanics:** Understand that `MinCapacity=0` enables auto-pause and that resume takes ~15 seconds.
2. **Timeout budget arithmetic:** Recognize that `resume time + connect time + query time` must fit within the caller's timeout.
3. **API Gateway ceiling:** Know that REST API integration timeout is capped at 29 seconds with no override.
4. **CloudWatch diagnosis:** Use `ServerlessDatabaseCapacity` to identify a paused cluster and correlate the resume event with an application error.
5. **Fix tradeoffs:** Evaluate raising `MinCapacity`, adding RDS Proxy, and warm-up Lambdas against cost, complexity, and robustness.

## Related

- [[exam-topics#SAA-C03]] - Domain 2: Resiliency and High Availability
- [[exam-topics#SAP-C02]] - Domain 1: Design for Organizational Complexity
- [[learning/catalog.csv]] - Player service catalog and progress
