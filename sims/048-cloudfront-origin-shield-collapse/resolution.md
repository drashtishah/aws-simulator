---
tags:
  - type/resolution
  - service/cloudfront
  - service/s3
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# Resolution: The Premiere That Bent the Cache

## Root Cause

CloudFront's cache key for the video-segments cache behavior includes a request header called X-PrismStream-DeviceClass. Three weeks ago the personalization team added a viewer-request Lambda@Edge function (prismstream-device-tag) that parses the User-Agent and injects this header with one of seven values. Because the header is in the cache key, every edge POP keeps seven separate cache slots per segment, and origin shield cannot collapse requests across regions because the keys arriving from edge POPs do not match.

The change had been live for three weeks before it bit. It bit at the global premiere of The Glasshouse because that was the first cache-cold high-concurrency event since the change. With 38M concurrent viewers distributed across 7 device classes, the seven-fold multiplication of origin requests pushed the prismstream-segments-prod/the-glasshouse/ prefix past S3's per-prefix request rate ceiling, and S3 began returning 503 SlowDown to CloudFront. CloudFront returned 5xx to viewers.

## Timeline

| Time (PT) | Event |
|---|---|
| 3 weeks ago | Personalization team deploys prismstream-device-tag Lambda@Edge on viewer-request and adds X-PrismStream-DeviceClass to cache policy HeadersConfig |
| 21:00:00 | Global premiere of The Glasshouse goes live; subscriber traffic ramps from 12M to 38M concurrent viewers in 60 seconds |
| 21:01:30 | Cache miss volume against prismstream-segments-prod climbs from 8k/min to 280k/min |
| 21:02:45 | S3 begins returning 503 SlowDown for GET requests under the the-glasshouse/ prefix |
| 21:03:14 | Viewers begin seeing 5xx; first PrismStream Cares ticket arrives |
| 21:04:02 | PagerDuty fires distribution 5xx alarm |
| 21:11:30 | On-call engineer pulls per-content-id CacheHitRate, sees 9% for The Glasshouse vs 96% for site-wide |
| 21:14:18 | Engineer inspects cache policy on the video-segments behavior, finds X-PrismStream-DeviceClass in HeadersConfig |
| 21:18:40 | Cache policy updated to remove the header from key; header moved to origin request policy |
| 21:22:55 | CloudFront distribution propagates change to all edge POPs |
| 21:24:00 | CacheHitRate for The Glasshouse climbs through 60% |
| 21:26:30 | CacheHitRate at 94%; S3 503 rate at zero; 5xx ratio at baseline |

## Correct Remediation

1. **Triage**: Pull CacheHitRate from CloudWatch grouped by URL path or content ID. The premiere's segments will be near zero while the rest of the site is normal. This narrows the problem from "the CDN is broken" to "one content's cache is fragmented."
2. **Inspect the cache policy**: A cache policy decides what becomes part of the cache key. Find the cache policy attached to the affected cache behavior. Look at HeadersConfig (which headers are in the key), QueryStringsConfig (which query strings), and CookiesConfig (which cookies). Anything in there that varies per viewer fragments the cache.
3. **Trace the header**: If a header in the key takes many distinct values, find what sets it. Lambda@Edge functions on the viewer-request event run before the cache check and can rewrite headers. Check the distribution's cache behaviors for any function associations on viewer-request, and read the function code.
4. **Remove the header from the cache key**: Edit the cache policy and remove the offending header from HeadersConfig. The Lambda@Edge function can keep running and the header still reaches origin if you put it in an origin request policy. CloudFront propagates cache policy changes in a few minutes.
5. **Verify the fix**: Watch CacheHitRate climb. Watch OriginRequests fall. Watch S3 503 rate drop to zero. Confirm 5xx ratio returns to baseline.
6. **Add monitoring so this never silently degrades again**: Add a CloudWatch alarm on CacheHitRate per content ID, not just per distribution. A drop from 95% to 60% is a five-minute warning before 5xx start landing. Pair the alarm with OriginRequests so you can distinguish cache miss storms from genuine origin failures.

## Key Concepts

### CloudFront's cache hierarchy

CloudFront does not have one cache. It has a tree. At the bottom are 600+ edge locations (POPs) where viewer requests land. Above each cluster of edge POPs is a regional edge cache (REC), a larger and longer-lived cache. Above all RECs is an optional layer called origin shield, which is a single REC in a region you pick that all RECs route through. Above origin shield is your origin.

A request flows up the tree on cache miss. If origin shield is enabled and a viewer in Tokyo and a viewer in Frankfurt request the same object at the same time, both edge POPs miss locally, both RECs miss, both RECs ask origin shield, origin shield collapses the two requests into one origin fetch, returns the answer, and both RECs cache it. Without origin shield, both RECs would each hit origin.

### Cache key and request collapsing

The cache key is the unique identifier CloudFront uses to look up an object. By default it is the distribution domain plus the URL path. You can extend it via a cache policy to include selected headers, query strings, or cookies. Two requests with the same cache key are the same object as far as the cache is concerned. Two requests with different cache keys are different objects, kept in different cache slots, even if the URL is identical.

