---
tags:
  - type/simulation
  - service/dynamodb
  - service/lambda
  - service/sqs
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# The Lease That Would Not Release

## Opening

- company: Polestar Returns
- industry: e-commerce reverse-logistics platform; processes returns for 1,200 retailers
- product: nightly batch pipeline that classifies return events, computes refund amounts, and updates retailer ledgers
- scale: ~4 million return events per night; SLA is "all events processed by 06:00 PT"
- time: Friday, 11:14 AM PT, nine hours after the nightly run was supposed to start
- scene: an SRE has bounced the workers four times, scaled them up twice, and watched the SQS backlog stay flat at 4.2 million messages
- alert: PagerDuty INC-20260424-0214 fired at 02:14 with text `polestar-return-classifier error rate > 50%`
- stakes: the SLA breach is now nine hours old; refund settlements for 1,200 retailers are blocked; finance team is asking whether to manually push refunds outside the system
- early_signals:
  - SQS ApproximateNumberOfMessagesVisible: 4,234,118, has not moved in nine hours
  - Lambda Invocations: 800/s, sustained
  - Lambda Duration: 4,800ms p50 (suspiciously close to the 5,000ms timeout)
  - DynamoDB ConditionalCheckFailedRequests on polestar-shard-leases: 8,000/s
  - the last successful processed-record count was at 02:13:58
  - someone deployed the front-end at 21:00 the previous evening (probably unrelated)
- investigation_starting_point: SQS console open, Lambda console open, DynamoDB console open, CloudTrail accessible

## Resolution

- root_cause: polestar-return-classifier acquires shard leases via DynamoDB conditional write; on a failed conditional, the worker retries on a fixed 200ms interval with no jitter and no exponential backoff
- mechanism: at 02:14 a brief DynamoDB throttling spike caused 200 concurrent workers to fail their lease-acquire conditional writes simultaneously; all 200 retried 200ms later; one won, 199 failed; on the next 200ms tick, all retried again; the synchronized retry pattern drove the lease table to 8,000 ConditionalCheckFailedRequests per second, exhausted per-partition write capacity, and prevented any worker from completing useful work; each Lambda invocation timed out at 5s having processed zero records, but SQS counted the poll as a successful receive and made the messages invisible for 30s, after which they were re-delivered to fail again
- fix: SRE reduced reserved concurrency from 1000 to 5, which dropped ConditionalCheckFailed below 50/s and allowed forward progress to resume within seconds; the team then added exponential backoff with jitter to the lease-acquire retry loop, increased shard count from 1 to 64, and added a circuit breaker that exits early when contention is high; concurrency was scaled back up to 200 over the next 90 minutes and the backlog drained by 16:30
- contributing_factors:
  - the lease-acquire retry loop was written without backoff because the original author assumed contention would never exceed two workers per shard
  - shard count was 1 because the pipeline launched with low volume and was never re-evaluated
  - no monitoring on Lambda Duration approaching the timeout (would have caught "completing without doing work")
  - the team's first instinct was to scale UP concurrency, which made the synchronized retries worse
