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

1. **Increase deregistration delay**:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/ridgewell-web-tg/abcdef1234567890 \
  --attributes Key=deregistration_delay.timeout_seconds,Value=300
```

2. **Reduce healthy threshold**: Change the health check healthy threshold from 5 to 2, reducing the time to healthy from 150 seconds to 60 seconds:

```bash
aws elbv2 modify-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/ridgewell-web-tg/abcdef1234567890 \
  --healthy-threshold-count 2
```

3. **Reduce deployment batch size**: Update the CodeDeploy deployment configuration to replace 25% of instances per batch instead of 50%, ensuring at least 3 of 4 targets remain healthy at all times.

4. **Schedule deployments outside peak hours**: Establish a deployment window policy prohibiting production deployments between 5 AM and 11 AM when dispatchers are actively planning routes.

5. **Add a CloudWatch alarm for HealthyHostCount**:

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

### Connection Draining (Deregistration Delay)

When a target is deregistered from an ALB target group, the load balancer stops sending new requests to that target but allows existing in-flight requests to complete. The deregistration delay defines how long the target remains in the `draining` state before being fully removed. The default is 300 seconds. Setting it too low (30 seconds in this case) means the target is removed before replacement targets are ready, creating a capacity gap during rolling deployments.

The critical relationship: deregistration delay must be greater than the time new targets need to pass health checks. If old targets drain in 30 seconds but new targets need 150 seconds to become healthy, there is a 120-second window where those targets are neither serving traffic nor replaced.

### ALB Fail-Open Behavior

When all targets in a target group are unhealthy, the ALB does not return 503 Service Unavailable. Instead, it enters fail-open mode and routes requests to all registered targets regardless of their health status. This is a deliberate design decision -- AWS assumes that routing to potentially unhealthy targets is preferable to dropping all traffic. In practice, if the targets are still initializing, they return 502 Bad Gateway or connection refused errors. The ALB translates connection failures to 502 errors.

This behavior means that HealthyHostCount reaching zero does not stop traffic. It makes traffic worse.

### Health Check Tuning

ALB health check parameters interact with deployment safety:

- **Interval**: Time between health check probes (default 30 seconds)
- **Healthy threshold**: Number of consecutive successful checks required (default 5)
- **Time to healthy**: interval x healthy_threshold (e.g., 30s x 5 = 150s)
- **Unhealthy threshold**: Number of consecutive failed checks to mark unhealthy (default 2)

Reducing the healthy threshold from 5 to 2 changes the time to healthy from 150 seconds to 60 seconds. This must be balanced against the risk of prematurely marking a target as healthy before the application is fully warmed up.

## Other Ways This Could Break

### Health Check Passes Before the Application Is Ready

The health check endpoint returns 200 before the application has finished loading caches, establishing database connections, or completing other initialization work. The ALB marks the target as healthy and sends traffic to it. The target cannot serve requests correctly even though it passes health checks. This differs from the root cause here because the timing gap is not between deregistration and health checks -- it is between the health check passing and the application actually being ready. Prevention: implement a readiness check that verifies all downstream dependencies before the health endpoint returns 200.

### Auto Scaling Group Terminates Instances Still Initializing

The ASG uses ELB health checks but the health check grace period is shorter than the time the application needs to start. New instances launched during a deployment fail their first ELB health check, the ASG marks them as unhealthy and terminates them, then launches replacements that also fail. This creates a loop of launch-terminate-launch. The difference from this sim is that the ASG itself is killing instances rather than a capacity gap from deregistration timing. Prevention: set the health check grace period to at least the time-to-healthy plus the application startup time and monitor scaling activities for repeated terminations.

### Slow Start Mode Disabled Overloads New Targets

New targets pass health checks and immediately receive an equal share of all traffic. If the application needs warm-up time (cache priming, JIT compilation), the sudden load spike causes latency increases or errors even though the target is technically healthy. This differs from the root cause because there is no zero-healthy-host event -- the problem is traffic volume, not traffic absence. Prevention: enable slow start mode on the target group with a duration matching the application warm-up time.

### Cross-Zone Load Balancing Disabled During Partial Deployment

The deployment removes targets in one availability zone while the other zone remains healthy. Without cross-zone load balancing, the ALB node in the depleted zone has no healthy targets and enters fail-open for that zone only, while the other zone is overloaded. This differs because the failure is zone-specific rather than global. Prevention: enable cross-zone load balancing on the ALB so each node can route to healthy targets in any zone.

## SOP Best Practices

- Always verify that the deregistration delay exceeds the health check time-to-healthy (interval multiplied by healthy threshold) before running any rolling deployment
- Add a CloudWatch alarm on HealthyHostCount for every production target group -- alert when the count drops below the minimum required for safe operation
- Use deployment batch sizes small enough that the remaining healthy targets can absorb the full traffic load while replacements initialize
- Schedule production deployments outside peak traffic windows and document the policy in the team runbook

## Learning Objectives

1. **Deregistration delay math**: Understand that deregistration delay must exceed the time required for replacement targets to pass health checks during rolling deployments, or a capacity gap will occur
2. **ALB fail-open behavior**: Recognize that when HealthyHostCount reaches zero, the ALB routes traffic to all unhealthy targets rather than returning 503, producing 502 errors from unready backends
3. **Deployment risk factors**: Identify how batch size, deployment timing, health check configuration, and deregistration delay interact to determine whether a rolling deployment is safe
4. **Health check threshold tuning**: Balance the healthy threshold between safety (ensuring the application is fully ready) and deployment speed (minimizing the time targets spend in the `initial` state)

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[catalog]] -- elb, auto-scaling, ec2, cloudwatch service entries
