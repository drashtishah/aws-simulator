---
tags:
  - type/resolution
  - service/elasticache
  - service/elb
  - service/cloudwatch
  - difficulty/associate
  - category/performance
---

# Resolution: The Cache That Forgot Everything

## Root Cause

The ElastiCache Redis node `trellis-redis-prod` (cache.r6g.large, single node, 13.07 GB maxmemory) reached 100% memory utilization with `maxmemory-policy` set to `noeviction`. Redis returned OOM errors on all write commands (SET, HSET, LPUSH). The application's cache-aside implementation caught Redis write errors but logged them at DEBUG level only, then silently fell through to direct database queries. Every request that would have been a cache hit became a PostgreSQL query. The RDS connection pool (max 200) saturated. Query latency increased from 5ms to 800ms. Under load with patient retries, ALB TargetResponseTime climbed to 8.2 seconds. Appointment booking success rate dropped from 99.2% to 61%.

The deploy at 07:15 UTC added lab result caching, which consumed the remaining ~400 MB of Redis memory approximately two hours faster. The deploy did not introduce the vulnerability. The root cause was the combination of noeviction policy, absent memory monitoring, and a single-node cluster with no scaling plan.

## Timeline

| Time (UTC) | Event |
|---|---|
| 2024-09 | ElastiCache Redis node `trellis-redis-prod` provisioned. cache.r6g.large, single node. maxmemory-policy set to noeviction during initial setup. |
| 2024-09 to 2026-03 | Cache usage grows steadily as patient base scales from 180,000 to 520,000. No CloudWatch alarms configured for BytesUsedForCache or CurrItems. |
| 2026-03-27 05:00 | BytesUsedForCache at 12.8 GB (~93% of 13.07 GB maxmemory). |
| 2026-03-27 07:15 | Deploy adds lab result caching layer. New cache keys begin consuming remaining memory. |
| 2026-03-27 07:28 | BytesUsedForCache reaches maxmemory (13.07 GB). Redis begins returning OOM errors on write commands. Evicted keys: 0 (noeviction). |
| 2026-03-27 07:30 | Application logs first "Cache SET failed: OOM" at DEBUG level. Cache misses begin climbing. |
| 2026-03-27 07:45 | All reads falling through to PostgreSQL. RDS DatabaseConnections climbing from baseline 40. |
| 2026-03-27 08:30 | RDS DatabaseConnections at 180. CPUUtilization at 72%. ALB TargetResponseTime at 3.4 seconds. |
| 2026-03-27 09:00 | RDS DatabaseConnections at 200 (pool max). CPUUtilization at 85%. TargetResponseTime at 6.1 seconds. |
| 2026-03-27 09:23 | First provider office complaint. Scheduling pages loading slowly. |
| 2026-03-27 09:30 | Seven support tickets. Booking success rate at 61%. TargetResponseTime at 8.2 seconds. RDS CPUUtilization at 89%. |
| 2026-03-27 09:30 | Investigation begins. |

## Correct Remediation

1. **Immediate -- tell Redis to make room instead of rejecting writes**: The core fix is changing how Redis behaves when its memory is full. Right now, the eviction policy (maxmemory-policy) is set to noeviction, which means Redis refuses all new writes with an Out of Memory error. Change it to allkeys-lru, which tells Redis to automatically remove the least recently used data to make room:

```bash
aws elasticache modify-cache-parameter-group \
  --cache-parameter-group-name trellis-redis-params \
  --parameter-name-values "ParameterName=maxmemory-policy,ParameterValue=allkeys-lru"
```

This updates the parameter group (the saved configuration for the cache node), but it does not take effect until the next maintenance window or a manual reboot. For immediate relief during a production incident, connect to the Redis node directly and run:

```
CONFIG SET maxmemory-policy allkeys-lru
```

This takes effect instantly but does not survive a reboot. Do both -- the direct command for immediate relief and the parameter group change for permanence.

2. **Immediate -- manually free memory if needed**: If the cache is packed with expired or low-value data, you can manually scan and delete keys to free space faster. Use the SCAN command (which iterates through keys without blocking Redis) and DEL to remove what you find.

3. **Short-term -- set up early warning alarms**: Create CloudWatch alarms so you know about memory pressure before it causes an outage. BytesUsedForCache tracks how much memory the cache is using. CacheMisses counts how many times the app asked for something that was not in the cache:

