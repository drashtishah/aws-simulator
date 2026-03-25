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

Tidepool Goods sells handmade ceramics, linen clothing, and small-batch pantry items from independent makers. The company is based in Portland. There are eighteen engineers and a product catalog of four million items, most of them variants -- a mug in seven glazes, a shirt in four sizes, each its own record in the DynamoDB table.

On Tuesday at 9:58 AM, a developer deployed a new product search Lambda. The feature let customers filter the catalog by category. It worked perfectly in staging. There were five hundred items in the staging table. In production there were four million. Nobody had thought to check.

By 10:15 AM the order processing pipeline had stopped. The Lambda that writes confirmed orders to the same DynamoDB table was receiving `ProvisionedThroughputExceededException` on every attempt. The dead-letter queue was filling up. Customer service started getting messages from buyers whose orders would not go through. The search feature, meanwhile, was returning results -- slowly, and only sometimes, but it was returning them.

The CloudWatch dashboard showed consumed read capacity pinned at the provisioned limit of 100 RCUs. It had been sitting at 18-22 RCUs for the past six months. The spike started at exactly 10:00 AM, two minutes after the deployment. Nobody connected the two events right away. The search feature was new. The order pipeline was not.

## Resolution

The product-search Lambda was performing a full table Scan on the `tidepool-products` table with a `FilterExpression` matching the `category` attribute. Every invocation read all four million items, consuming read capacity units proportional to the total data size. The FilterExpression did not reduce the RCUs consumed. It only discarded non-matching items after they had already been read from storage.

The provisioned capacity was 100 RCUs. A single Scan of the full table consumed far more than that per second, and each customer search triggered a new invocation. Within minutes, every read operation on the table -- including the order processing pipeline -- was being throttled.

The immediate fix was to disable the search Lambda. The lasting fix was to create a Global Secondary Index on the `category` attribute and rewrite the search function to use a Query operation against that index. The Query reads only the items matching the partition key, consuming a fraction of the capacity. The team also evaluated switching from provisioned to on-demand capacity mode as a safeguard against future spikes.
