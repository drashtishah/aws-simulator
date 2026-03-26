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

1. **Stop the bleeding immediately**: The search function is devouring all the table's read capacity. Disable it by removing its API Gateway trigger (the route that sends web requests to it) or setting its allowed concurrent executions to 0. This frees up read capacity for the order pipeline within seconds.
2. **Build a shortcut for category lookups**: Create a Global Secondary Index (GSI) on the `tidepool-products` table. A GSI is like a second table of contents organized by a different attribute -- in this case, `category` as the main lookup key and `productName` as a secondary sort key. This lets the database jump directly to matching items instead of reading everything.
3. **Rewrite the search code to use the shortcut**: Replace the `Scan` + `FilterExpression` call with a `Query` against the new GSI using `KeyConditionExpression`. A Scan reads every item in the table and then throws away what does not match. A Query tells the database exactly what to look for, so it reads only the matching items -- dramatically less work for the same result.
4. **Consider automatic scaling for the table**: The table currently has a fixed read budget (called provisioned capacity). On-demand capacity mode removes the fixed limit and scales automatically based on traffic. This prevents capacity exhaustion from sudden spikes, though it costs more per individual read.
5. **Require load testing for new features**: Any new function that reads from a shared DynamoDB table should be tested against production-scale data volumes before deployment. A search that works fine on 1,000 test items can cripple a table with 4 million items.

## Key Concepts

### Query vs Scan -- Two Very Different Ways to Read Data

Think of a DynamoDB table as a massive filing cabinet. A **Query** is like knowing exactly which drawer to open -- you go straight to the items that match a specific key and read only those. A **Scan** is like opening every drawer and looking through every folder, one by one, from start to finish. Even if you only want a handful of items, a Scan reads everything.

For a table with 4 million items, a Query targeting 200 matching items reads about 200 items worth of capacity. A Scan that returns the same 200 items still reads all 4 million items worth of capacity. The cost difference is enormous.

### What Is a Global Secondary Index (GSI)?

A DynamoDB table organizes its data by a primary key (like `productId`). But what if you want to look up items by a different attribute, like `category`? That is what a Global Secondary Index is for. It is like creating a second table of contents for your filing cabinet, organized by category instead of product ID. Once the GSI exists, you can run a Query by category and go straight to the matching items.

Key things to know about GSIs:
- The attribute you choose as the GSI's main key should have many distinct values (called high cardinality) so reads spread evenly
- Every time you write to the main table, DynamoDB also updates the GSI, which uses additional write capacity
- GSI reads are always eventually consistent -- there may be a brief delay before newly written data appears in the index

### Choosing a Good Primary Key

DynamoDB splits data into internal storage units called partitions. The partition key determines which partition stores each item. A good partition key has many unique values (like `productId`) so data and traffic spread evenly. A bad partition key (like `status`, which might have only 3 values) concentrates data and traffic on a few partitions.

### How to See Read Consumption

You can ask DynamoDB to report how much capacity each operation used by setting `ReturnConsumedCapacity` to `TOTAL` or `INDEXES` in your API call. For a broader view, the CloudWatch metric `ConsumedReadCapacityUnits` shows total reads per minute for the table. When this metric equals your provisioned limit, every additional read is rejected.

### FilterExpression vs KeyConditionExpression -- A Common Trap

A `KeyConditionExpression` is used with Query and tells DynamoDB which items to read from storage. It reduces the actual work the database does. A `FilterExpression` is different -- it is applied after the data has already been read. It filters the results you get back, but the database still did all the reading work and consumed all the capacity. A FilterExpression on a Scan gives you the illusion of a targeted search while still reading the entire table behind the scenes.

## Other Ways This Could Break

### One popular item gets all the traffic and overwhelms its storage partition

DynamoDB splits data across internal storage units called partitions. If one partition key value (like a single product ID) gets far more traffic than others, that partition becomes a bottleneck. The confusing part: overall read consumption may look normal, but requests to that one key get throttled. In this sim, the problem was total table-level exhaustion from a Scan. A hot partition problem is more subtle -- the table as a whole has capacity to spare, but one slice is overwhelmed. Prevention: choose partition keys with many unique values so traffic spreads evenly. Use CloudWatch Contributor Insights to detect which keys are getting the most traffic.

### A secondary index cannot keep up with writes, which slows down the main table

When you create a Global Secondary Index (GSI), DynamoDB must update that index every time you write to the main table. If the index does not have enough write capacity, DynamoDB throttles writes to the main table itself to prevent the index from falling behind. In this sim, there was no GSI and reads were the problem. With GSI back-pressure, writes fail even though the main table has plenty of capacity -- a frustrating mismatch. Prevention: give the GSI enough write capacity to match the main table's write rate. Monitor the metric `IndexWriteProvisionedThroughputExceeded`. Use on-demand mode if write patterns are unpredictable.

### An on-demand table hits its automatic scaling limit during a sudden spike

On-demand capacity mode removes the fixed read/write budget and scales automatically. But it still has a limit: traffic cannot more than double within a 30-minute window. This sim uses provisioned mode with a hard ceiling. With on-demand mode, a brand-new feature that suddenly generates heavy traffic can hit the scaling ceiling even though there is no manually set limit. Prevention: gradually ramp up traffic before launching a new feature so the on-demand scaling can keep pace. Set a maximum throughput limit as a cost safety net. Monitor for throttling with the reason `MaxOnDemandThroughputExceeded`.

### A scheduled batch job reads the entire table and starves other operations

A batch job (for analytics, data exports, or backfills) that reads the entire table causes the same capacity exhaustion as this sim, but it happens on a schedule rather than after a deployment. The symptoms appear periodically -- every night at 2 AM, for example -- and disappear once the job finishes. Prevention: read the table in small pages with deliberate pauses between each page to spread the load over time. Better yet, run batch reads against a read replica or a separate copy of the table so production traffic is not affected.

## SOP Best Practices

- Design your table so that everyday lookups use Query (which goes straight to the matching items) instead of Scan (which reads the entire table). Scan should be reserved for rare administrative tasks, never for user-facing features.
- Before deploying any new function that reads from a shared DynamoDB table, test it against production-scale data volumes. A search that works fine on 1,000 test items can cripple a table with 4 million items.
- Set up CloudWatch alarms on ConsumedReadCapacityUnits (how much of your read budget is being used) and ThrottledRequests (how many reads are being rejected). You want to know about capacity problems within minutes, not after customers start complaining.
- During code reviews, watch for FilterExpression used with Scan. A FilterExpression only filters results after the entire table has already been read -- it does not save any read capacity. If you see this pattern, it almost always means the code needs a Global Secondary Index and a Query instead.

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