```bash
# Alert when cache memory exceeds 80% of the maximum
aws cloudwatch put-metric-alarm \
  --alarm-name trellis-redis-memory-high \
  --namespace AWS/ElastiCache \
  --metric-name BytesUsedForCache \
  --dimensions Name=CacheClusterId,Value=trellis-redis-prod \
  --statistic Average \
  --period 300 \
  --threshold 11215028838 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:trellis-platform-alerts

# Alert when cache misses spike -- a sign the cache is not serving its purpose
aws cloudwatch put-metric-alarm \
  --alarm-name trellis-redis-cache-misses-high \
  --namespace AWS/ElastiCache \
  --metric-name CacheMisses \
  --dimensions Name=CacheClusterId,Value=trellis-redis-prod \
  --statistic Sum \
  --period 300 \
  --threshold 10000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:trellis-platform-alerts
```

4. **Short-term -- make cache errors visible**: The app was catching Redis OOM errors at DEBUG level, which made them practically invisible. Change the log level to WARN. In a cache-aside pattern (check cache, fall back to database), write failures are real operational problems, not debug noise.

5. **Medium-term -- give the cache more room to grow**: Evaluate one or more of the following:
   - Upgrade to a bigger node (cache.r6g.xlarge gives 26.32 GB instead of 13.07 GB)
   - Turn on cluster mode, which spreads data across multiple nodes (called horizontal sharding)
   - Add a read replica -- a second node that handles read traffic to reduce load on the primary
   - Review TTL values (expiration timers) on cached data to ensure old data expires naturally

6. **Medium-term -- audit what is in the cache and how long it stays**: Inventory all cache key patterns, their TTLs, and expected growth rates. Set explicit TTLs on all keys. A TTL tells Redis to automatically delete a key after a set time. Without TTLs, data accumulates forever.

## Key Concepts

### What happens when the cache is full -- Redis eviction policies

When Redis reaches its memory limit (maxmemory), the eviction policy (maxmemory-policy) decides what to do. Think of it as the "when the closet is full" rule -- do you throw out old clothes to make room, or refuse to buy anything new?

- **noeviction**: Redis refuses all new writes and returns Out of Memory (OOM) errors. Existing data is safe, but the application cannot store anything new. Reads still work. This is only appropriate when losing cached data is unacceptable and you are certain the cache will never fill up.
- **allkeys-lru**: Redis automatically removes the least recently used key (the one that has not been read or written in the longest time) to make room for new data. This is the standard recommendation for caching workloads.
- **volatile-lru**: Same as allkeys-lru, but only removes keys that have an expiration timer (TTL) set. Keys without a TTL are never removed, even under memory pressure.
- **allkeys-random**: Redis removes a random key. Less smart than LRU but uses slightly less CPU.
- **volatile-ttl**: Redis removes the key closest to expiring.
- **allkeys-lfu**: Redis removes the least frequently used key (the one accessed the fewest times overall). Better than LRU when some data is accessed rarely but recently.

For caching workloads, allkeys-lru is almost always the right choice. It ensures the cache always has room for new writes by clearing out the stalest data.

### How the cache-aside pattern fails silently

In a cache-aside pattern (also called lazy-loading), the application checks the cache first. If the data is there (a cache hit), it uses it. If not (a cache miss), it queries the database, stores the result in the cache for next time, and returns it. This works well until the cache breaks:

- **Silent cache failure**: The application catches cache errors and quietly falls through to the database without logging or alerting. The cache becomes invisible infrastructure -- it can stop working entirely and nobody notices because the app keeps functioning, just slower.
- **Thundering herd**: When many cache keys expire or become unavailable at the same time, all requests hit the database simultaneously, overwhelming it.
- **Connection pool exhaustion**: The database has a fixed number of connections available (a connection pool). It is sized for the normal mix of cache hits and misses. When the cache fails completely, every request hits the database, and the pool runs dry.

To avoid these: log cache failures at WARN or ERROR level so they are visible, size your database connection pool for worst-case scenarios, and monitor the cache hit ratio.

### Metrics to watch -- ElastiCache monitoring

CloudWatch collects metrics from ElastiCache automatically. These are the critical ones for detecting memory problems early:

