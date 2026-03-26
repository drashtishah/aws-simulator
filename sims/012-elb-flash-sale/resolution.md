---
tags:
  - type/resolution
  - service/elb
  - service/auto-scaling
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# Resolution: The Sale That Started Too Fast

## Root Cause

The Application Load Balancer `vellora-prod-alb` was not pre-warmed before a planned flash sale that drove traffic from ~200 req/s to ~2,400 req/s in 45 seconds. ALBs scale their internal capacity gradually and cannot absorb a 10x spike within one minute without prior arrangement. Simultaneously, the Auto Scaling group `vellora-web-asg` had a single scaling policy based on CPUUtilization > 70% with a 300-second cooldown. CPU is a lagging indicator for request-driven spikes. The alarm did not trigger until 00:02 UTC, the first new instance did not launch until 00:03, and it did not pass health checks until 00:07. The cooldown blocked a second scale-out until 00:08. By that point, customers had abandoned the site. The 500 limited-edition items remained in stock.

## Timeline

| Time (UTC) | Event |
|---|---|
| 2026-03-24 23:45 | Marketing email blast sent to 180,000 registered customers. Instagram stories go live. |
| 2026-03-25 00:00:00 | Countdown reaches zero. Product page goes live. Traffic begins climbing immediately. |
| 2026-03-25 00:00:45 | Request rate reaches ~2,400 req/s. ALB begins returning 503 errors. TargetResponseTime exceeds 28 seconds. |
| 2026-03-25 00:01:00 | RejectedConnectionCount spikes. HTTPCode_ELB_5XX_Count reaches ~2,000/min. Both target instances at 98% CPU. |
| 2026-03-25 00:01:00 | On-call engineer paged. |
| 2026-03-25 00:02:00 | CloudWatch alarm `vellora-cpu-high` transitions to ALARM state (two consecutive periods above 70%). |
| 2026-03-25 00:03:00 | Auto Scaling launches instance `i-0f3a7c9e1b5d82004`. Instance enters Pending state. |
| 2026-03-25 00:07:00 | Third instance passes health check. HealthyHostCount increases to 3. Partial relief but ALB still capacity-constrained. |
| 2026-03-25 00:08:00 | Cooldown expires. Auto Scaling launches fourth instance `i-0f3a7c9e1b5d82005`. |
| 2026-03-25 00:10:00 | Traffic begins declining. Customers have left. Social media complaints peak. |
| 2026-03-25 00:12:00 | Fourth instance passes health check. HealthyHostCount reaches 4. Error rate drops below 10%. |
| 2026-03-25 00:15:00 | Traffic stabilizes at ~300 req/s. Site is responsive. Sale items remain in stock. |

## Correct Remediation

1. **Prepare the load balancer's internal capacity before the next event**. A load balancer (ALB) increases its internal capacity gradually -- it can handle roughly a 2x increase over five minutes, but not a 10x spike in under a minute. For planned events, you need to prepare it in advance. You can contact AWS Support at least 48 hours before the event and tell them the expected traffic rate, duration, and request sizes. AWS will scale the load balancer's internal capacity ahead of time (this is called "pre-warming"). Or you can use LCU reservation (Load Balancer Capacity Units) to set a minimum capacity baseline yourself.

2. **Add a scaling policy that reacts to traffic, not CPU**. The current policy watches CPU usage, which is a lagging indicator -- by the time CPU spikes, requests have already been failing. Instead, create a policy that watches how many requests each server is handling. This metric is called ALBRequestCountPerTarget. A target tracking policy automatically adjusts the number of servers to keep each one below a target value (for example, 300 requests per server):

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name vellora-web-asg \
  --policy-name vellora-request-count-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ALBRequestCountPerTarget",
      "ResourceLabel": "app/vellora-prod-alb/a1b2c3d4e5f60789/targetgroup/vellora-web-tg/9e8d7c6b5a4f3210"
    },
    "TargetValue": 300.0
  }'
```

3. **Shorten the cooldown period**. The cooldown is a waiting period that prevents the system from launching new servers too quickly. The current 300-second (5-minute) cooldown means only one batch of servers can launch every five minutes. For bursty traffic like a flash sale, reduce the cooldown to 60 seconds so the system can launch multiple rounds of servers in quick succession:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name vellora-web-asg \
  --default-cooldown 60
```

