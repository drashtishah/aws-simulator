---
tags:
  - type/resolution
  - service/route53
  - service/lambda
  - service/ecs
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# Resolution: Two Automations, One Record

## Root Cause

The `api.halcyonpay.com` A-record RRset in the `halcyonpay.com` Route 53 public hosted zone is modified by two independent automations:

1. **halcyon-health-check-lambda**: runs every 30 seconds via EventBridge schedule. It reads the current RRset, queries the NLB target health for every IP currently listed, removes any IP whose target is unhealthy, adds any newly-healthy IPs, and writes the result via `ChangeResourceRecordSets`.
2. **halcyon-deploy-hook**: runs at the end of each CodeDeploy blue/green deployment (`AfterAllowTraffic` lifecycle event). It reads the current RRset, removes the IPs of the old task set, adds the IPs of the new task set, and writes the result via `ChangeResourceRecordSets`.

Both automations perform a read-modify-write cycle. Neither uses a `SetIdentifier` (which would put their changes in separate weighted-routing scopes). Route 53's `ChangeResourceRecordSets` API has no compare-and-swap or optimistic-concurrency mechanism. The second writer always wins.

During the 16:31 deployment, the two automations interleaved:

- T+0 (16:31:14.022): deploy hook reads RRset V1 = `[old-ip-1, old-ip-2, old-ip-3, new-ip-1, new-ip-2, new-ip-3]`
- T+0 (16:31:14.118): health-check Lambda reads the same V1 (its 30-second tick coincided with the deploy hook)
- T+1 (16:31:15.207): deploy hook writes V2-deploy = `[new-ip-1, new-ip-2, new-ip-3]` (removed old, kept new)
- T+1 (16:31:15.881): health-check Lambda writes V2-health = `[old-ip-1, old-ip-2, new-ip-1, new-ip-2]` (removed only `old-ip-3` which it had just probed and found unhealthy; kept the rest of V1; never saw deploy hook's V2)
- V2-health overwrote V2-deploy: now the RRset contained `[old-ip-1, old-ip-2, new-ip-1, new-ip-2]`
- T+30 (16:31:45): next health-check Lambda invocation reads V2-health, queries health, finds `old-ip-1` and `old-ip-2` unhealthy (they are terminated), removes them, writes V3 = `[new-ip-1, new-ip-2]`
- T+33 (16:31:48): a second deploy step runs the deploy hook again with stale knowledge of the previous task set; it reads V3, computes V4 by removing `new-ip-1` and `new-ip-2` (which it incorrectly believed were the "old" set because the deploy state had advanced), and writes an empty RRset

For approximately 90 seconds, `api.halcyonpay.com` resolved to nothing. External resolvers received `NOERROR` with an empty answer section, which application clients treat as a connection failure.

This is the customer-side analogue of the 2025-10-19 AWS US-EAST-1 DynamoDB DNS race, where a latent race condition in the DynamoDB DNS Planner / Enactor system applied a stale plan over a fresh one and cleanup automation deleted the valid record, leaving the regional endpoint with no DNS. The same shape: independent writers, no version check, last write wins.

## Timeline

| Time (UTC) | Event |
|---|---|
| 23:31:14.022 | deploy hook reads RRset V1 |
| 23:31:14.118 | health-check Lambda reads same V1 |
| 23:31:15.207 | deploy hook writes V2-deploy (correct: only new IPs) |
| 23:31:15.881 | health-check Lambda writes V2-health (overwrites V2-deploy) |
| 23:31:31.000 | PagerDuty INC-20260424-1631 fires (synthetic NXDOMAIN) |
| 23:31:45.401 | health-check Lambda removes terminated old IPs, RRset = [new-ip-1, new-ip-2] |
| 23:31:48.811 | deploy hook (next deployment step) reads stale state, writes EMPTY RRset |
| 23:33:18.092 | health-check Lambda runs, computes RRset from NLB target list, writes [new-ip-1, new-ip-2, new-ip-3] |
| 23:33:48.000 | TTL expires on negative cache; resolution recovers for some clients |
| 23:35:11.205 | SRE disables EventBridge schedule on health-check Lambda |
| 23:42:00.000 | Race broken; full DNS resolution stable |

## Correct Remediation

1. **Identify the writers.** Pull the Route 53 change history for the affected RRset. The CLI form is `aws route53 list-resource-record-sets-changes --hosted-zone-id <id>`. Group changes by `IAMUser` (or `assumedRoleArn`). If two or more independent identities are modifying the same Name+Type, you have the precondition for a race. CloudTrail filtered by `eventName=ChangeResourceRecordSets` is a good cross-check.
2. **Reconstruct the timeline.** For each `ChangeResourceRecordSets` call in the affected window, note the exact `ChangeBatch` body (the `Action` and `ResourceRecords`). Look for two writes within a few seconds where the second's RRset omits records the first just added. The change-batch IDs and the `GetChange` API give you the propagation status.
3. **Stop the bleeding.** Disable one of the two automations to break the race. Most surgical: disable the EventBridge schedule on the health-check Lambda (`aws events disable-rule --name halcyon-health-check-schedule`). The deploy hook can be left alone if no deploys are imminent. The system will run on stale data from whichever automation last wrote, but it will be stable.
4. **Pick a topology fix.** Three viable options, in order of decreasing surgical surface:
   - **Option A: weighted routing with SetIdentifier.** Each automation writes under its own SetIdentifier. The records coexist as a weighted set. Route 53 returns records from one or the other based on weight. Concurrent writes never overwrite because they target different RRset entries.
   - **Option B: single writer.** Replace the deploy hook with Cloud Map service discovery. ECS automatically registers and deregisters task IPs in Cloud Map. Cloud Map is the single writer; it has no race with itself. The health-check Lambda is removed; Route 53's built-in health checks linked to weighted-routing entries replace it.
   - **Option C: serialized writer.** Introduce a Lambda that holds an SQS-FIFO mutex for writes to the RRset. Both the health-check signal and the deploy hook send messages to the FIFO queue; the writer Lambda processes them one at a time. Most code change, most flexibility.
5. **Implement and verify.** After the topology fix, trigger both signals (a deploy and a simulated health-check failure) within seconds. Watch the change history. Either the writes are now separate-scoped (Option A) or the second writer is the same principal as the first (Options B/C). Synthetic checks should show no NXDOMAIN.
6. **Add monitoring for empty RRsets.** CloudWatch synthetic that resolves `api.halcyonpay.com` every 30 seconds from multiple regions. Page on NXDOMAIN, NOERROR-with-empty-answer, and on resolved IPs that are not in the current target group.

## Key Concepts

### Route 53 ChangeResourceRecordSets has no compare-and-swap

`ChangeResourceRecordSets` accepts a `ChangeBatch` of `Create`, `Delete`, or `Upsert` actions. Each `Upsert` replaces the RRset entirely with the records in the request. There is no `If-Match` header, no version number, no etag. The call always wins over whatever was there.

This makes Route 53 RRsets a shared mutable resource that requires external coordination if multiple writers exist. The standard coordination patterns are:

- **Single writer**: only one automation writes; everything else only reads.
- **Scoped writers**: each writer owns a distinct subset of the RRset namespace, separated by SetIdentifier (in weighted, latency, or geolocation routing) or by a different RRset entirely (e.g., one record per writer, with a CNAME alias as the public name).
- **Serialized writes**: a single Lambda or service holds the write lock and processes events sequentially.

### Weighted routing with SetIdentifier

Weighted routing is one of Route 53's routing policies. It allows multiple records with the same Name and Type to coexist in the same hosted zone, as long as each has a distinct `SetIdentifier`. Resolvers receive one record's data per query, chosen probabilistically based on the `Weight` attribute.

For the dual-automation case, this means each automation can have its own SetIdentifier ("health-check" and "deploy-hook") and write its records independently. The records do not overwrite each other because they are separate RRset entries from Route 53's perspective. From the resolver's perspective, they are pooled together.

This is the smallest-surface-area fix when the two writers cannot easily be consolidated. It does have a quirk: if one writer goes silent, its records persist (until that writer eventually writes again with an empty list) and resolvers may continue receiving them.

### Why Cloud Map is the canonical solution for service discovery

AWS Cloud Map is purpose-built to keep DNS records in sync with a dynamically scaling service. ECS integrates with it directly: when a task starts, ECS registers its IP with Cloud Map; when a task stops, ECS deregisters. Cloud Map updates the underlying Route 53 hosted zone (private or public) automatically.

Cloud Map is the single writer to its records. It does not race with itself. It also handles health-check propagation automatically: if a task's health check fails, Cloud Map removes its registration, which Route 53 then reflects in subsequent queries.

The cost is per-registered-instance and per-DNS-query, which can be material at high scale. Some teams (like Halcyon Pay in this scenario) build their own DNS-update Lambdas for cost reasons, then later discover that they also need to handle deploy-time updates and end up with the dual-writer race.

## Other Ways This Could Break

### Stale TTL extends the impact window after the fix
Even after the underlying race is fixed and the RRset is correct, downstream resolvers continue serving the cached empty answer until the TTL expires. The fix is in place but customers still see failures until caches refresh.
**Prevention:** Set short TTLs (30-60s) on programmatically managed records. Document that recovery time = fix time + TTL. For a critical record, consider an even shorter TTL at the cost of higher query volume.

### Cloud Map and public DNS diverge
The team uses Cloud Map for internal service discovery (private zone) but a separate Lambda for the public name. The two get out of sync: internal callers succeed while external callers fail, or vice versa.
**Prevention:** Pick one source of truth for service location and have all consumers resolve through it. If a public name is needed, use a Route 53 alias that points to the Cloud Map name; both stay in sync automatically.

### Health-check flapping causes records to oscillate even with a single writer
Only one principal writes, but the underlying health check is unstable (e.g., threshold too low). The RRset adds and removes the same IP repeatedly. Resolvers see different answers across queries.
**Prevention:** Tune health-check thresholds: require multiple consecutive failures (e.g., FailureThreshold=3) before marking unhealthy, and multiple consecutive successes (HealthThreshold=3) before marking healthy. Add hysteresis.

## SOP Best Practices

- **Treat Route 53 RRsets as a shared mutable resource.** `ChangeResourceRecordSets` has no compare-and-swap; the last writer wins. If multiple automations need to modify the same RRset, separate them via SetIdentifier or serialize through a single writer.
- **Cloud Map (AWS service discovery) is the canonical solution for keeping DNS in sync with a dynamically scaling service.** It is the single writer by design. The cost may be material at high scale, but the operational simplicity is usually worth it.
- **Set short TTLs on programmatically managed records (30-60s).** A high TTL turns a brief misconfiguration into a long outage because resolvers cache the bad answer.
- **Add an external synthetic check for critical public hostnames.** Resolve from outside AWS (CloudWatch Synthetics multi-region or a third-party prober). Page on NXDOMAIN and on resolved-IPs-not-in-current-target-group. The 2025 DynamoDB DNS race was first noticed as elevated query failures; the same pattern catches customer-side races.

## Learning Objectives

1. **Race conditions in shared-resource modification**: Recognize the read-modify-write pattern as a textbook race when there is no version check.
2. **Route 53 API semantics**: Know that `ChangeResourceRecordSets` is last-writer-wins and design coordination around that fact.
3. **Topology choices for multi-writer systems**: Pick from single-writer (Cloud Map), scoped-writer (SetIdentifier), or serialized-writer (FIFO mutex) based on cost and operational tradeoffs.
4. **DNS observability**: Use Route 53 change-history plus CloudTrail plus external synthetics to reconstruct who wrote what when, and to catch empty-RRset states before customers do.

## Related

- [[exam-topics#ANS-C01 -- Advanced Networking Specialty]] -- Domain 3: Network Management and Operation
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design Solutions for New Solutions
- [Race Condition in DynamoDB DNS System (InfoQ, Nov 2025)](https://www.infoq.com/news/2025/11/aws-dynamodb-outage-postmortem/) -- the post-mortem this scenario mirrors
