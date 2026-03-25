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

The midnight drop was scheduled for three weeks. Vellora is a direct-to-consumer fashion company. 180,000 registered customers. $1.8 million in monthly gross merchandise volume. They partnered with a streetwear designer for a limited run of 500 pieces. The collaboration was announced on Instagram two weeks before the sale. The marketing team sent an email blast at 11:45 PM on Tuesday, March 24th. Instagram stories went live. A countdown timer on the homepage ticked toward midnight.

At 12:00:00 AM on Wednesday, March 25th, the countdown reached zero. The product page went live. In the next forty-five seconds, traffic went from approximately 200 requests per second to 2,400 requests per second. Twelve times the normal load. The infrastructure had two t3.large instances behind an Application Load Balancer. The Auto Scaling group was configured to scale to twenty instances. It did not matter.

The site did not crash in a dramatic way. It stopped responding. Add-to-cart buttons spun indefinitely. Checkout pages returned 504 errors. The CloudWatch dashboard, which had been green all evening, turned red in a single refresh cycle. The ALB began returning 503 errors. The TargetResponseTime metric, which normally read 150 milliseconds, climbed past 28 seconds. Customers refreshed. The load increased. The ALB's own internal capacity, which scales gradually under normal conditions, could not absorb a tenfold spike in under a minute.

The Auto Scaling group's only scaling policy watches CPUUtilization. The threshold is 70%. The cooldown is 300 seconds. CPU crossed 70% within the first minute, but the alarm required two consecutive evaluation periods of 60 seconds each. The first scale-out activity began at 12:03 AM. The new instance did not pass its health check until 12:07 AM. The second scale-out was blocked by the cooldown period until 12:08 AM. By 12:10 AM, traffic had already begun to fall. Not because the site recovered. Because customers left.

You are the on-call engineer. You were paged at 12:01 AM. The 500 limited-edition pieces are still in stock. The customers who wanted them are gone.

## Resolution

The Application Load Balancer was never pre-warmed. ALBs scale their internal capacity gradually. Under normal traffic patterns, an ALB can handle roughly a 2x increase over five minutes. A 10x spike in under sixty seconds exceeds what the ALB can absorb without prior arrangement. AWS Support can pre-provision ALB capacity through a support ticket when a traffic event is planned in advance. The newer alternative is Load Balancer Capacity Unit reservation, which guarantees a minimum capacity baseline.

The Auto Scaling group had a single scaling policy based on CPUUtilization with a 300-second cooldown. CPU is a lagging indicator for request-driven workloads. By the time CPU crosses the threshold and the alarm evaluates, requests have already been queuing for minutes. The correct metric for this workload is ALBRequestCountPerTarget, which tracks the number of requests per target directly. A target tracking policy on this metric would have triggered scaling within the first evaluation period. The cooldown should have been reduced to 60 or 120 seconds to allow rapid successive scale-out events during a sustained surge.

The combination of an un-pre-warmed ALB and a slow-reacting Auto Scaling policy meant the infrastructure could not respond to a traffic event that was entirely predictable. The sale was scheduled. The email blast was sent. The countdown was public. The traffic spike was not a surprise. The infrastructure treated it as one.