4. **Increase the number of running servers before planned events**. For known traffic events, manually increase the desired capacity (the target number of running servers) before the event starts:

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name vellora-web-asg \
  --desired-capacity 8
```

5. **Add monitoring alerts that detect traffic problems, not just CPU**. Create CloudWatch alarms on `RequestCount` (total requests), `TargetResponseTime` (how long servers take to respond), and `HTTPCode_ELB_5XX_Count` (error responses from the load balancer). These metrics catch request-driven overload that CPU alarms miss entirely.

6. **Automate the preparation for recurring events**. If flash sales happen regularly, use scheduled scaling actions to automatically increase capacity before the expected traffic window:

```bash
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name vellora-web-asg \
  --scheduled-action-name pre-flash-sale \
  --start-time "2026-04-01T23:50:00Z" \
  --min-size 8 \
  --desired-capacity 10
```

## Key Concepts

### How a load balancer scales (and when it cannot keep up)

An Application Load Balancer (ALB) automatically grows its internal capacity to match traffic, but it does so gradually. Under normal conditions, it can handle roughly a 2x traffic increase over a five-minute period. A sudden 10x spike, like a flash sale countdown reaching zero, overwhelms the load balancer before it can scale up. When this happens, the load balancer returns 503 errors (meaning "I am too busy to handle this") and the `RejectedConnectionCount` metric spikes -- this metric counts how many connections the load balancer refused.

For planned events, you can ask AWS to increase the load balancer's capacity in advance. This is called "pre-warming" or "pre-scaling." You open a support ticket with details: expected peak requests per second, expected duration, the percentage of traffic using HTTPS, and average request/response sizes. AWS then scales the load balancer's internal infrastructure ahead of time. A newer, self-service alternative is LCU reservation (Load Balancer Capacity Units), which lets you reserve a minimum capacity baseline without opening a support ticket.

### Why CPU is the wrong metric for scaling web servers

CPU usage (CPUUtilization) is a lagging indicator for web traffic. When a traffic spike hits, requests pile up at the load balancer and on the servers before CPU fully maxes out. By the time a CPU-based alarm triggers (in this case, after two consecutive 60-second evaluation periods), the damage is already done -- customers have already seen errors.

A better metric is `ALBRequestCountPerTarget`, which counts how many requests each server behind the load balancer is handling. This reacts directly to traffic changes: when request count per server rises, the scaling policy launches new servers before CPU saturates. This is the recommended metric for web applications behind a load balancer.

### The cooldown period: the pause between scaling actions

After launching new servers, the Auto Scaling group waits for a period called the cooldown before it will launch more. This prevents overreacting to temporary blips. A 300-second (5-minute) cooldown works for workloads with gradual traffic growth. But for spiky workloads like flash sales, a 5-minute cooldown means you can only add servers once every five minutes -- far too slow. A cooldown of 60 to 120 seconds allows the system to launch multiple rounds of servers quickly while still avoiding wasteful over-scaling. Target tracking policies manage their own cooldowns automatically, which is another reason to prefer them over simple scaling policies.

### Pre-warming: preparing the load balancer for a planned traffic event

Pre-warming requires a support ticket to the AWS load balancer team. You provide the expected peak requests per second, expected duration, average request size, average response size, percentage of HTTPS traffic, and whether the traffic pattern is sustained or bursty. AWS recommends submitting the request at least 48 hours before the event. The newer alternative, LCU reservation, lets you set a minimum capacity baseline yourself through the console or CLI without opening a support ticket.

## Other Ways This Could Break

### Health check misconfiguration causes the load balancer to return 502 errors

In this incident, the load balancer itself ran out of internal capacity and returned 503 errors ("I am too busy"). A different failure happens when the load balancer has plenty of capacity but its health check -- the periodic test it sends to each server -- is configured incorrectly. If the health check interval is too aggressive or requires too many consecutive successes, the load balancer might mark healthy servers as unhealthy during normal startup or brief slowdowns. It stops sending traffic to those servers, overloading the remaining ones, which then also fail their health checks. The result is 502 errors ("bad gateway" -- the load balancer tried to forward a request but the server gave a bad response) rather than 503s. The fix is to set health check timing and thresholds based on how long your application actually takes to start, and to use a dedicated /health URL that checks downstream dependencies like the database.

### The server group reaches its maximum size and stops adding servers

In this sim, the Auto Scaling group (the collection of servers that grows and shrinks automatically) never hit its ceiling of 20 servers because traffic dropped before scaling caught up. But if the flash sale had generated sustained traffic for 30 minutes, the group could have scaled to its maximum and stopped there. No more servers would launch regardless of how high traffic climbs. The bottleneck shifts from "how fast can we add servers" to "we are not allowed to add any more." The fix is to set the maximum group size well above your expected peak and to create a CloudWatch alarm that warns when the group is approaching its limit.

### Burstable servers run out of CPU credits under sustained load

T3 servers (a cost-saving instance type) have a "credit" system for CPU power. They accumulate credits during quiet periods and spend them under heavy load. In this sim, the servers were overwhelmed too quickly for credits to matter. But under a slower, sustained traffic increase -- say a 3x rise lasting two hours -- the servers could exhaust their credit balance and be throttled to a fraction of their normal speed. The application would slow down, and if your alarm threshold is set above the throttled CPU level, no alert would fire. The fix is to enable "unlimited mode" for T3 servers in production so they are never throttled, or to use non-burstable instance types (like M5 or C5) for workloads with sustained high CPU.

### Slow connection draining keeps traffic stuck on old servers

When a server is being removed from the load balancer's target group (for example, during a scaling event or deployment), the load balancer waits for existing connections to finish. This waiting period is called the deregistration delay or connection draining timeout, and it defaults to 300 seconds (5 minutes). If unhealthy servers are being replaced but the draining timeout is too long, the load balancer keeps holding connections on the old servers even though new healthy servers are available. Recovery is delayed despite new capacity being ready. The fix is to set the deregistration delay to match how long your application's connections typically last -- 30 to 60 seconds for stateless web applications instead of the 300-second default.

## SOP Best Practices

- Before any planned traffic event, prepare both the load balancer and the server group at least 48 hours in advance. Reserve load balancer capacity (via LCU reservation or a support ticket to AWS) and increase the number of running servers (via scheduled scaling or a manual capacity increase). The load balancer can only double its internal capacity every five minutes on its own -- not fast enough for a sudden spike.
- For web applications behind a load balancer, use scaling policies that watch request count per server (ALBRequestCountPerTarget) instead of CPU usage. CPU is a lagging indicator -- by the time it spikes, requests have already been failing. Request count reacts directly to traffic changes and triggers scaling sooner.
- Set the cooldown period (the pause between scaling actions) based on your traffic pattern. For bursty or spiky traffic, use 60 to 120 seconds. The default 300 seconds is only appropriate for gradual, organic growth. Target tracking and step scaling policies manage their own warmup periods and bypass the default cooldown, which is another reason to prefer them over simple scaling.
- Create CloudWatch alarms on HTTPCode_ELB_5XX_Count (server errors from the load balancer), RejectedConnectionCount (connections the load balancer refused), and TargetResponseTime (how long servers take to respond) -- not just CPU. These metrics detect load balancer capacity problems that CPU alarms miss entirely. A spike in RejectedConnectionCount is the earliest signal that the load balancer itself is overwhelmed.

## Learning Objectives

1. **ALB capacity limits**: Understand that Application Load Balancers scale gradually and cannot absorb sudden 10x traffic spikes without pre-warming via AWS Support or LCU reservation
2. **Scaling metric selection**: Recognize that CPUUtilization is a lagging indicator for request-driven workloads and that ALBRequestCountPerTarget provides faster scaling response
3. **Cooldown tuning**: Understand that a 300-second cooldown is inappropriate for bursty workloads and that shorter cooldowns (60-120 seconds) enable rapid scale-out during sustained spikes
4. **Planned event preparation**: Learn to pre-scale infrastructure before known traffic events using manual desired capacity changes, scheduled scaling, or ALB pre-warming

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures, Domain 3: High-Performing Architectures
- [[catalog]] -- elb, auto-scaling, cloudwatch service entries
