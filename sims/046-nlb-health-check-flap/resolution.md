---
tags:
  - type/resolution
  - service/elb
  - service/ec2
  - service/auto-scaling
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# Resolution: The Failover That Failed Itself

## Root Cause

The `lumen-edge-asg` Auto Scaling group launches EC2 instances and registers them with `lumen-edge-target-group` immediately upon launch. There is no Auto Scaling lifecycle hook to delay registration. The target group's health check is configured aggressively: `HealthyThresholdCount=2`, `UnhealthyThresholdCount=2`, `Interval=10`, meaning a new target has 20 seconds of grace before being marked unhealthy.

Newly launched instances take approximately 60-90 seconds before `/healthz` returns 200. The bootstrap sequence is: ENI attachment (~5s), VPC route programming (~10s), AMI cloud-init script (~30s), TLS certificate fetch from Secrets Manager (~15s), application warm-up and connection-pool primer (~10-30s). During this entire window, the instance is registered with the target group but failing health checks.

`HealthCheckGracePeriod=120s` on the ASG is set, but this parameter only delays Auto Scaling's decision to terminate an unhealthy instance. It does NOT delay the target group's health-check evaluation. The target group sees the instance as unhealthy from t+20s through t+~75s; the ASG declines to terminate during that window, but the LB layer still treats the instance as "out."

During an Instance Refresh, four instances per Availability Zone are replaced per deploy step. In AZ-1a with 12 total instances, replacing 4 means 4 are simultaneously in the launch-but-not-yet-healthy window. The remaining 8 are healthy at any given moment, but the AZ's HealthyHostCount drops to 8 then briefly to 4 (when the next batch of replacements is mid-launch). When this drops below the implicit AZ-failover threshold, the NLB removes the AZ from its DNS response.

Cross-zone load balancing is disabled on the NLB. This is the AWS default for NLB. When AZ-1a is removed from DNS, all traffic that would have gone there is now sent to AZ-1b, which doubles its load. AZ-1b's instances handle the surge for a few minutes, then start failing health checks themselves under the unexpected concurrent connection volume. AZ-1b also drops below threshold, the AZ DNS failover reverses, and the cycle repeats.

This is the customer-side analogue of the 2025-10-20 AWS US-EAST-1 NLB cascade: NLB health checks alternated between failing and succeeding because new EC2 instances came in service before network state propagated; backend targets were repeatedly removed and re-added to DNS; without a velocity control, automatic AZ DNS failover removed too much capacity in one go.

## Timeline

| Time (UTC) | Event |
|---|---|
| 21:08:00 | Instance Refresh step 2: replace 4 instances in AZ-1a |
| 21:08:30 | New instances launched, registered with target group, /healthz failing |
| 21:08:50 | Target group marks 4 new AZ-1a instances Unhealthy (after 2*10s) |
| 21:08:55 | AZ-1a HealthyHostCount = 4 (below threshold) |
| 21:09:10 | NLB AZ DNS failover: AZ-1a removed from DNS responses |
| 21:09:15 | All traffic shifts to AZ-1b; AZ-1b connection rate doubles |
| 21:09:30 | AZ-1a new instances pass /healthz; HealthyHostCount = 12 in AZ-1a |
| 21:11:00 | PagerDuty INC-20260424-1411 fires (error_count > 1000/min) |
| 21:13:00 | Instance Refresh step 3: replace 4 instances in AZ-1b |
| 21:13:20 | AZ-1b HealthyHostCount drops to 4 (4 new + 8 strained from doubled load) |
| 21:13:35 | NLB AZ DNS failover: AZ-1b removed; traffic flips back to AZ-1a |
| 21:14:00 | Cycle continues; pattern oscillates every ~5 minutes |
| 21:23:11 | SRE cancels Instance Refresh |
| 21:25:00 | Lifecycle hook + cross-zone LB + thresholds adjusted |
| 21:32:00 | Instance Refresh resumed; no flap in subsequent deploy steps |
| 21:58:00 | Refresh complete; stable HealthyHostCount in both AZs |

## Correct Remediation

