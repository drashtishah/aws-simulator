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

1. **Pre-warm the ALB for planned events**: Contact AWS Support at least 48 hours before a known traffic event. Provide the expected request rate, the duration, and the average request/response size. AWS will pre-scale the ALB's internal capacity. Alternatively, configure LCU (Load Balancer Capacity Unit) reservation to guarantee a minimum capacity baseline.

2. **Add ALBRequestCountPerTarget scaling policy**: Create a target tracking scaling policy on the `ALBRequestCountPerTarget` metric. This reacts directly to request volume rather than waiting for CPU to saturate:

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

3. **Reduce cooldown periods**: Change the default cooldown from 300 seconds to 60 seconds for scale-out actions. This allows the Auto Scaling group to launch multiple instances in rapid succession during sustained spikes:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name vellora-web-asg \
  --default-cooldown 60
```

4. **Pre-scale before planned events**: For known traffic events, manually set the desired capacity higher before the event begins:

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name vellora-web-asg \
  --desired-capacity 8
```

5. **Add CloudWatch alarms for request-based metrics**: Create alarms on `RequestCount`, `TargetResponseTime`, and `HTTPCode_ELB_5XX_Count` to detect request-driven issues that CPU-based alarms miss.

6. **Consider scheduled scaling**: For recurring events, use scheduled scaling actions to increase capacity before the expected traffic window:

```bash
aws autoscaling put-scheduled-update-group-action \
  --auto-scaling-group-name vellora-web-asg \
  --scheduled-action-name pre-flash-sale \
  --start-time "2026-04-01T23:50:00Z" \
  --min-size 8 \
  --desired-capacity 10
```

## Key Concepts

### ALB Scaling Behavior

Application Load Balancers scale their internal capacity automatically, but gradually. Under normal traffic patterns, an ALB can absorb approximately a 2x increase over a five-minute period. A sudden 10x spike overwhelms the ALB's internal capacity before it can scale. When this happens, the ALB returns 503 errors and the `RejectedConnectionCount` metric spikes.

For planned traffic events, AWS Support can pre-provision the ALB's capacity. This is called "pre-warming" or "pre-scaling." You open a support ticket with the expected peak request rate, the expected duration, the percentage of traffic using HTTPS, and the average request/response size. AWS scales the load balancer nodes in advance. The newer alternative is LCU reservation, which allows you to reserve a minimum number of Load Balancer Capacity Units directly.

### Auto Scaling Metrics: CPU vs Request Count

CPUUtilization is a lagging indicator for request-driven workloads. When a traffic spike hits, requests queue at the load balancer and targets before CPU fully saturates. By the time the CPU alarm evaluates (two periods of 60 seconds each, in this case), the damage is done.

`ALBRequestCountPerTarget` is a leading indicator. It measures the number of requests routed to each target in the group. When request count per target rises, the scaling policy reacts before CPU saturates. This is the recommended metric for web applications behind an ALB.

### Cooldown Periods

The default cooldown in Auto Scaling prevents the group from launching or terminating instances before the previous scaling activity takes effect. A 300-second cooldown is appropriate for workloads with gradual traffic changes. For spiky workloads like flash sales, a 300-second cooldown means only one scale-out event can occur every five minutes. A cooldown of 60 to 120 seconds allows multiple rapid scale-out events while still preventing thrashing. Target tracking policies manage their own cooldowns, but the group-level default cooldown applies to simple scaling policies.

### ELB Pre-Warming

Pre-warming is not self-service. It requires a support ticket to the AWS ELB team. The information needed includes: expected peak requests per second, expected duration, average request size, average response size, percentage of HTTPS traffic, and whether the traffic pattern is sustained or bursty. AWS recommends submitting the request at least 48 hours before the event. LCU reservation is the newer programmatic alternative that does not require a support ticket.

## AWS Documentation Links

- [Application Load Balancer Scaling](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
- [Target Tracking Scaling Policies](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html)
- [ALBRequestCountPerTarget Metric](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html#predefined-metrics)
- [Scaling Cooldowns](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-scaling-cooldowns.html)
- [Scheduled Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-scheduled-scaling.html)
- [ELB Pre-Warming (AWS Knowledge Center)](https://repost.aws/knowledge-center/elb-capacity-troubleshooting)

## Learning Objectives

1. **ALB capacity limits**: Understand that Application Load Balancers scale gradually and cannot absorb sudden 10x traffic spikes without pre-warming via AWS Support or LCU reservation
2. **Scaling metric selection**: Recognize that CPUUtilization is a lagging indicator for request-driven workloads and that ALBRequestCountPerTarget provides faster scaling response
3. **Cooldown tuning**: Understand that a 300-second cooldown is inappropriate for bursty workloads and that shorter cooldowns (60-120 seconds) enable rapid scale-out during sustained spikes
4. **Planned event preparation**: Learn to pre-scale infrastructure before known traffic events using manual desired capacity changes, scheduled scaling, or ALB pre-warming

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures, Domain 3: High-Performing Architectures
- [[catalog]] -- elb, auto-scaling, cloudwatch service entries
