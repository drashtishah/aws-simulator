---
tags:
  - type/simulation
  - service/dynamodb
  - service/opensearch
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# Yesterday's Inventory, Today's Cart

## Opening

- company: Lumenfold
- industry: Online apparel retail
- product: Storefront for branded apparel and accessories, mostly women's and unisex casual wear
- scale: 220 engineers, 2.4M monthly active shoppers, peak 6,800 concurrent shoppers, average $84 order
- time: Tuesday 11:42 ET, mid-day buying peak
- scene: On-call platform engineer, customer-care has paged because refund volume is spiking
- alert: "lumenfold-cs: 412 fulfillment-impossible tickets in 90 min (baseline 4)"
- stakes: Refund volume eats 6% of margin per occurrence; Trustpilot reviews citing the issue published this morning; the "Spring Premium" line launched yesterday and is heavily merchandised
- early_signals:
  - Customers buy items, payment succeeds, then a "sorry, out of stock" email arrives 40 min later
  - Storefront search shows items as available; checkout passes; warehouse cannot fulfill
  - Inventory ingest into DynamoDB is healthy and current
  - OpenSearch cluster is green with normal query latency
  - No Lambda errors, no DynamoDB throttling
- investigation_starting_point: Search runs against OpenSearch domain lumenfold-search. Inventory writes go to DynamoDB table lumenfold-inventory. There is a Lambda function called lumenfold-catalog-indexer that bridges them via DynamoDB Streams. The function was last touched seven months ago.

## Resolution

- root_cause: The lumenfold-catalog-indexer Lambda has reservedConcurrentExecutions set to 5. It was set last year when the catalog had 40,000 SKUs and the morning refresh wrote 20,000 changes. Today the catalog has 380,000 SKUs and the morning Spring Premium launch wrote 380,000 inventory updates in 18 minutes.
- mechanism: The DynamoDB stream had records arriving faster than 5 concurrent Lambda executions could index them. The stream backs up; IteratorAge climbs. By 11:42 it is at 4 hours 12 minutes. OpenSearch documents reflect inventory state from before the Spring Premium launch. Storefront search returns those stale documents. Customer adds a sold-out item to cart. Checkout reads DynamoDB directly (current) and finds inventory because no other shopper has bought the SKU yet either; payment goes through. By the time fulfillment picks the order, the warehouse system shows zero. A "sorry" email is sent and the order is refunded.
- fix: Remove the reservedConcurrentExecutions cap on lumenfold-catalog-indexer. Within 4 minutes the function scales to 60 concurrent executions and starts draining the backlog at 6.2x the inflow rate. IteratorAge falls from 14.5M ms to under 5,000 ms in 12 minutes. OpenSearch documents are now within seconds of DynamoDB. Refund rate drops to baseline.
- contributing_factors:
  - Reserved concurrency was set during a tuning exercise last year and never re-examined as catalog volume grew
  - There was no CloudWatch alarm on IteratorAge for the indexer
  - Search-fronted commerce uses OpenSearch as the read path but DynamoDB as the truth path, with no consistency check between them
  - The morning's Spring Premium launch concentrated 380k writes into 18 minutes, when normal daily writes spread evenly are about 50k per hour
  - Operational dashboards showed both DynamoDB and OpenSearch as healthy in isolation; nothing surfaced the lag between them
