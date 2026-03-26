---
tags:
  - type/resolution
  - service/dynamodb
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/performance
---

# Resolution: Four Million Records, One by One

## Root Cause

The `tidepool-product-search` Lambda function performed a full DynamoDB `Scan` on the `tidepool-products` table (4,012,387 items) with a `FilterExpression` on the `category` attribute. A Scan reads every item in the table regardless of the filter. Each invocation consumed read capacity units proportional to the entire table size. With the table provisioned at 100 RCUs and multiple concurrent search requests, all read capacity was exhausted within seconds. The `tidepool-order-writer` Lambda and all other table consumers began receiving `ProvisionedThroughputExceededException`, halting order processing.

## Timeline

| Time | Event |
|---|---|
| 09:58 UTC | Developer deploys `tidepool-product-search` Lambda (v14) via CI/CD pipeline |
| 10:00 UTC | First customer triggers a category search; full table Scan begins |
| 10:02 UTC | ConsumedReadCapacityUnits reaches 100 (provisioned limit); throttling begins |
| 10:03 UTC | `tidepool-order-writer` Lambda logs first `ProvisionedThroughputExceededException` |
| 10:05 UTC | ThrottledRequests metric rises to 47/min; order dead-letter queue begins filling |
| 10:10 UTC | `tidepool-order-writer` Lambda starts timing out (30s timeout, waiting on throttled reads) |
| 10:15 UTC | Order backlog reaches 400; customer service receives first complaints about stuck orders |
| 10:22 UTC | CloudWatch alarm fires on ThrottledRequests > 10 for 5 consecutive minutes |
| 10:25 UTC | On-call engineer begins investigating; suspects Lambda timeout configuration |
| 10:38 UTC | Root cause identified: product-search Scan consuming all provisioned RCUs |
| 10:40 UTC | Search Lambda disabled; throttling stops within 60 seconds |
| 10:42 UTC | Order pipeline resumes; dead-letter queue begins draining |

## Correct Remediation

1. **Immediate -- Disable the search Lambda**: Remove the API Gateway trigger or set the Lambda concurrency to 0 to stop the Scans. This restores read capacity to the order pipeline within seconds.
2. **Add a Global Secondary Index**: Create a GSI on the `tidepool-products` table with `category` as the partition key and `productName` as the sort key. This allows efficient Query operations by category.
3. **Rewrite Scan to Query**: Replace the `Scan` + `FilterExpression` call with a `Query` against the new GSI using `KeyConditionExpression`. This reads only matching items instead of the entire table.
4. **Consider on-demand capacity mode**: Evaluate switching from provisioned to on-demand capacity for the `tidepool-products` table. On-demand mode scales automatically and prevents throttling from sudden read spikes, though at higher per-request cost.
5. **Add load testing for new access patterns**: Any new Lambda that reads from a shared DynamoDB table should be load-tested against production-scale data before deployment.

## Key Concepts

### Query vs Scan

A **Query** operation uses the partition key (and optionally the sort key) to locate specific items. It reads only the items that match the key condition. A **Scan** operation reads every item in the entire table, then optionally applies a filter. The filter does not reduce the read capacity consumed -- it only reduces the data returned to the caller.

For a table with 4 million items, a Query targeting 200 matching items reads ~200 items worth of RCUs. A Scan with a FilterExpression that returns 200 items still reads all 4 million items worth of RCUs.

### Global Secondary Index (GSI) Design

A GSI projects some or all attributes from the base table into a new index with a different partition key and optional sort key. This enables Query access patterns that the base table's key schema does not support. GSIs have their own provisioned capacity, separate from the base table.

Key considerations:
- GSI partition key should have high cardinality to distribute reads evenly
- GSI writes consume WCUs on the index in addition to the base table
- GSI eventually consistent only (no strongly consistent reads)

### Partition Key Selection

A well-chosen partition key distributes data and requests evenly. For the `tidepool-products` table, `productId` is a good base table partition key (unique per item). For the search use case, `category` works as a GSI partition key because searches are always by category.

