---
tags:
  - type/resolution
  - service/elasticache
  - service/dynamodb
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# Resolution: The Cart That Forgot Itself

## Root Cause

The cart-update Lambda writes to ElastiCache Redis and DynamoDB in parallel using `Promise.allSettled`. When DynamoDB throttles during the Spring Sale and the SDK gives up after exhausting its retry budget, `allSettled` does not reject. The function logs a warning and returns 200 to the client. The cache holds the new cart state. DynamoDB still holds the old state.

The cache TTL is 90 seconds. After expiry, the cart-read Lambda misses cache, falls through to DynamoDB, gets the stale cart, and writes that stale data back into the cache. The newly added items vanish from the customer's view. The customer adds them again, possibly succeeding this time or possibly hitting the same throttle, and the dance continues.

The bug had been latent for four months. It manifested only when DynamoDB was throttling, which happened only during the Spring Sale.

## Timeline

| Time (ET) | Event |
|---|---|
| Four months ago | Refactor of cart-update introduces Promise.allSettled to write to cache and database in parallel |
| Today 11:00 | Spring Sale begins; cinderlane-carts table writes climb from 850 to 1,800 WCU/sec |
| Today 12:14 | First customer ticket about cart items disappearing |
| Today 12:30 | Writes hit 2,400 WCU/sec, exceeding the 2,000 WCU baseline; auto-scaling has not yet kicked in |
| Today 12:30+ | Sustained throttling on cinderlane-carts; SDK retries succeed for some writes, fail for others |
| Today 14:00 | 3,412 customer tickets about cart-state issues |
| Today 14:08 | On-call paged |
| Today 14:14 | Engineer compares Redis cart for an affected user_id with the DynamoDB record; they disagree |
| Today 14:18 | cart-update Lambda code reviewed; Promise.allSettled write pattern identified |
| Today 14:21 | DynamoDB ThrottledRequests metric pulled; non-zero throughout the sale |
| Today 14:34 | Patch deployed: writes go to DynamoDB first, then DEL cache key on success; errors propagated |
| Today 14:36 | Auto-scaling target raised to 10,000 WCU baseline for sale windows |
| Today 14:42 | New customer tickets stop arriving; existing diverged carts are reconciled by next read after fix |

## Correct Remediation

1. **Confirm the divergence**: Pick a user_id from a ticket. Read the cart from Redis (`GET carts:user:<id>`) and from DynamoDB (`aws dynamodb get-item --table-name cinderlane-carts --key '{"user_id":{"S":"<id>"}}'`). They will not agree. Cache will hold the newer state.
2. **Find the write path**: Read the cart-update Lambda's code. Look at how it writes to cache and database. If it uses `Promise.all` or `Promise.allSettled` to fan out two writes and treats them symmetrically, that is the divergence source.
3. **Find why one write failed**: DynamoDB has a CloudWatch metric called `ThrottledRequests` and a dimension called `Operation` (`PutItem`, `UpdateItem`). Pull it for cinderlane-carts during the affected window. If it is non-zero, your writes are being throttled. The SDK retries a few times and then throws.
4. **Decide a system of record**: Pick one store as authoritative. For a cart, durability matters more than read latency, so DynamoDB is the right choice.
5. **Restructure the write path**: Cart-update writes to DynamoDB only. On success, invalidate the cache key (`DEL carts:user:<id>`). On failure, return an error to the client. Cart-read uses cache-aside: read cache, fall back to database on miss, repopulate cache. This makes divergence impossible by design: the database is always the latest, and the cache is at most stale by the time it takes a read to repopulate it.
6. **Address the throttling**: Increase auto-scaling baseline for sale windows. Set the cinderlane-carts table to 10,000 WCU minimum during 11 AM to 11 PM ET on Saturdays in May. Or move to PAY_PER_REQUEST billing if the traffic shape is unpredictable.
7. **Reconcile the divergence already in flight**: Run a backfill script that reads every active cart from Redis and writes the value to DynamoDB if its `updated_at` is newer than the DynamoDB record (using a conditional write). Notify affected users that their cart has been refreshed.
8. **Add monitoring**: CloudWatch alarm on cinderlane-carts `ThrottledRequests > 0` for 1 minute. CloudWatch alarm on cart-update Lambda warnings or on a custom metric the Lambda emits when DynamoDB writes fail.

## Key Concepts

### The dual-write anti-pattern

Dual-write happens when application code writes to two stores in parallel and treats both as authoritative. It feels reasonable: cache for speed, database for durability, write to both for safety. But there is no atomic dual-write primitive in AWS, so any failure or latency spike on either store produces divergence. Promise.allSettled, parallel awaits, and even sequential writes that catch the second store's error all fall into this trap.

