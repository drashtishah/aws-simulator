---
tags:
  - type/resolution
  - service/dynamodb
  - service/lambda
  - service/sqs
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# Resolution: The Lease That Would Not Release

## Root Cause

The `polestar-return-classifier` Lambda function acquires a shard lease in DynamoDB at the start of each invocation. The lease item is at primary key `shard_id`, with attributes `owner_id` (the Lambda request ID) and `expires_at` (a TTL timestamp). The acquire operation is a conditional `UpdateItem` whose condition expression is `attribute_not_exists(owner_id) OR expires_at < :now`.

After a failed conditional write, the worker code waits a fixed 200 milliseconds and retries. There is no exponential backoff, no jitter, and no upper bound on retry attempts other than the Lambda timeout of 5 seconds.

At 02:14 PT a brief DynamoDB throttling spike (transient, lasting 800ms) caused 200 concurrent Lambda workers to fail their lease-acquire conditional writes within the same 50ms window. All 200 retried at exactly 200ms later. One won the conditional write; the other 199 received `ConditionalCheckFailedException` and retried 200ms later. On the next tick, the same 199 plus newly invoked workers all fired conditional writes simultaneously. The pattern locked in: every 200ms, hundreds of synchronized conditional writes against a single hot item, of which exactly one succeeded.

DynamoDB on-demand mode has a per-partition throttle ceiling of approximately 1,000 write capacity units per second per partition. With sustained ConditionalCheckFailedRequests at 8,000/s on the shard-lease item (which lives on a single partition because shard_count=1 means there is only one partition key), the partition exhausted its write capacity, and additional writes returned `ProvisionedThroughputExceededException` on top of the conditional failures. No worker could acquire a fresh lease.

Every Lambda invocation completed in approximately 4.8 seconds (the retry budget before the 5-second timeout) having done zero useful work. SQS counted each invocation as a successful receive and made the message batch invisible for 30 seconds. Thirty seconds later, the messages were re-delivered to fail again.

This is the customer-side analogue of the 2021-12-07 AWS US-EAST-1 EC2 DropletWorkflow Manager congestive collapse: workers retried to acquire DynamoDB leases faster than they could complete, the system spent all of its capacity on retries and contention rather than useful work, and adding more workers made the contention worse.

## Timeline

| Time (UTC) | Event |
|---|---|
| 09:14:00 | Brief DynamoDB throttling spike, 800ms duration |
| 09:14:01 | 200 concurrent workers all fail lease-acquire within a 50ms window |
| 09:14:01 | First synchronized retry tick; pattern locks in |
| 09:14:42 | PagerDuty INC-20260424-0214 fires (error rate > 50%) |
| 09:14:42 to 18:11:00 | Nine hours of zero forward progress; 4.2M message backlog accumulates |
| 18:11:00 | SRE reduces reserved concurrency from 1000 to 5 |
| 18:11:08 | ConditionalCheckFailedRequests drops from 8,000/s to ~40/s |
| 18:11:11 | First successful lease-acquire / batch processing in 9 hours |
| 18:14:30 | SRE deploys updated worker with exponential backoff + jitter and circuit breaker |
| 18:30:00 | Concurrency scaled back to 50, then 200 over 90 minutes |
| 22:30:00 | Backlog drained; pipeline back to normal |

## Correct Remediation

1. **Verify the symptom is congestion, not failure.** Check that SQS `ApproximateNumberOfMessagesVisible` is flat or growing while Lambda `Invocations` is non-zero. This pattern means workers are running but not completing useful work. If `Invocations` were also flat, the problem would be at the Lambda layer (concurrency cap, throttling, account limit), not at the downstream resource.
2. **Confirm the contention point.** On the suspected DynamoDB table, check `ConditionalCheckFailedRequests` (in CloudWatch namespace `AWS/DynamoDB`). A sustained rate above a few hundred per second on a single item indicates a lease-contention pattern. Combine with `WriteThrottleEvents` non-zero to confirm partition-level exhaustion.
3. **Stop the bleeding by REDUCING concurrency, not increasing.** This is the counter-intuitive step. `aws lambda put-function-concurrency --function-name polestar-return-classifier --reserved-concurrent-executions 5`. Within seconds, ConditionalCheckFailedRequests should drop to a single-digit-per-second rate and individual workers should start completing real work.
4. **Add exponential backoff with jitter to the lease-acquire retry loop.** The standard pattern is "full jitter": after attempt N, sleep for a uniform random value in `[0, base * 2^N]`, capped at a max. AWS SDK's `STANDARD` retry mode does this for SDK-level retries; for application-level loops, implement explicitly.
5. **Add a circuit breaker.** Track the rolling 30-second rate of ConditionalCheckFailed errors in the worker. If it exceeds a threshold (e.g., 5 failures in 30 seconds for this worker), exit early without retrying. The Lambda invocation returns and SQS will retry later when (presumably) contention has subsided.
6. **Reduce contention at the data-model layer.** If many workers contend for a single lease item, increase the shard count. The lease table key changes from `shard_id` (one partition) to `shard_id_<random_suffix>` (N partitions). With 64 shards instead of 1, contention drops by ~64x even at the same concurrency.
7. **Scale concurrency back up gradually.** Move from 5 to 50 to 200, watching ConditionalCheckFailedRequests stay low and Lambda Duration drop to actual processing time (not retry timeout). The fact that Duration was previously ~4.8s (just under the timeout) was the strongest single signal that workers were spinning, not working.

