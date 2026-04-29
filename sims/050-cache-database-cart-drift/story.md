---
tags:
  - type/simulation
  - service/elasticache
  - service/dynamodb
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# The Cart That Forgot Itself

## Opening

- company: Cinderlane
- industry: Online home goods retail
- product: D2C storefront for home decor and furniture
- scale: 95 engineers, 1.1M monthly orders, $148 average order, peak 14k concurrent shoppers
- time: Saturday 14:08 ET, mid Spring Sale (Saturdays in May)
- scene: On-call backend engineer, customer-care has paged on cart-state tickets
- alert: "cinderlane-cs: 3,412 cart-state tickets in 2 hours (baseline 18)"
- stakes: Spring Sale runs until midnight; CTO wants 30-minute updates; conversion is already down 8% on the day
- early_signals:
  - Customers report items disappearing after refresh, sometimes coming back, sometimes appearing twice at checkout
  - cart-update Lambda has zero error rate in CloudWatch
  - DynamoDB cinderlane-carts table dashboard shows green
  - ElastiCache cluster is healthy with normal hit rate
  - Cart-update Lambda logs show occasional WARN entries about "ddb write retry exhausted, cache write succeeded"
- investigation_starting_point: Cart writes are handled by a Lambda function called cart-update. Cart reads go through cart-read. Both run behind API Gateway. The Lambdas were last touched four months ago in a refactor that introduced a write-aside cache. There is a Redis cluster called cinderlane-carts and a DynamoDB table also called cinderlane-carts.

## Resolution

- root_cause: The cart-update Lambda writes to ElastiCache Redis and DynamoDB in parallel using Promise.allSettled. Promise.allSettled never rejects, so when DynamoDB throttles during the Spring Sale and the SDK exhausts its three retries, the function logs a warning, returns 200 to the client, and considers the operation successful. Cache holds the new cart state; DynamoDB does not.
- mechanism: Spring Sale traffic pushes cinderlane-carts table writes from baseline 850 WCU/sec to 4,600 WCU/sec. The table is on PROVISIONED capacity with 2,000 WCU and auto-scaling that ramps in 60-second intervals. Bursts above 2,000 WCU return ProvisionedThroughputExceededException. The SDK retries with exponential backoff (50ms, 100ms, 200ms with jitter) and gives up. The Lambda's allSettled-based parallel write logs a warning ("ddb write retry exhausted, cache write succeeded") and returns success to the user. Cache TTL is 90 seconds. Within 90 seconds of the divergence event, the cache key expires; the next read for that user is a cache miss, falls through to DynamoDB, gets the older cart state, and repopulates the cache with stale data. Customer experience: item appears, then disappears, then sometimes both versions of the cart show up in the brief window when checkout reads DynamoDB while the storefront still has the cached version.
- fix: Restructure cart-update to write to DynamoDB first, then on success invalidate the Redis cache key. Errors propagate to the client. The cache layer becomes a true read-through accelerator; the database is the unconditional source of truth. Apply Spring-Sale-tier auto-scaling (10,000 WCU minimum during sale windows) on the cinderlane-carts table. Optionally, evaluate DynamoDB Accelerator (DAX) which would handle the cache layer with no application code changes.
- contributing_factors:
  - The four-month-old refactor introduced Promise.allSettled to "make cart writes faster" without considering failure semantics
  - DynamoDB auto-scaling has 2,000 WCU baseline that absorbs weekday traffic but not Saturday Spring Sale bursts
  - The cart-update Lambda emits the failure as a WARN log line, not an ERROR or a metric, so dashboards do not light up
  - There is no alarm on cinderlane-carts ThrottledRequests
  - The cache TTL of 90 seconds is short enough that divergence is mostly self-healing within minutes, which made the bug intermittent and hard to reproduce
