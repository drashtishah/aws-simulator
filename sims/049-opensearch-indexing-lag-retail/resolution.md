---
tags:
  - type/resolution
  - service/dynamodb
  - service/opensearch
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# Resolution: Yesterday's Inventory, Today's Cart

## Root Cause

The lumenfold-catalog-indexer Lambda function had reservedConcurrentExecutions = 5. The setting was added last year when the catalog had 40,000 SKUs. Since then the catalog grew to 380,000 SKUs and the morning batches grew with it. With reserved concurrency capping parallelism at 5, the function could not scale to absorb the 380,000-record morning catalog refresh that ran with the Spring Premium launch this morning. The DynamoDB Stream backed up; IteratorAge climbed to 14.5 million milliseconds (4 hours 12 minutes); OpenSearch reflected inventory state from before the launch; storefront search returned items that were no longer in stock.

The mechanism that hid the divergence was that two systems disagreed: search reads OpenSearch, checkout reads DynamoDB. OpenSearch was hours stale, but checkout (against DynamoDB) saw inventory was zero only when many shoppers had already bought a given SKU through stale-search results. Until that moment, sold-out items still had positive DynamoDB inventory because the inventory was decremented at fulfillment, not at order placement. Orders were accepted, charged, then later canceled with a "sorry" email when the warehouse picked them.

## Timeline

| Time (ET) | Event |
|---|---|
| 1 year ago | Reserved concurrency = 5 set on lumenfold-catalog-indexer during a cost-tuning exercise |
| Yesterday 16:00 | Spring Premium line announced internally; 380,000 SKUs queued for catalog ingest |
| Today 06:00 | Morning catalog ingest begins writing inventory updates to DynamoDB |
| Today 06:18 | Catalog ingest completes; 380,000 stream records pending |
| Today 06:18 - 11:30 | Indexer drains stream at ~16 records/second; IteratorAge climbs from 0 to 14.5M ms |
| Today 09:00 | Storefront opens for the day; search returns yesterday-evening inventory state |
| Today 10:14 | First fulfillment-impossible ticket logged |
| Today 11:42 | 412 tickets accumulated; on-call paged |
| Today 11:48 | Engineer pulls IteratorAge metric for catalog-indexer Lambda; sees 14.5M ms |
| Today 11:51 | Engineer reads function configuration; finds reservedConcurrentExecutions = 5 |
| Today 11:54 | Reserved concurrency removed; function scales to 60 concurrent executions |
| Today 12:06 | IteratorAge falls below 5,000 ms; OpenSearch and DynamoDB reconverge |
| Today 12:10 | New tickets stop arriving; refund cleanup begins |

## Correct Remediation

1. **Confirm the divergence**: Pick a SKU that customers report as missing at fulfillment. Look it up in DynamoDB (`aws dynamodb get-item`) and in OpenSearch (`GET /lumenfold-products/_doc/<sku>`). The records will not agree. DynamoDB is current; OpenSearch is hours old.
2. **Find the indexing pipeline**: Search runs against OpenSearch, and OpenSearch is fed by something. List the event source mappings on the lumenfold-inventory DynamoDB stream (`aws lambda list-event-source-mappings`). One will point at lumenfold-catalog-indexer. That is the indexer.
3. **Check IteratorAge**: Lambda emits a CloudWatch metric called IteratorAge for any function fed by a stream. Pull it for lumenfold-catalog-indexer in the last hour. The value is the age in milliseconds of the oldest record in the most recent batch processed. Normal values are sub-second. Hours of lag means the function cannot keep up.
4. **Find the bottleneck**: Read the function configuration. Look at reservedConcurrentExecutions. If it is set, that is the maximum number of concurrent executions, regardless of how many shards are available. Set too low, the function is the throttle.
5. **Fix immediately**: Remove the reserved concurrency cap (set it to None / unset). The function will scale up to absorb the burst. IteratorAge will fall as the backlog drains.
6. **Drain before unflapping**: While IteratorAge is still high, search still returns stale results. Either show shoppers a banner that inventory data is being refreshed, or temporarily route high-traffic SKU lookups directly to DynamoDB.
7. **Add monitoring**: CloudWatch alarm on IteratorAge for the catalog-indexer Lambda with a threshold of 60,000 ms (one minute). For near-real-time search needs, consider migrating to OpenSearch Ingestion zero-ETL, which is sized in OpenSearch Compute Units rather than tuned via concurrency.

## Key Concepts

### DynamoDB Streams + Lambda is a pipeline with a hard ceiling

A DynamoDB Stream is a change log of every write that lands on a table. Lambda subscribes via an event source mapping. The mapping polls the stream on Lambda's behalf and invokes the function with batches of records. There is one Lambda invocation per shard at a time, and shards correspond to active table partitions. Shards can be processed in parallel, but a single shard's records are processed in order.

