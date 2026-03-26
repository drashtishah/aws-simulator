---
tags:
  - type/resolution
  - service/elb
  - service/auto-scaling
  - service/ec2
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# Resolution: The Targets That Disappeared

## Root Cause

A rolling deployment via CodeDeploy deregistered EC2 instances from target group `ridgewell-web-tg` with a deregistration delay of 30 seconds. Replacement instances required 150 seconds to pass ALB health checks (30-second interval, healthy threshold of 5). The deployment batch size was 50% (2 of 4 instances), so each batch left a gap where old targets had drained but new targets were not yet healthy. When both batches overlapped in this gap, HealthyHostCount dropped to zero. The ALB entered fail-open mode, routing traffic to unhealthy targets that returned 502 and 503 errors. The deployment was triggered at 6:15 AM during peak dispatcher hours, maximizing customer impact.

## Timeline

| Time | Event |
|---|---|
| 2026-03-26 06:15:00 | CodeDeploy begins rolling deployment. Batch 1: instances `i-0a1b2c3d4e5f6001` and `i-0a1b2c3d4e5f6002` marked for replacement. |
| 2026-03-26 06:15:05 | Two old instances enter `draining` state. Deregistration delay: 30 seconds. |
| 2026-03-26 06:15:10 | Two new instances `i-0a1b2c3d4e5f6003` and `i-0a1b2c3d4e5f6004` launch. Enter `initial` state in target group. |
| 2026-03-26 06:15:35 | Batch 1 old instances finish draining. Removed from target group. HealthyHostCount: 2 (batch 2 old instances still healthy). New instances at health check 1 of 5. |
| 2026-03-26 06:16:30 | First support ticket. Dispatcher in Memphis reports 502 Bad Gateway. |
| 2026-03-26 06:16:45 | CodeDeploy begins batch 2. Instances `i-0a1b2c3d4e5f6005` and `i-0a1b2c3d4e5f6006` (remaining old instances) enter `draining` state. |
| 2026-03-26 06:17:15 | Batch 2 old instances finish draining. HealthyHostCount: 0. ALB enters fail-open mode. All traffic routed to unhealthy targets. |
| 2026-03-26 06:17:15 | HTTPCode_ELB_5XX_Count spikes. 502 and 503 errors across all requests. |
| 2026-03-26 06:17:30 | Two new instances `i-0a1b2c3d4e5f6007` and `i-0a1b2c3d4e5f6008` launch for batch 2. Enter `initial` state. |
| 2026-03-26 06:18:00 | On-call engineer paged. Fourteen support tickets open. |
| 2026-03-26 06:17:40 | Batch 1 new instances pass health check 3 of 5. Still unhealthy. |
| 2026-03-26 06:18:40 | Batch 1 new instances pass health check 4 of 5. Still unhealthy. |
| 2026-03-26 06:19:10 | Batch 1 new instances pass health check 5 of 5. Transition to `healthy`. HealthyHostCount: 2. Error rate begins dropping. |
| 2026-03-26 06:21:40 | Batch 2 new instances pass health check 5 of 5. HealthyHostCount: 4. Error rate returns to zero. |
| 2026-03-26 06:22:00 | All targets healthy. Deployment complete. Total error window: approximately 3 minutes. |

## Correct Remediation

1. **Give old servers more time to keep serving traffic while new ones start up**. The deregistration delay controls how long the load balancer keeps sending in-progress requests to a server that is being removed. It was set to 30 seconds, but new servers need 150 seconds to become ready. Increase it to 300 seconds so old servers stay active long enough for their replacements to pass health checks:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/ridgewell-web-tg/abcdef1234567890 \
  --attributes Key=deregistration_delay.timeout_seconds,Value=300
```

2. **Speed up how quickly new servers are considered ready**. The healthy threshold is the number of consecutive health checks a new server must pass before the load balancer starts sending it traffic. Reducing it from 5 to 2 cuts the time-to-ready from 150 seconds to 60 seconds:

```bash
aws elbv2 modify-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/ridgewell-web-tg/abcdef1234567890 \
  --healthy-threshold-count 2
```

3. **Replace fewer servers at once**. The deployment currently swaps out 50% of servers in each batch (2 of 4). Change it to 25% so only 1 server is replaced at a time, leaving at least 3 healthy servers to handle traffic throughout the deployment.

4. **Deploy outside of peak hours**. Establish a team rule: no production deployments between 5 AM and 11 AM, when dispatchers are actively planning routes and any disruption hits customers directly.

5. **Add a monitoring alert for healthy server count**. Create a CloudWatch alarm that fires when the number of healthy servers (HealthyHostCount) drops below 2. This gives the team an early warning before capacity disappears entirely:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name ridgewell-prod-healthy-hosts-low \
  --namespace AWS/ApplicationELB \
  --metric-name HealthyHostCount \
  --dimensions Name=TargetGroup,Value=targetgroup/ridgewell-web-tg/abcdef1234567890 Name=LoadBalancer,Value=app/ridgewell-prod-alb/1234567890abcdef \
  --statistic Minimum \
  --period 60 \
  --threshold 2 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:ridgewell-ops-alerts
```

## Key Concepts

### Connection draining: what happens when a server is removed from the load balancer

When a server is being removed from the load balancer's target group (for example, during a deployment), the load balancer stops sending it new requests but lets any in-progress requests finish. This grace period is called the deregistration delay (also known as connection draining). It controls how long the server stays in a "draining" state before being fully disconnected. The default is 300 seconds.

