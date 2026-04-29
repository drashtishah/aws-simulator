---
tags:
  - type/simulation
  - service/cloudfront
  - service/s3
  - service/lambda
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# The Premiere That Bent the Cache

## Opening

- company: PrismStream
- industry: Video streaming
- product: Subscription on-demand video, 38M subscribers in 190 countries
- scale: 410 engineers, 12 PB of segment storage, peak 9 Tbps egress
- time: Friday 21:04 PT, 4 minutes after global premiere of The Glasshouse
- scene: On-call CDN engineer, dashboards open, CMO is in a watch party
- alert: "prismstream-cdn: 5xx ratio 7.2% on dist EDFDVBD6EXAMPLE (threshold 0.5%)"
- stakes: 1,840 viewer support tickets in 6 minutes; press already noticing; the trailer ran during last weekend's championship game; subscriber churn modeling shows 3.2% extra churn for any premiere outage over 15 minutes
- early_signals:
  - The 5xx ratio applies only to The Glasshouse content ID; every other title is at baseline 0.04%
  - S3 origin bucket prismstream-segments-prod is returning 503 SlowDown at 4,100 per minute
  - CacheHitRate metric for The Glasshouse path is at 9% while site-wide is 96%
  - OriginRequests for the affected cache behavior is up 38x in the last ten minutes
  - Edge POPs in five regions all show the same pattern, not a regional issue
- investigation_starting_point: CloudFront distribution EDFDVBD6EXAMPLE is healthy. Origin shield is enabled in us-east-1. The S3 origin bucket and IAM are unchanged from yesterday. The premiere's segments were uploaded and pre-warmed yesterday afternoon. Three weeks ago the personalization team added a viewer-request Lambda@Edge function called prismstream-device-tag.

## Resolution

- root_cause: The viewer-request Lambda@Edge function prismstream-device-tag injects an X-PrismStream-DeviceClass header into every request, with seven possible values (ios-iphone, ios-ipad, android-phone, android-tablet, web-desktop, web-mobile, smart-tv-default). The CloudFront cache policy attached to the video-segments cache behavior includes this header in HeadersConfig, so the header is part of the cache key.
- mechanism: For The Glasshouse premiere, every viewer requests the same segment URLs, but each device class produces a distinct cache key. Each edge POP holds seven cache slots per segment. Origin shield in us-east-1 cannot collapse requests because the cache keys arriving from regional edge caches do not match. With 38M concurrent viewers split across 7 device classes, origin shield makes 7x as many origin fetches as it would with a clean cache key. Origin S3 partition for the prismstream-segments-prod/the-glasshouse/ prefix exceeds 5,500 GET per second and starts returning 503 SlowDown. The 503s propagate back to viewers as 5xx.
- fix: Remove X-PrismStream-DeviceClass from the cache policy's HeadersConfig and put it in an origin request policy instead. The header still reaches origin but no longer fragments the cache key. CloudFront propagates the cache policy change in 4 minutes; CacheHitRate climbs to 94% within 6 minutes; origin S3 503s drop to zero; viewer 5xx ratio returns to baseline.
- contributing_factors:
  - The personalization team added the Lambda@Edge function and updated the cache policy in the same change without a CDN review
  - There is no alarm on CacheHitRate per content ID; only on the distribution-wide rolling average, which masks per-show drops
  - The premiere segments were pre-warmed against the old cache key, so the first 4 minutes of viewing was guaranteed to be cache-cold for the new keys
  - Origin shield was enabled but provided no collapsing benefit because the cache keys did not match across edge POPs
  - The cache policy change had been live for three weeks but only bit during a high-concurrency event when origin shield's collapsing was load-bearing