This means throughput depends on three things: the number of shards (you do not control this directly; DynamoDB partitions the table), the function's processing time per batch, and the function's concurrency. If concurrency is artificially capped (by reserved concurrency or by account quota), the pipeline cannot scale to absorb a burst.

### IteratorAge is the canonical lag signal

When Lambda processes a batch of stream records, it emits a CloudWatch metric called IteratorAge. The value is the age in milliseconds of the oldest record in the most recent batch. If the function is keeping up in real time, IteratorAge is small (under a second). If records are accumulating faster than the function can process, IteratorAge climbs unbounded, up to the stream retention limit of 24 hours.

A rising IteratorAge is the only way to detect that downstream systems are about to serve stale data. Without an alarm on it, the first signal is usually angry users.

### Reserved concurrency is a ceiling, not a floor

Reserved concurrency does two things: it guarantees the function can always have at least N executions, and it caps it at exactly N. The cap part is what bites here. A function with reserved concurrency of 5 can never run more than 5 concurrent executions, regardless of stream depth, account quota, or available capacity. It is correct for protecting downstream systems from overload, and wrong for components that need to absorb traffic bursts.

### Search and checkout disagreed because they have different sources of truth

Search reads OpenSearch. Checkout reads DynamoDB. When the indexing pipeline lags, OpenSearch and DynamoDB diverge. This was hidden by the order workflow: inventory was decremented at fulfillment, not at order placement, so checkout's DynamoDB read still saw inventory > 0 for "sold out" SKUs because no fulfillment had happened yet. The customer was charged, then refunded hours later. A more aggressive workflow that decremented inventory at order placement would have caught the divergence at checkout.

## Other Ways This Could Break

### Stream retention exceeded; records dropped

DynamoDB Streams retain records for 24 hours. If the indexer is offline for longer (a deploy bug, a permissions issue, a manual disable that gets forgotten), records age out and are gone. The indexer cannot catch up by replaying the stream; you have to do a full reindex from a DynamoDB scan, which is expensive and time-consuming.
**Prevention:** Alarm on IteratorAge well before 24 hours. Treat the alarm as a paging incident.

### Poison record stalls a shard

A single bad record in the stream causes the function to throw, Lambda retries on the same shard, and progress halts on that shard. IteratorAge climbs for the affected shard while other shards drain normally. Often presents as partial lag, where some SKUs are current and others are stale.
**Prevention:** Configure a destination on the event source mapping so failed batches go to an SQS dead-letter queue or another Lambda after a bounded number of retries. Use ReportBatchItemFailures to skip individual bad records without blocking the shard.

### OpenSearch refresh interval too long for freshness needs

The indexer is fast, documents land in OpenSearch in seconds, but the index has refresh_interval set to 30s. Newly written documents are not searchable for up to 30 seconds. This is per-index OpenSearch tuning, not a Lambda problem.
**Prevention:** Set refresh_interval to 1s for indexes that need near-real-time search. Trade-off: shorter refresh costs more cluster CPU.

### Three or more consumers on one stream

DynamoDB Streams supports two consumers per stream before read throttling. Wire a third Lambda to the same stream and all consumers slow down. Looks like an indexer slowdown but the cause is contention on the stream itself.
**Prevention:** Use Kinesis Data Streams (or DynamoDB to Kinesis) for many fanout consumers. Or have one Lambda fan out to SNS / EventBridge.

## SOP Best Practices

- Alarm on IteratorAge for any Lambda reading from a stream. Default to a 60-second threshold for most production pipelines; tighter for near-real-time freshness needs. Without this alarm, lag is first noticed by stale-data symptoms.
- Treat reserved concurrency settings as load-bearing config. Anything set during a tuning exercise should be revisited annually or whenever the upstream traffic shape changes by more than 2x.
- Make the system of record explicit and consistent across read paths, or surface freshness explicitly in the UX. If search and checkout disagree silently, customers experience the divergence as broken trust.
- Consider OpenSearch Ingestion (zero-ETL) for high-volume DynamoDB-to-OpenSearch pipelines. Managed, scales in OCUs (one OCU handles ~1,000 WCU/sec), no concurrency tuning. Predictable cost and operational profile.

## Learning Objectives

1. **Stream-to-index pipeline mental model**: Articulate how DynamoDB Streams + Lambda + OpenSearch fits together, and where lag accumulates.
2. **IteratorAge as the canonical signal**: Use IteratorAge as the first metric to check when search results lag database state.
3. **Reserved concurrency as a cap**: Recognize that reservedConcurrentExecutions is a hard ceiling and account for it when sizing for bursts.
4. **Source of truth coherence**: Spot when read paths use different stores and design for the divergence (or remove the divergence).

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
