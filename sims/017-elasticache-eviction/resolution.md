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

1. **Immediate -- change eviction policy**:

```bash
aws elasticache modify-cache-parameter-group \
  --cache-parameter-group-name trellis-redis-params \
  --parameter-name-values "ParameterName=maxmemory-policy,ParameterValue=allkeys-lru"
```

After modifying the parameter group, the change takes effect on the next maintenance window or immediately if you reboot the cache node. For immediate relief in a production incident, connect to the Redis node directly and issue:

```
CONFIG SET maxmemory-policy allkeys-lru
```

This takes effect immediately but does not persist across reboots. The parameter group change ensures persistence.

2. **Immediate -- flush stale keys if necessary**: If the cache contains a large volume of expired or low-value data, consider a targeted `SCAN` and `DEL` to free memory before the eviction policy begins clearing keys organically.

3. **Short-term -- add CloudWatch alarms**:

```bash
# Alarm when BytesUsedForCache exceeds 80% of maxmemory
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

# Alarm on sustained high CacheMisses
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

4. **Short-term -- fix application logging**: Change Redis error handling from DEBUG to WARN level. Cache write failures in a cache-aside pattern are operational signals, not debug noise.

5. **Medium-term -- scale the cache layer**: Evaluate one or more of the following:
   - Upgrade to a larger node type (cache.r6g.xlarge: 26.32 GB)
   - Enable cluster mode with multiple shards for horizontal scaling
   - Add a read replica for read-heavy workloads
   - Review TTL values on cached data to ensure natural expiration

6. **Medium-term -- audit cache key lifecycle**: Inventory all cache key patterns, their TTLs, and expected growth rates. Set TTLs explicitly on all keys. Keys without TTLs in a noeviction configuration will accumulate indefinitely.

## Key Concepts

### Redis Eviction Policies

Redis supports several eviction policies when memory reaches the maxmemory limit:

- **noeviction**: Return OOM errors on write commands. Do not evict any keys. Reads continue to work. This is the default in some configurations and is appropriate only when data loss is unacceptable and memory is guaranteed sufficient.
- **allkeys-lru**: Evict the least recently used key across all keys to make room for new writes. The most common general-purpose policy for caching workloads.
- **volatile-lru**: Evict the least recently used key among keys with an expiration (TTL) set. Keys without TTL are never evicted.
- **allkeys-random**: Evict a random key. Less optimal than LRU but lower CPU overhead.
- **volatile-ttl**: Evict the key with the shortest remaining TTL.
- **allkeys-lfu**: Evict the least frequently used key. Better than LRU when access patterns have strong frequency bias.

For caching workloads, `allkeys-lru` is the standard recommendation. It ensures the cache always has room for new writes by evicting the stalest data.

### Cache-Aside Pattern Failure Modes

In a cache-aside (lazy-loading) pattern, the application checks the cache first and falls through to the database on a miss. Common failure modes:

- **Silent cache failure**: The application catches cache errors and falls through to the database without logging or alerting. The cache becomes invisible infrastructure -- when it fails, the database absorbs the full load with no warning.
- **Thundering herd**: When many cache keys expire or become unavailable simultaneously, all requests hit the database at once.
- **Connection pool exhaustion**: The database connection pool is sized for the expected mix of cache hits and misses. When the cache fails completely, the pool is undersized for 100% database traffic.

Mitigation: log cache failures at WARN or ERROR level, implement circuit breakers, size database connection pools for cache-down scenarios, and monitor cache hit ratios.

### ElastiCache Monitoring

Critical CloudWatch metrics for ElastiCache Redis:

- **BytesUsedForCache**: Memory consumed by cache data. Alarm at 80% of maxmemory.
- **CurrItems**: Number of items in the cache. Track growth rate over time.
- **Evictions**: Number of keys evicted. Non-zero means the cache is under memory pressure (with an eviction policy that allows it). Zero with high BytesUsedForCache and noeviction means writes are failing.
- **CacheMisses / CacheHits**: Monitor the miss ratio. A sudden spike in misses indicates cache failure or key expiration.
- **EngineCPUUtilization**: Redis is single-threaded. High CPU indicates the node is processing at capacity.
- **ReplicationLag**: For clusters with replicas, monitor lag to detect replication issues.

## Other Ways This Could Break

### Thundering herd after cache node restart

When a Redis node restarts or fails over, the cache is empty. Every request becomes a cache miss simultaneously, overwhelming the database with a sudden spike rather than a gradual increase. The eviction policy is irrelevant because the problem is an empty cache, not a full one. Enable AOF persistence or snapshot backups so the cache can warm from disk. Implement request coalescing or stampede locks in the application to prevent duplicate queries for the same key.

### Volatile-lru policy with keys missing TTLs

The eviction policy is set to volatile-lru, which only evicts keys that have a TTL. If most keys are written without a TTL, Redis cannot evict them and returns OOM errors even though the policy appears to allow eviction. The symptom is identical to noeviction, but the root cause is a mismatch between the policy and the key lifecycle. When using volatile-lru, enforce TTLs on all keys at the application level, or switch to allkeys-lru so Redis can evict any key regardless of TTL.

### Memory fragmentation causing premature OOM

Redis reports used_memory below maxmemory, but used_memory_rss (actual OS memory) is much higher due to fragmentation. The node runs out of system memory before reaching the configured limit. CloudWatch metrics may not show BytesUsedForCache at 100%, making this harder to detect. Monitor mem_fragmentation_ratio in Redis INFO output and enable activedefrag in the parameter group if it consistently exceeds 1.5.

### Single-node failure with no replication

The Redis node itself becomes unavailable due to hardware failure or AZ disruption, not memory exhaustion. All cache operations fail with connection errors rather than OOM errors. The cascade to the database is the same, but the fix requires failover rather than configuration changes. Deploy ElastiCache with at least one read replica in a different Availability Zone and enable Multi-AZ automatic failover.

## SOP Best Practices

- Always set maxmemory-policy to allkeys-lru or allkeys-lfu for caching workloads at provisioning time. The noeviction policy should only be used when data loss is unacceptable and memory capacity is guaranteed sufficient.
- Create CloudWatch alarms on BytesUsedForCache and CacheMisses for every ElastiCache node at provisioning time, not after the first OOM incident.
- Log cache write failures at WARN or ERROR level in the application. Cache-aside fallbacks that swallow errors at DEBUG level create invisible infrastructure where failures produce no operational signal.
- Set explicit TTLs on all cache keys and review TTL values quarterly to ensure natural expiration keeps pace with data growth.

## Learning Objectives

1. **Redis eviction policy mechanics**: Understand that `noeviction` rejects write commands with OOM errors when memory is full, while `allkeys-lru` evicts least-recently-used keys to make room for new writes
2. **Cache-aside failure detection**: Recognize that silent cache failures (caught at DEBUG level) can cause cascading database overload without any visible cache-layer alerts
3. **ElastiCache monitoring fundamentals**: Know that BytesUsedForCache, CurrItems, Evictions, CacheMisses, and EngineCPUUtilization are the critical metrics for detecting cache memory issues before they become incidents
4. **Red herring discrimination**: Practice separating correlation from causation -- a deploy that coincides with symptoms is not necessarily the root cause

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: High-Performing Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[catalog]] -- elasticache, elb, cloudwatch service entries