In this incident, the deregistration delay was set to just 30 seconds. But new replacement servers needed 150 seconds to pass health checks and start receiving traffic. That created a 120-second gap where old servers had already left but new servers were not yet ready. The critical rule: the deregistration delay must be longer than the time new servers need to become ready.

### What the load balancer does when every server is unhealthy (fail-open mode)

When all servers in a target group fail their health checks, you might expect the load balancer to return an error page to every user. Instead, it does something counterintuitive: it enters "fail-open mode" and sends traffic to all servers regardless of health status. AWS designed it this way because routing to potentially unhealthy servers is considered better than dropping all traffic entirely. In practice, if the servers are still starting up, they return 502 Bad Gateway errors or refuse connections.

This means that HealthyHostCount dropping to zero does not stop traffic -- it makes the user experience worse because every request goes to an unready server.

### How health check settings affect deployment safety

The load balancer periodically sends a test request (a health check) to each server to see if it is ready to handle traffic. Several settings interact to determine how quickly a new server is considered ready:

- **Interval**: how often the health check runs (default: every 30 seconds)
- **Healthy threshold**: how many consecutive checks must pass (default: 5)
- **Time to ready**: interval multiplied by healthy threshold (for example, 30 seconds times 5 checks equals 150 seconds)
- **Unhealthy threshold**: how many consecutive failures mark a server as unhealthy (default: 2)

Reducing the healthy threshold from 5 to 2 shortens the time-to-ready from 150 seconds to 60 seconds. But you need to be careful: setting it too low risks marking a server as ready before your application has finished loading data or connecting to its database.

## Other Ways This Could Break

### Health check passes before the application is actually ready

The health check URL returns a success response (200) before the application has finished loading its data, connecting to the database, or completing other startup work. The load balancer considers the server ready and sends it real traffic, but the server cannot handle requests properly yet. This differs from the main problem in this sim: here the timing gap was between old servers leaving and new servers passing health checks. In this other failure, the gap is between the health check passing and the application being genuinely ready to serve users. Prevention: build a readiness check that verifies all downstream systems (database, caches, configuration) are working before the health URL returns success.

### Auto Scaling group kills new servers before they finish starting

The Auto Scaling group -- which manages the fleet of servers -- uses load balancer health checks to monitor server health. But the health check grace period (the time it waits before checking new servers) is shorter than the time the application needs to start. New servers fail their first health check because they are still booting up. The Auto Scaling group marks them as unhealthy and terminates them, then launches replacements that also get killed. This creates an endless loop of launch-and-terminate. The difference from this sim is that the Auto Scaling group itself is destroying servers, not a timing mismatch in the deployment. Prevention: set the health check grace period to at least the time-to-ready plus the application startup time, and watch the scaling activity log for repeated terminations.

### New servers get overwhelmed by full traffic immediately

New servers pass their health checks and immediately receive the same share of traffic as servers that have been running for hours. If the application needs warm-up time (loading cached data, compiling code on first run), the sudden load causes slowdowns or errors even though the server is technically "healthy." This differs from the main problem because there is no zero-healthy-server event -- the issue is too much traffic hitting a cold server, not too few servers available. Prevention: enable slow start mode on the target group, which gradually ramps traffic to new servers over a set time (typically 30 to 120 seconds) instead of sending the full share all at once.

### Traffic distribution breaks when servers are in different data center zones

The deployment removes servers in one availability zone (a physically separate data center) while the other zone still has healthy servers. If cross-zone load balancing is turned off, the load balancer node in the empty zone has no healthy targets and enters fail-open mode for that zone only, while the other zone gets overloaded. The failure is zone-specific rather than global. Prevention: enable cross-zone load balancing so the load balancer can send traffic to healthy servers in any zone, not just the zone where the request arrived.

## SOP Best Practices

- Before any rolling deployment, do the math: the deregistration delay (how long old servers keep serving) must be longer than the time-to-ready for new servers (health check interval multiplied by healthy threshold). If old servers leave before new ones are ready, there will be a gap with no healthy capacity.
- Add a CloudWatch alarm on HealthyHostCount for every production target group. This metric tracks how many servers the load balancer considers ready. Set the alarm to fire when the count drops below the minimum needed to handle traffic safely. Without this alarm, a zero-healthy-server event goes unnoticed until customers report errors.
- Use deployment batch sizes small enough that the remaining healthy servers can handle all the traffic while replacements start up. Swapping out half the fleet at once (as happened here) is risky. Replacing one quarter at a time is safer.
- Schedule production deployments outside peak traffic hours and write the rule into the team runbook so everyone follows it. Deploying during peak hours maximizes the blast radius of any deployment issue.

## Learning Objectives

1. **Deregistration delay math**: Understand that deregistration delay must exceed the time required for replacement targets to pass health checks during rolling deployments, or a capacity gap will occur
2. **ALB fail-open behavior**: Recognize that when HealthyHostCount reaches zero, the ALB routes traffic to all unhealthy targets rather than returning 503, producing 502 errors from unready backends
3. **Deployment risk factors**: Identify how batch size, deployment timing, health check configuration, and deregistration delay interact to determine whether a rolling deployment is safe
4. **Health check threshold tuning**: Balance the healthy threshold between safety (ensuring the application is fully ready) and deployment speed (minimizing the time targets spend in the `initial` state)

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[catalog]] -- elb, auto-scaling, ec2, cloudwatch service entries