Request collapsing happens at every layer of the hierarchy: when N concurrent requests arrive for the same cache key and the cache is empty, only one of them goes upstream. The other N-1 wait for the answer. This is what keeps origin from being trampled when popular content goes cache-cold.

The catch: collapsing only works for requests with the **same cache key**. If a header that varies per viewer is in the cache key, the cache thinks every viewer is asking for a different object, and there is nothing to collapse.

### Lambda@Edge event types and the cache key

Lambda@Edge runs on four event types in the request lifecycle:

- viewer-request: runs at the edge POP, before the cache lookup. Can change headers, URL, and method, all of which affect the cache key.
- origin-request: runs at the regional edge cache (or origin shield), only on cache miss, before the trip to origin. Changes here do not affect the cache key.
- origin-response: runs at the regional edge cache after origin returns. Changes here affect what gets cached.
- viewer-response: runs at the edge POP just before the response is sent to the viewer. Does not affect the cache.

If you want per-viewer logic that does not fragment the cache, do it in viewer-response (after cache lookup) or origin-request (only runs on miss). Putting per-viewer logic in viewer-request is exactly how this incident happened.

### Cache key fragmentation as a failure mode

Take a 38M-concurrent-viewer event. With a clean cache key, origin shield collapses all 38M segment requests into roughly one fetch per segment per region. Origin sees a few thousand requests per minute. With a header that takes seven values in the cache key, origin shield only collapses requests with matching values, so origin sees seven times more fetches per segment. For a single hot prefix, this is enough to exceed S3's per-prefix request rate ceiling (5,500 GET per second) and start returning 503 SlowDown.

The pattern is treacherous because it can sit dormant for weeks. Normal traffic, even high traffic, may not push the collapsing beyond the per-prefix ceiling. It only manifests during a content-launch concurrency burst, which is exactly when you need the CDN to be working.

## Other Ways This Could Break

### Marketing query parameters fragmenting the cache key

The cache key includes UTM tracking parameters or session IDs. Same effect: every visit looks unique. Common when a default cache policy forwards all query strings.
**Prevention:** Use the CloudFront-managed CachingOptimized policy that forwards no query strings to the cache key. Forward analytics parameters in the origin request policy so they reach origin without fragmenting cache.

### Origin shield not enabled

Each regional edge cache hits origin independently on a miss. Even with a clean cache key, eleven regions can fan out to eleven origin fetches per object. Different from this incident, but produces similar dogpile patterns at content launch.
**Prevention:** Enable origin shield in the region geographically closest to your origin (within 200 ms). The cost is a small fraction of the origin egress savings for high-traffic content.

### Cache TTL too short for traffic burst

Hit rate is fine for one minute and then crashes when objects expire mid-burst. Each expiration triggers a fresh cache miss storm. Different from key fragmentation but produces similar 5xx spikes.
**Prevention:** For immutable content like HLS segments, use long min/max TTLs (hours or days) and rely on URL versioning when content changes. Stale-while-revalidate at the cache layer can help during expiration.

### S3 prefix request rate ceiling

S3 returns 503 SlowDown for one prefix while other prefixes are fine. Looks like an origin problem but is actually key concentration.
**Prevention:** Spread object keys across many prefixes. S3 supports 5,500 GET per second per partitioned prefix. Hash a portion of the segment ID into the prefix to distribute load.

## SOP Best Practices

- Treat the cache key as a contract. Every header, query string, or cookie in it multiplies the cache footprint and slot count. Use the smallest set that gives correct routing. Move device, language, and personalization signals to origin-request when possible so origin still receives them without fragmenting cache.
- Enable origin shield for any high-traffic origin. Pick a shield region within 200 ms of origin. Without origin shield, every regional edge cache that misses talks to origin directly, which fans out cache miss storms during cold starts and content launches.
- Alarm on CacheHitRate per content ID, not just per distribution. A drop from 95% to 60% on one show is a five-minute warning before 5xx start landing. Pair the alarm with OriginRequests so you can distinguish cache miss storms from genuine origin failures.
- Test Lambda@Edge changes against a canary distribution before promoting to production. Lambda@Edge changes propagate to every edge globally and are hard to roll back fast under high traffic. A canary lets you watch CacheHitRate and OriginRequests for the change before exposing all viewers.

## Learning Objectives

1. **Cache hierarchy mental model**: Articulate the tree (edge POP, regional edge cache, origin shield, origin) and what each layer does.
2. **Cache key as a contract**: Identify what extends the cache key (cache policy HeadersConfig, QueryStringsConfig, CookiesConfig) and what does not (origin request policy).
3. **Lambda@Edge event placement**: Know which event types affect the cache key and pick origin-request or viewer-response when adding per-viewer logic.
4. **Operational signals for CDN health**: Use CacheHitRate per content path and OriginRequests as the primary signals; reach for distribution 5xx rate as a downstream consequence.

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
