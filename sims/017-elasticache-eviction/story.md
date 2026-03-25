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

The first complaint arrived at 9:23 AM from a provider office in Portland. "The scheduling page takes forever to load." Then another from a clinic in Austin. Then three more in quick succession from different states. By 9:30 AM the support queue had seven tickets, all reporting the same thing: appointment pages loading slowly, availability slots missing, patients unable to book.

Trellis Health is a telehealth appointment platform. 520,000 registered patients. 8,400 appointments scheduled per day across provider offices in twelve states. The platform handles three core functions: provider availability lookups, appointment creation, and patient record retrieval. The architecture is straightforward. An ALB fronts an ECS cluster running the appointment service. The service uses a cache-aside pattern with an ElastiCache Redis node for hot data -- doctor availability schedules refreshed every five minutes, patient session tokens, appointment slot computations. On a cache miss, the service queries the RDS PostgreSQL database directly.

The appointment booking success rate, normally 99.2%, was at 61% and falling. Patients were retrying failed bookings, which compounded the load. A deploy had gone out at 7:15 AM -- a new caching layer for lab results, pushed by the integrations team. The product team was already asking about a rollback. The on-call Slack channel had forty-three unread messages, most of them variations of "was it the deploy?"

You are the platform reliability engineer. It is 9:30 AM on a Thursday morning. The support queue is growing. The product team wants a rollback decision in the next fifteen minutes. The database is under pressure. Something between the application and its data is broken.

## Resolution

The Redis cache had been growing for months. Nobody tracked BytesUsedForCache. The node was a single cache.r6g.large with 13.07 GB of available memory. The maxmemory-policy was set to noeviction -- configured during initial provisioning eighteen months ago and never reviewed. As the patient base grew and more data types were cached, memory usage climbed steadily. No alarms existed for cache memory utilization.

When memory hit the ceiling at approximately 7:30 AM, Redis began returning OOM errors on all write commands -- SET, HSET, LPUSH. The application's Redis client caught the exceptions, but the error handling logged them at DEBUG level only. No WARN, no ERROR, no alert. The cache-aside pattern meant every failed cache write was invisible, and every subsequent read that would have been a cache hit became a cache miss. The application fell through to PostgreSQL for every request. The database connection pool, sized at 200, filled within thirty minutes. Query latency went from 5 milliseconds (cached) to 800 milliseconds (database). Under the combined load of normal traffic plus patient retries, ALB TargetResponseTime climbed to 8.2 seconds.

The deploy at 7:15 AM was coincidental. It added lab result caching, which consumed the last 400 MB of available Redis memory approximately two hours faster than the natural growth trajectory would have. The underlying problem -- noeviction policy, no memory monitoring, a single node with no scaling plan -- had been building for weeks. The deploy accelerated the timeline but did not cause the failure. Rolling it back would have delayed the symptoms by hours, not prevented them.