### ConsumedCapacity and ReturnConsumedCapacity

DynamoDB operations can return capacity consumption data when `ReturnConsumedCapacity` is set to `TOTAL` or `INDEXES`. This is essential for debugging. The `ConsumedReadCapacityUnits` CloudWatch metric shows aggregate consumption per minute. When this metric equals the provisioned RCUs, every additional read is throttled.

### FilterExpression vs KeyConditionExpression

`KeyConditionExpression` is used with Query and defines which items to read based on the key. It reduces the data DynamoDB reads from storage. `FilterExpression` is applied after the data is read and only reduces what is returned to the caller. It does not save any RCUs.

## Other Ways This Could Break

### Hot partition key causes throttling even with adequate total capacity

A hot partition issue occurs when one partition key receives disproportionate traffic, throttling that partition even if overall provisioned capacity is not saturated. Unlike this sim -- where a Scan exhausts total table-level RCUs -- the CloudWatch metric ThrottledRequests rises but ConsumedReadCapacityUnits may stay below the provisioned limit. Prevention: choose high-cardinality partition keys, use CloudWatch Contributor Insights to detect hot keys, and consider write sharding for frequently accessed keys.

### GSI write throttling causes back-pressure on the base table

When a GSI has insufficient write capacity, DynamoDB throttles writes to the base table to maintain index consistency. In this sim, no GSI exists and reads are the problem. With GSI back-pressure, write operations fail even though the base table itself has capacity. Prevention: provision GSI write capacity proportional to the base table write rate, monitor IndexWriteProvisionedThroughputExceeded, and use on-demand mode if write patterns are unpredictable.

### On-demand table throttled by exceeding double the previous peak within 30 minutes

On-demand tables scale automatically but still have a limit: traffic cannot exceed double the previous peak within a 30-minute window. This sim uses provisioned mode with a hard RCU ceiling. A sudden burst from a new feature can hit the on-demand ceiling even when there is no fixed provisioned limit. Prevention: pre-warm on-demand tables by gradually increasing traffic before launch, set maximum throughput limits as a cost safeguard, and monitor for MaxOnDemandThroughputExceeded throttling reasons.

### Paginated Scan with no rate limiting starves other operations during batch jobs

A batch-processing Scan (for analytics, exports, or backfills) causes the same capacity exhaustion as this sim but happens during scheduled jobs rather than on-demand API calls. The symptoms appear periodically rather than suddenly after a deployment. Prevention: use a smaller page size (Limit parameter) on batch Scans, add deliberate pauses between pages, and run batch Scans on a read replica or isolated shadow table.

## SOP Best Practices

- Design tables for Query access from the start. Treat Scan as a last resort for administrative or one-time operations, never for user-facing read paths.
- Load-test every new Lambda against production-scale data volumes before deployment, especially when the Lambda reads from a shared DynamoDB table.
- Set CloudWatch alarms on both ConsumedReadCapacityUnits and ThrottledRequests so that capacity exhaustion is detected within minutes, not after customer complaints.
- Review FilterExpression usage in code reviews. A FilterExpression on a Scan is almost always a sign that a GSI or a redesigned key schema is needed.

## Learning Objectives

1. **Scan vs Query**: Understand that a Scan reads every item in the table and consumes RCUs proportional to total data size, regardless of FilterExpression
2. **FilterExpression misconception**: A FilterExpression does not reduce capacity consumption -- it only filters the result set after the data has been read
3. **GSI as a solution**: Global Secondary Indexes enable efficient Query access patterns on non-key attributes without scanning the entire table
4. **Shared capacity impact**: When one consumer exhausts provisioned RCUs, all other consumers of the same table are throttled
5. **Symptoms vs root cause**: Lambda timeouts and downstream failures are often symptoms of upstream throttling, not independent problems

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: DynamoDB, Domain 4: Troubleshooting
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: High-Performing Architectures
- [[catalog]] -- dynamodb, cloudwatch, lambda service entries