The fix is to choose one store as the system of record and treat the other as derived. Cache-aside (database is authoritative, cache is opportunistic) and write-through (cache layer fronts the database and keeps it in sync) are both valid. Dual-write is not.

### Cache-aside pattern

Cache-aside is the simplest valid pattern. Reads check cache first, fall back to the database on miss, and repopulate the cache. Writes go only to the database; the cache is invalidated as a side effect (or left to expire via TTL).

The properties:
- The database is always current; cache may be stale up to TTL.
- Failures are visible to the client because the database write is the only write that determines success.
- Cache invalidation happens on successful database writes, so the next read will repopulate from a known-current source.

### Write-through pattern (DAX)

DynamoDB Accelerator (DAX) is a managed write-through cache for DynamoDB. Reads and writes both go through DAX. Writes are committed to DynamoDB, then cached. Reads check the cache, fall back to DynamoDB transparently. The application uses DAX as if it were DynamoDB; cache consistency is the cache layer's responsibility.

DAX is the right choice when you cannot or do not want to manage cache invalidation in application code. It costs more than running your own cache-aside, but it is harder to misuse.

### Why this bug was hard to find

The Lambda's error rate was zero because the function returned 200 every time. The DynamoDB error rate was zero from the table's perspective; throttled requests are a separate metric. The cache hit rate was normal. Each surface looked fine. The only signal was a WARN log line from cart-update that nobody alarmed on, and a non-zero ThrottledRequests metric on the table that nobody alarmed on.

A correctly-built system has alarms on the metrics that go non-zero before user-visible failures. ThrottledRequests is one of those metrics. So is any custom metric the application emits when one half of a write succeeds and the other fails. Without those alarms, the failure surfaces as customer complaints, hours after the divergence began.

## Other Ways This Could Break

### Long cache TTL

Same dual-write code, but the cache TTL is one hour instead of 90 seconds. Divergence persists much longer; customers complain at greater scale before any cache miss surfaces the database version.
**Prevention:** Use the shortest cache TTL that still produces an acceptable hit ratio. For ecommerce carts, 60 to 300 seconds is typical. Better yet, invalidate the cache on every write.

### Crash between sequential writes

Even with sequential writes (cache then DB), a crash or timeout between them produces divergence. Cache holds the new state and the database is unaware. This is the durability gap of any non-transactional dual-write.
**Prevention:** Write to the durable store first, then update or invalidate cache. Use DAX to remove the dual-write entirely. Or use DynamoDB Streams to drive cache invalidation reactively.

### Different keys for the same data

Cache keyed by session ID, database keyed by user ID. Anonymous shoppers write to cache; signed-in shoppers write to database. Carts diverge whenever a shopper signs in mid-session.
**Prevention:** Pick one canonical key for cart state across all stores. Map session-to-user at sign-in and migrate the cart explicitly.

### Cache cluster failover during writes

ElastiCache Redis fails over to a replica. For a few seconds during failover, writes can land on the old primary (now read-only) while reads come from the new primary. Briefly the cache returns stale data even though the database is current.
**Prevention:** Use the cluster's primary endpoint for writes and reader endpoint for reads. Configure SDK retries to handle connection failures during failover. Test failover under load periodically.

## SOP Best Practices

- Pick a single system of record per data class. Cart state, user profile, and order history each have one authoritative store. Caches are for performance only. This makes divergence impossible by design.
- Use cache-aside when you control application code, write-through (DAX) when you want the cache layer to handle consistency, and avoid dual-write entirely. Promise.allSettled and parallel writes to two stores is an anti-pattern.
- Alarm on ThrottledRequests for any DynamoDB table. Throttling is silent to the client (the SDK retries) until the retry budget runs out. By the time errors are user-visible, divergence has been accumulating for minutes.
- Test write paths under simulated DynamoDB throttling. Inject `ProvisionedThroughputExceededException` using the AWS SDK's middleware in load tests. Confirm the application returns errors to the client rather than swallowing them and writing only to cache.

## Learning Objectives

1. **Cache-aside vs write-through vs dual-write**: Pick the right pattern for the consistency need and the team's tolerance for application complexity.
2. **DynamoDB throttling and SDK retries**: Read ProvisionedThroughputExceededException as a load signal; understand that SDK retries can mask the failure briefly.
3. **Promise.allSettled hazards**: Recognize that "allSettled" silently absorbs rejection, which makes it unsafe when one of the awaited operations is load-bearing.
4. **Single source of truth**: Make the database authoritative and cache derived; never let two stores both claim authority.

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
