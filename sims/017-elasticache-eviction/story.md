---
tags:
  - type/simulation
  - service/elasticache
  - service/elb
  - service/cloudwatch
  - difficulty/associate
  - category/performance
---

# The Cache That Forgot Everything

## Opening

company: Trellis Health
industry: healthtech, telehealth appointment platform, Series C, 42 engineers
product: provider availability lookups, appointment creation, patient record retrieval
scale: 520,000 registered patients, 8,400 appointments per day across provider offices in 12 states
architecture: ALB fronts ECS cluster running appointment service, cache-aside pattern with ElastiCache Redis node (cache.r6g.large, 13.07 GB maxmemory) for hot data (doctor availability refreshed every 5 minutes, session tokens, appointment slot computations), cache miss falls through to RDS PostgreSQL
time: 9:30 AM, Thursday
scene: support queue growing since first complaint at 9:23 AM
alert: appointment booking success rate dropped from 99.2% to 61% and falling
stakes: patients retrying failed bookings, compounding load; product team wants rollback decision in 15 minutes
early_signals:
  - 9:23 AM provider office in Portland reports scheduling page loading slowly
  - clinic in Austin reports same, then three more from different states in quick succession
  - by 9:30 AM, seven tickets all reporting slow appointment pages, missing availability slots, inability to book
  - on-call Slack channel has 43 unread messages, most asking "was it the deploy?"
  - deploy went out at 7:15 AM -- new caching layer for lab results, pushed by integrations team
investigation_starting_point: platform reliability engineer on call. Support queue growing. Product team pushing for rollback. Database under pressure. Something between the application and its data layer is broken.

## Resolution

root_cause: Redis cache had been growing for months with no tracking of BytesUsedForCache. Single cache.r6g.large node with 13.07 GB maxmemory. maxmemory-policy set to noeviction since initial provisioning 18 months ago, never reviewed. No alarms on cache memory utilization. Memory hit ceiling at approximately 7:30 AM.
mechanism: Redis returned OOM errors on all write commands (SET, HSET, LPUSH). Application Redis client caught exceptions but logged at DEBUG level only -- no WARN, no ERROR, no alert. Cache-aside pattern meant every failed cache write was invisible, every subsequent read became a cache miss. Application fell through to PostgreSQL for every request. Database connection pool (sized at 200) filled within 30 minutes. Query latency went from 5 ms (cached) to 800 ms (database). Under normal traffic plus patient retries, ALB TargetResponseTime climbed to 8.2 seconds.
fix: change maxmemory-policy to allkeys-lru to allow Redis to evict least-recently-used keys. Add CloudWatch alarms on BytesUsedForCache and CacheMisses to prevent the blind spot from recurring.
contributing_factors:
  - deploy at 7:15 AM was coincidental -- added lab result caching, consumed the last 400 MB of Redis memory approximately 2 hours faster than natural growth trajectory
  - underlying problem (noeviction policy, no memory monitoring, single node with no scaling plan) had been building for weeks
  - rolling back the deploy would have delayed symptoms by hours, not prevented them
  - no automated validation of cache memory capacity after deploys
  - Redis OOM errors logged at DEBUG level, invisible to operational monitoring
