---
tags:
  - type/simulation
  - service/dynamodb
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/performance
---

# Four Million Records, One by One

## Opening

company: Tidepool Goods
industry: e-commerce, Series A startup, 18 engineers
product: handmade ceramics, linen clothing, small-batch pantry items from independent makers
location: Portland
scale: product catalog of 4,000,000 items, most are variants (a mug in seven glazes, a shirt in four sizes, each its own DynamoDB record)
time: Tuesday, 9:58 AM
scene: developer deployed new product search Lambda (category filter feature)
alert: "CRITICAL: order processing pipeline stopped -- ProvisionedThroughputExceededException on every write attempt"
stakes: dead-letter queue filling up, customer service receiving messages from buyers whose orders will not go through
early_signals:
  - search feature worked perfectly in staging (500 items in staging table vs 4,000,000 in production)
  - by 10:15 AM order processing Lambda failing on every attempt
  - dead-letter queue filling with failed orders
  - customer service getting messages from buyers whose orders will not complete
  - search feature returning results slowly and intermittently, appearing functional
  - CloudWatch shows consumed read capacity pinned at provisioned limit of 100 RCUs (had been 18-22 RCUs for six months)
  - spike started at exactly 10:00 AM, two minutes after deployment, but nobody connected the two events
investigation_starting_point: the search feature is new, the order pipeline is not. The order-writer Lambda is receiving ProvisionedThroughputExceededException on every attempt. CloudWatch dashboard shows consumed read capacity at the 100 RCU ceiling since 10:00 AM.

## Resolution

root_cause: product-search Lambda (v14) performs a full table Scan on tidepool-products table with a FilterExpression matching the category attribute. Every invocation reads all 4,000,000 items, consuming RCUs proportional to total data size. FilterExpression does not reduce RCUs consumed -- it only discards non-matching items after they have already been read from storage.
mechanism: provisioned capacity was 100 RCUs. A single Scan of the full table consumed far more than that per second, and each customer search triggered a new invocation. Within minutes, every read operation on the table -- including the order processing pipeline -- was throttled.
fix: immediate fix was to disable the search Lambda. Lasting fix was to create a Global Secondary Index on the category attribute and rewrite the search function to use a Query operation against that index. Query reads only items matching the partition key, consuming a fraction of the capacity.
contributing_factors:
  - no load testing against production-scale data volumes before deploying the search Lambda
  - staging table had 500 items vs 4,000,000 in production
  - no automated check comparing query patterns against provisioned capacity
  - team also evaluated switching from provisioned to on-demand capacity mode as a safeguard
