---
tags:
  - type/simulation
  - service/elb
  - service/auto-scaling
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# The Sale That Started Too Fast

## Opening

company: Vellora
industry: direct-to-consumer fashion, Series A startup, 22 engineers
product: limited-edition streetwear collaborations, online storefront
scale: 180,000 registered customers, $1.8M monthly gross merchandise volume
time: 12:00 AM, Wednesday, March 25th
scene: midnight flash sale drop, partnership with a streetwear designer for a limited run of 500 pieces
alert: "CRITICAL: Vellora storefront -- ALB returning 503 errors, checkout error rate climbing"
stakes: 500 limited-edition pieces, collaboration announced on Instagram two weeks prior, email blast sent at 11:45 PM, countdown timer on homepage reached zero at midnight
early_signals:
  - traffic jumped from 200 requests/second to 2,400 requests/second in 45 seconds (12x normal load)
  - add-to-cart buttons spinning indefinitely, checkout pages returning 504 errors
  - CloudWatch dashboard went from green to red in a single refresh cycle
  - ALB returning 503 errors, TargetResponseTime climbed from 150ms to 28 seconds
  - customers refreshing pages, increasing load further
  - Auto Scaling group had two t3.large instances behind the ALB, configured to scale to 20
  - scaling policy watches CPUUtilization at 70% threshold with 300-second cooldown
  - CPU alarm required two consecutive 60-second evaluation periods before firing
  - first scale-out at 12:03 AM, new instance health check passed at 12:07 AM, second scale-out blocked by cooldown until 12:08 AM
  - by 12:10 AM traffic falling because customers left, not because site recovered
investigation_starting_point: paged at 12:01 AM. The 500 limited-edition pieces are still in stock. The customers who wanted them are gone. The ALB is returning 503 errors and the scaling group is not keeping up with demand.

## Resolution

root_cause: the Application Load Balancer was never pre-warmed before a predictable 10x traffic spike, and the Auto Scaling group used only CPUUtilization with a 300-second cooldown -- too slow to respond to a request-count-driven surge
mechanism: ALBs scale internal capacity gradually, roughly 2x over five minutes. A 10x spike in 45 seconds exceeded what the ALB could absorb without prior arrangement, so it returned 503 errors. Simultaneously, the CPU-based scaling alarm required two 60-second evaluation periods to fire, the first new instance took 4 minutes to pass health checks, and the 300-second cooldown blocked further scaling. By the time capacity caught up, customers had abandoned the site.
fix: two-part. (1) Contact AWS Support to pre-warm the ALB before planned events, or use LCU reservation to guarantee a minimum capacity baseline. (2) Replace the CPU-only simple scaling policy with a target tracking policy on ALBRequestCountPerTarget and reduce the cooldown to 60 seconds.
contributing_factors:
  - no pre-warming request to AWS Support despite the sale being scheduled and publicly announced
  - scaling policy used CPUUtilization, a lagging indicator for request-driven workloads
  - 300-second cooldown prevented rapid successive scale-out during a sustained surge
  - only two instances at sale start with no scheduled scaling action to pre-scale capacity