- **BytesUsedForCache**: How much memory the cache is using. Set an alarm at 80% of maxmemory so you have warning before it fills up.
- **CurrItems**: How many items are stored in the cache. Track the growth rate over time to predict when you will run out of space.
- **Evictions**: How many keys Redis has removed to free space. If this is non-zero, the cache is under memory pressure (but handling it). If it is zero and BytesUsedForCache is at 100%, that means writes are failing (noeviction is active).
- **CacheMisses / CacheHits**: The ratio of misses to hits tells you how effective the cache is. A sudden spike in misses means something is wrong -- either the cache failed or keys are expiring faster than expected.
- **EngineCPUUtilization**: Redis processes commands on a single thread. High CPU means the node is at capacity and may need scaling.
- **ReplicationLag**: For setups with backup nodes (replicas), this shows how far behind the replica is. High lag means the backup may not have the latest data.

## Other Ways This Could Break

### All requests slam the database at once after a cache restart (thundering herd)

When a Redis node restarts or switches to a backup, the cache starts completely empty. Every single request becomes a cache miss at the same time, flooding the database with a sudden spike instead of a gradual increase. The eviction policy does not matter here because the problem is an empty cache, not a full one. To prevent this, turn on data persistence so Redis can reload its data from disk after a restart. Redis supports two options: append-only file (AOF, which logs every write) and snapshots (which save the full dataset periodically). On the application side, use request coalescing or stampede locks -- techniques that prevent hundreds of identical database queries when many requests all miss the same cache key at once.

### The eviction policy only removes keys with expiration timers, but most keys have none

The eviction policy is set to volatile-lru, which tells Redis to only remove keys that have a TTL (a time-to-live expiration timer). If most keys were stored without a TTL, Redis cannot remove them to free space, and it returns OOM errors -- the exact same symptom as noeviction. The policy appears to allow eviction, but in practice nothing can be evicted because nothing qualifies. When using volatile-lru, make sure every key the application writes has an explicit TTL. Or switch to allkeys-lru, which lets Redis remove any key regardless of TTL.

### Memory fragmentation makes Redis run out of system memory early

Redis tracks its own memory usage (used_memory), but the operating system may be using more real memory (used_memory_rss) due to fragmentation. Fragmentation happens when data of different sizes is written and deleted over time, leaving gaps in memory. The node can run out of actual system memory even though Redis thinks it has room. CloudWatch might not show BytesUsedForCache at 100%, making this harder to spot. Monitor the mem_fragmentation_ratio in the Redis INFO output. If it consistently exceeds 1.5, enable the activedefrag setting in the parameter group, which tells Redis to reorganize memory in the background.

### The cache node itself goes down, not just out of memory

Instead of memory exhaustion, the Redis node becomes completely unavailable -- hardware failure, network issue, or the entire Availability Zone (a physical data center section within a region) goes offline. All cache operations fail with connection errors, not OOM errors. The database cascade is the same, but the fix is failover (switching to a backup node), not configuration changes. Deploy ElastiCache with at least one read replica in a different Availability Zone and turn on Multi-AZ automatic failover so AWS switches traffic to the backup automatically.

## SOP Best Practices

- When you first set up a cache for a caching workload, configure the eviction policy (maxmemory-policy) to allkeys-lru or allkeys-lfu. These tell Redis to automatically remove the least recently (or least frequently) used data when memory is full. The noeviction policy should only be used when losing cached data is unacceptable and you are certain the cache will never fill up.
- Set up CloudWatch alarms on BytesUsedForCache (memory usage) and CacheMisses (requests the cache could not answer) for every ElastiCache node when you first create it -- not after the first Out of Memory incident.
- Log cache write failures at WARN or ERROR level in the application, not DEBUG. When a cache-aside pattern (check cache, fall back to database) swallows errors at DEBUG level, the cache becomes invisible infrastructure -- it can completely stop working and nobody notices because the errors are hidden.
- Set explicit TTLs (expiration timers) on all cache keys and review them quarterly. A TTL tells Redis to automatically delete a key after a set time. Without TTLs, data accumulates forever, and data growth will eventually fill the cache again.

## Learning Objectives

1. **Redis eviction policy mechanics**: Understand that `noeviction` rejects write commands with OOM errors when memory is full, while `allkeys-lru` evicts least-recently-used keys to make room for new writes
2. **Cache-aside failure detection**: Recognize that silent cache failures (caught at DEBUG level) can cause cascading database overload without any visible cache-layer alerts
3. **ElastiCache monitoring fundamentals**: Know that BytesUsedForCache, CurrItems, Evictions, CacheMisses, and EngineCPUUtilization are the critical metrics for detecting cache memory issues before they become incidents
4. **Red herring discrimination**: Practice separating correlation from causation -- a deploy that coincides with symptoms is not necessarily the root cause

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: High-Performing Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[catalog]] -- elasticache, elb, cloudwatch service entries