1. **Confirm the oscillation pattern.** Look at the target group's HealthyHostCount per Availability Zone in CloudWatch over the last hour. If the metric oscillates between AZ-1a and AZ-1b on a regular interval, you have flap, not steady-state failure.
2. **Find what is changing on that interval.** Check Auto Scaling activity log for ongoing Instance Refresh, ScheduledScaling actions, or external automations that touch the target group. The flap interval usually matches a deploy or scaling step interval.
3. **Time the warm-up.** Launch a single instance manually (`aws ec2 run-instances` or one-off ASG scale up). Time from `RunInstances` to first 200 from `/healthz`. Compare to `HealthyThresholdCount * Interval` (the load-balancer's grace window). If warm-up exceeds the window, the instance will register, fail, and be marked unhealthy before it ever serves a real request.
4. **Stop the bleeding.** Cancel the Instance Refresh: `aws autoscaling cancel-instance-refresh --auto-scaling-group-name lumen-edge-asg`. The current healthy fleet stabilizes; no new instances enter the launch window.
5. **Add an Auto Scaling lifecycle hook on launch.** This is the canonical fix. The hook holds the instance in `Pending:Wait` state and prevents target-group registration until the bootstrap script signals ready.
   ```
   aws autoscaling put-lifecycle-hook \
     --lifecycle-hook-name lumen-edge-launch-warmup \
     --auto-scaling-group-name lumen-edge-asg \
     --lifecycle-transition autoscaling:EC2_INSTANCE_LAUNCHING \
     --heartbeat-timeout 180 \
     --default-result ABANDON
   ```
6. **Update the bootstrap to complete the hook.** The instance's user-data script runs the bootstrap (cert fetch, app start, pool prime), polls local `/healthz` until it returns 200 three times consecutively, then calls:
   ```
   aws autoscaling complete-lifecycle-action \
     --lifecycle-action-result CONTINUE \
     --instance-id $(curl -s http://169.254.169.254/latest/meta-data/instance-id) \
     --lifecycle-hook-name lumen-edge-launch-warmup \
     --auto-scaling-group-name lumen-edge-asg
   ```
   Only after this call does the ASG move the instance to `InService` and register it with the target group.
7. **Increase target-group health-check tolerances.** A second layer of safety even if the lifecycle hook misses something.
   ```
   aws elbv2 modify-target-group \
     --target-group-arn ... \
     --health-check-interval-seconds 15 \
     --healthy-threshold-count 3 \
     --unhealthy-threshold-count 3
   ```
8. **Enable cross-zone load balancing.** Without this, a single AZ losing capacity redirects all of its share to the other AZ. With it, both AZ load-balancer nodes can forward to any AZ's targets.
   ```
   aws elbv2 modify-load-balancer-attributes \
     --load-balancer-arn ... \
     --attributes Key=load_balancing.cross_zone.enabled,Value=true
   ```
9. **Resume the deploy.** Re-run the Instance Refresh. With the lifecycle hook in place, instances enter the target group only when truly ready, so HealthyHostCount per AZ stays stable throughout.

## Key Concepts

### HealthCheckGracePeriod is not what most people think it is

`HealthCheckGracePeriod` on the ASG is widely assumed to be "the time during which the load balancer ignores failed health checks." It is not.

What it actually does: during the grace period, the **Auto Scaling group** does not act on a failed ELB health check (i.e., does not terminate the instance). The target group itself, and the load balancer's traffic-routing decisions, ignore the grace period entirely. From the LB's perspective, an instance that fails health checks is unhealthy and does not receive traffic, regardless of grace period.

The right place to gate target-group membership during warm-up is an Auto Scaling lifecycle hook (`Launching:Wait`), not the grace period. The lifecycle hook holds the instance out of the target group; the grace period only protects against premature termination.

### NLB cross-zone load balancing default and its consequence

NLB cross-zone load balancing is **disabled by default**. This is intentional from AWS's design: each AZ's load balancer node forwards only to targets in the same AZ, which preserves source IPs and minimizes cross-AZ data transfer cost.

The consequence: if an AZ has 0 healthy targets, its node has nowhere to forward and is removed from DNS via AZ DNS failover. Clients then resolve only to the other AZs. If only one other AZ exists (a 2-AZ deployment is common for cost reasons), all traffic shifts there, often doubling its load.

Enabling cross-zone load balancing changes this: when AZ-1a has 0 healthy targets, AZ-1a's node can still forward to AZ-1b's targets. Load distribution becomes uniform across all healthy targets regardless of AZ. The cost is data transfer between AZs, which is small for HTTP/TCP traffic but can be material for high-bandwidth UDP video.

### Instance Refresh velocity controls

Instance Refresh has two main parameters that control velocity:

- `MinHealthyPercentage`: the minimum percentage of the desired capacity that must remain in service during the refresh. Default is 90. At 66 (as in this scenario), the ASG will allow up to 34% of instances to be unhealthy or being-replaced at once.
- `CheckpointPercentages` and `CheckpointDelay`: optional pause points to verify health between batches.

For production with a known warm-up time, `MinHealthyPercentage` should be high enough that the count of instances in the launch window does not push any AZ below the threshold for AZ DNS failover. Combined with a lifecycle hook (which removes the warm-up window from the load balancer's view entirely), this is the safest configuration.

The 2025 NLB cascade post-mortem made the broader velocity-control lesson explicit at AWS scale: AWS now has a velocity control on NLB AZ failover that limits the capacity removed in any single decision. The customer-side equivalent is the lifecycle hook plus a high `MinHealthyPercentage`.

## Other Ways This Could Break

### Instance Refresh terminates too many instances at once
The ASG terminates instances faster than replacements can be ready. Old fleet shrinks before new fleet is in service; HealthyHostCount drops cleanly without flap. Symptom is a single drop, not oscillation.
**Prevention:** `MinHealthyPercentage` of at least 90 for production. Combine with a lifecycle hook so replacements only count once they are truly serving.

### Application memory leak causes targets to fail after hours of traffic
Failures are correlated with elapsed time on a target, not with deploy events. UnHealthyHostCount climbs steadily; flap is irregular.
**Prevention:** Application-level instrumentation (memory metric, GC pause time); roll instances on a schedule; fix the leak.

### Subnet route table missing a default route
All targets in the affected subnet are permanently unhealthy from the moment they are launched. Persistent failure, not flap.
**Prevention:** VPC Reachability Analyzer to confirm NLB-to-target reachability before introducing a new subnet. Run as part of CI for any VPC change.

## SOP Best Practices

- **Use Auto Scaling lifecycle hooks (Launching:Wait) to gate target-group registration on the instance passing a local readiness check.** This is the canonical solution for warm-up. `HealthCheckGracePeriod` alone does not address the load-balancer view.
- **Calibrate target-group health-check thresholds against actual cold-start time.** Steady-state liveness needs a tight threshold; warm-up needs a generous one. The lifecycle hook handles warm-up, freeing the threshold to be tight for liveness.
- **Enable cross-zone load balancing on NLB unless there is a specific reason not to.** The default-disabled state amplifies single-AZ failures into bilateral fleet collapse. The cost is cross-AZ data transfer, which is usually negligible.
- **Set MinHealthyPercentage to at least 90 for production Instance Refresh.** Combined with the lifecycle hook, this ensures rolling deploys never reduce serving capacity below the configured floor. The 2025 NLB cascade post-mortem made the velocity-control lesson explicit; the customer-side equivalent is MinHealthyPercentage and lifecycle hooks.

## Learning Objectives

1. **Lifecycle hooks vs grace period**: Know which one delays target-group registration (lifecycle hook) and which one only delays ASG-initiated termination (grace period).
2. **NLB cross-zone behavior**: Understand the default-disabled state and how it amplifies single-AZ failures.
3. **AZ DNS failover semantics**: Know that NLB removes an AZ from DNS when its healthy count is too low and that this redirects all traffic to the surviving AZ(s).
4. **Velocity controls in deploys**: Use `MinHealthyPercentage` plus lifecycle hooks to bound the rate of capacity loss during rolling deploys.

## Related

- [[exam-topics#ANS-C01 -- Advanced Networking Specialty]] -- Domain 2: Network Design
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [AWS US-EAST-1 Outage October 2025 Technical Analysis](https://medium.com/@dipakkrdas/aws-us-east-1-outage-october-2025-technical-analysis-e7a563a8fe57) -- the post-mortem this scenario mirrors