## Key Concepts

### Why retries without jitter cause stampedes

When N clients all fail at the same moment and all retry after the same fixed delay, all N retries happen simultaneously, exactly one succeeds (in a contention scenario), and N-1 fail again. The pattern is self-reinforcing: every retry tick produces the same stampede.

Adding randomness ("jitter") breaks this. If each client waits a uniformly random duration in [0, max], the retries spread across the interval; the per-instant contention drops to ~1/(max * client_count). The "full jitter" variant uses [0, base * 2^attempt], which both spreads contention and adds exponential backoff.

The math: with no jitter, instantaneous request rate during a retry storm is N/0 = infinity. With full jitter at attempt N, instantaneous request rate is bounded by N / (base * 2^N), which trends toward zero. The system goes from impossible to easily handled with one line of code change.

### DynamoDB per-partition throttle limits

DynamoDB on-demand mode advertises "scale automatically," but it has soft per-partition ceilings: about 1,000 write capacity units per second and 3,000 read capacity units per second per partition. Sustained traffic above these ceilings on a single partition triggers `ProvisionedThroughputExceededException`, even though the table-level capacity is not exhausted.

A "hot key" is any partition key that receives a disproportionate share of traffic. A lease table with `shard_count=1` has exactly one partition key and is therefore one giant hot key by design. Sharding the lease key (e.g., `shard_id` -> `shard_id_<0..63>`) spreads traffic across 64 partitions and bypasses the per-partition limit by 64x.

### Congestive collapse and the "less is more" principle

A system in congestive collapse has all of its capacity occupied by overhead (retries, contention, lock waits) and zero capacity available for useful work. The defining feature is that adding capacity makes it worse: each new client adds to the contention without contributing to throughput.

The fix is always the same in shape: reduce concurrency until forward progress resumes, then fix the underlying inefficiency (backoff, jitter, circuit breakers, sharding), then scale back up. The 2021 EC2 DWFM event used the same recipe: AWS engineers throttled incoming work, restarted DWFM hosts, drained the queue, then resumed normal operation.

This is also why the worker code's first instinct (a fixed-interval retry) is dangerous specifically at scale. At 2 workers, fixed-interval retries are fine: one wins, one fails, no contention. At 1000 workers, fixed-interval retries are catastrophic. The bug is invisible until the system is large enough to produce the stampede.

## Other Ways This Could Break

### Single hot partition key (no leases involved)
A different application writes all entries with the same partition key (e.g., `user_id = "default"` for unauthenticated traffic). Symptoms are the same throttle ceiling, but `ConditionalCheckFailedRequests` is zero because no one is doing conditional writes; the metric to watch is `WriteThrottleEvents`.
**Prevention:** Choose partition keys with high cardinality. Add a random shard suffix to a hot key. Use the AWS Hot Partition diagnostic tool.

### Lambda account concurrency cap reached
New invocations fail with `ConcurrentInvocationLimitExceeded` before any DynamoDB call. SQS backlog grows because Lambda cannot pick up messages, not because workers are spinning.
**Prevention:** Set per-function reserved concurrency for predictable behavior. Request an account-level concurrency increase ahead of large scale-out events.

### Stale lease blocks all workers
A worker crashed mid-invocation without releasing its lease, and `expires_at` was set far in the future. ConditionalCheckFailedRequests rate is low but constant; one specific shard is permanently stuck.
**Prevention:** Use a TTL value short enough to recover quickly (e.g., 30 seconds for a function with a 5-second timeout). Always release the lease in a `try/finally` block. Monitor for leases held by Lambda request IDs no longer in flight.

## SOP Best Practices

- **Always combine retries with exponential backoff and full jitter.** Synchronized retries are how a small failure becomes a large outage. The AWS SDK's `STANDARD` retry mode includes this for SDK-level retries; application-level retry loops must implement it explicitly.
- **Add a circuit breaker to any retry loop that touches a shared resource.** When failure rate crosses a threshold, exit early and let the upstream system handle the message later. This bounds the blast radius of contention.
- **Reduce contention at the data-model layer before scaling concurrency.** If workers serialize on a single hot item, no amount of capacity addition will help. Sharding the contended key is usually a one-line change with massive impact.
- **Treat "adding more workers" as a hypothesis, not a default.** For congestion-bound problems, reducing concurrency is the correct first move. The 2021 EC2 DropletWorkflow Manager congestive collapse made this lesson explicit at AWS scale.

## Learning Objectives

1. **Retry storms and jitter**: Understand why fixed-interval retries amplify contention into a stampede, and why randomized backoff breaks the pattern.
2. **DynamoDB per-partition limits**: Know the on-demand soft ceilings (1,000 WCU/s, 3,000 RCU/s per partition) and how to spot hot-partition exhaustion.
3. **Counter-intuitive scaling**: Recognize that adding capacity to a congestion-bound system makes it worse; reduce concurrency first.
4. **Lease patterns and contention**: Design lease tables with enough sharding to prevent serialization on a single hot item.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design Solutions for New Solutions
- [[exam-topics#DOP-C02 -- DevOps Engineer Professional]] -- Domain 3: Resilience
- [Summary of the AWS Service Event in US-EAST-1 (Dec 2021)](https://aws.amazon.com/message/12721/) -- the post-mortem this scenario mirrors
