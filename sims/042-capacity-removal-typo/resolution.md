---
tags:
  - type/resolution
  - service/auto-scaling
  - service/ec2
  - service/cloudtrail
  - service/cloudwatch
  - difficulty/professional
  - category/operations
---

# Resolution: The Drain That Took Twenty

## Root Cause

An on-call engineer ran a maintenance script called `drain-instances.sh` with an `--instance-ids` argument copy-pasted from the wrong tmux pane. The argument contained twenty production instance IDs instead of the three staging IDs the engineer believed they were passing.

The script forwarded the IDs directly to `aws ec2 terminate-instances`. This API call lives in the EC2 control plane and is not Auto-Scaling-aware. It does not consult the Auto Scaling group's `MinSize` or its instance scale-in protection setting. The call returned `200 OK` and twenty production instances entered the `shutting-down` state in a single transaction.

The Auto Scaling group noticed the loss within seconds and began launching replacement instances, but the launch template's AMI required ~90 seconds of bootstrap time. By the time the first replacements passed the load balancer's health checks, the ALB had already returned thousands of 502 responses to live customer traffic.

This pattern is the customer-side analogue of the 2017-02-28 Amazon S3 service disruption: an authorized engineer running an established playbook entered one input incorrectly, and the capacity-removal command had no protective limit on how much it could remove at once.

## Timeline

| Time (UTC) | Event |
|---|---|
| 21:08:42 | drain-instances.sh runs; aws ec2 terminate-instances called with 20 production IDs |
| 21:08:43 | EC2 returns 200 OK; instances enter shutting-down state |
| 21:08:51 | ALB target group reports 20 instances Draining |
| 21:09:04 | Auto Scaling triggers replacement launches (AMI bootstrap ~90s) |
| 21:09:12 | PagerDuty incident INC-20260423-1408 fires (UnHealthyHostCount = 20) |
| 21:09:18 | First customer 502 responses on /v1/route |
| 21:10:55 | First replacement instance passes ALB health check |
| 21:13:22 | Fleet recovers to 18 healthy instances; error rate falls below 1% |
| 21:14:40 | Fleet at 24 healthy instances; incident closed |

## Correct Remediation

1. **Restore capacity immediately.** Auto Scaling is already trying to replace the lost instances, but the cooldown means it batches replacements. To force faster recovery, raise the desired capacity above the current target so Auto Scaling launches in parallel: `aws autoscaling set-desired-capacity --auto-scaling-group-name beacon-routing-prod-asg --desired-capacity 28`. Lower it back to 24 once the fleet stabilizes.
2. **Enable instance scale-in protection on the production Auto Scaling group.** This setting (called `--new-instances-protected-from-scale-in`) tells the ASG to refuse to terminate instances during scale-in events. Important caveat: this protects against ASG-initiated terminations only. A direct EC2 `TerminateInstances` call still bypasses it, because that API talks to EC2 directly without consulting Auto Scaling.
3. **Switch the runbook from EC2 TerminateInstances to TerminateInstanceInAutoScalingGroup.** This second API is the Auto-Scaling-aware version. It honors MinSize, honors scale-in protection, and refuses to terminate an instance if doing so would drop the group below its floor. The CLI form is `aws autoscaling terminate-instance-in-auto-scaling-group --instance-id i-xxxx --no-should-decrement-desired-capacity`.
4. **Add tier validation to the script.** Before forwarding any instance IDs to the AWS CLI, the script should call `aws ec2 describe-instances --instance-ids <ids> --query "Reservations[].Instances[].[InstanceId,Tags]"` and abort if any returned instance has `Tier=production` (or whatever the staging-only filter should be).
5. **Scope the IAM policy on the operator role.** Instead of granting `ec2:TerminateInstances` broadly, attach a Condition that requires `aws:ResourceTag/Tier` to equal `staging`. The IAM authorization layer then refuses production terminations even if the script is bypassed.
6. **Add a CloudWatch alarm for sudden capacity loss.** Alarm on `GroupDesiredCapacity` or `GroupInServiceInstances` with a threshold of "drops by more than 25% in five minutes." This catches both bad scripts and runaway scaling policies before customers notice.

## Key Concepts

### EC2 TerminateInstances vs Auto Scaling TerminateInstanceInAutoScalingGroup

These look like the same operation but they live in different services and respect different rules.

- **EC2 TerminateInstances** is part of the EC2 API. It operates on raw instance IDs. It does not know which Auto Scaling group an instance belongs to, and it does not check ASG floors or scale-in protection. The call succeeds even if it leaves the group below its `MinSize`. The Auto Scaling group then races to relaunch.
- **Auto Scaling TerminateInstanceInAutoScalingGroup** is part of the Auto Scaling API. It checks the group's `MinSize` and refuses if the operation would drop the count below it. It also respects per-instance scale-in protection.

The right tool depends on intent. If the goal is "remove this instance from a managed group," always use the Auto Scaling form. EC2 `TerminateInstances` is for instances that are not part of a managed group, or for emergency cleanup of orphans.

### Instance Scale-In Protection Has a Narrow Scope

Scale-in protection is a per-instance setting (`ProtectedFromScaleIn=true`) that tells Auto Scaling not to terminate the instance during normal scale-in events. It is widely misunderstood as a "do not delete" flag. It is not.

What it protects against:
- ASG scale-in events triggered by metric-based policies (e.g., target tracking)
- Availability Zone rebalancing
- Instance Refresh

What it does NOT protect against:
- Direct calls to EC2 `TerminateInstances` (those bypass the ASG entirely)
- A `TerminateInstanceInAutoScalingGroup` call with `should-decrement-desired-capacity=false` (the operator is explicitly opting out)
- Manual termination of an unhealthy instance by the ASG

For full protection, combine scale-in protection with IAM Condition keys that scope `ec2:TerminateInstances` to specific tag values. That way the EC2 API itself refuses the call before it reaches the instance.

### CloudTrail as the Source of Truth for Operator Actions

Every control-plane API call in an AWS account is recorded by CloudTrail. For incident forensics, the management-event log is the canonical answer to "who did what, when, from where." Each event includes:

- The calling principal (IAM user, IAM role, or AWS service)
- The source IP address
- The user-agent string (often reveals which CLI version or SDK was used)
- The exact request parameters (the instance IDs in this case)
- The response (success or error code)

The free 90-day event history is enough for active incident response. For deeper root-cause analysis weeks later, configure a CloudTrail trail that writes to S3 with a longer retention. CloudTrail Lake adds SQL-based querying for cross-event analysis (e.g., "show me every TerminateInstances call in the last quarter that hit production-tagged instances").

## Other Ways This Could Break

### Compromised access key terminates production
An attacker who obtains an operator's access key calls `ec2:TerminateInstances` directly. The CloudTrail event looks identical to a fat-finger event in shape, but the source IP is external and the user-agent does not match the usual jump-host pattern.
**Prevention:** Scope `ec2:TerminateInstances` with an IAM Condition on `aws:ResourceTag/Tier`. Rotate access keys, prefer short-lived STS credentials, and require MFA for destructive operations via `aws:MultiFactorAuthPresent`.

### Faulty health check causes ASG self-terminations
A custom health-check script returns `Unhealthy` in a loop, and the ASG dutifully terminates and replaces every instance. CloudTrail shows `TerminateInstanceInAutoScalingGroup` events from the `autoscaling.amazonaws.com` service principal, not a human IAM user.
**Prevention:** Validate health-check scripts under load in staging. Set a CloudWatch alarm on `UnHealthyHostCount` so a runaway pattern pages before the ASG burns through the fleet.

### Instance Refresh terminates too many at once
An Instance Refresh on the ASG was started with `MinHealthyPercentage` set to 50 instead of 90. The ASG terminates half the fleet before the replacements are ready.
**Prevention:** Use `MinHealthyPercentage` of at least 90 for production refreshes. Use 100 if the workload is stateful or sensitive to capacity loss.

## SOP Best Practices

- **Require typed confirmation for destructive operations.** Wrap any script that calls `terminate-instances`, `delete-stack`, `delete-table`, etc. in a confirmation step that prints the resource list, the source tier, and the count, and waits for the operator to type the count back. The 2017 S3 post-mortem made this pattern famous.
- **Prefer Auto-Scaling-aware APIs.** Use `TerminateInstanceInAutoScalingGroup` instead of `TerminateInstances` whenever the instance is part of an ASG. This single substitution makes MinSize and scale-in protection effective.
- **Tag every resource with Tier and Owner.** IAM policies can then condition destructive permissions on the tag. A credential leaked from a staging operator cannot touch production.
- **Multi-region CloudTrail with S3 archive.** The 90-day free event history is enough for live incident response; a longer-retention trail in S3 is what makes post-incident analysis possible weeks later.

## Learning Objectives

1. **EC2 vs Auto Scaling APIs**: Understand which API calls bypass which protections and pick the right one for the intent.
2. **Layered guardrails**: Combine ASG scale-in protection with IAM Conditions on tag values for defense in depth.
3. **CloudTrail forensics**: Reconstruct the timeline of an operator action by querying CloudTrail by event name, principal, and time window.
4. **Blast-radius reasoning**: Recognize that a script accepting an arbitrary `--instance-ids` argument has unbounded blast radius unless the script validates the input.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 5: Continuous Improvement
- [[exam-topics#DOP-C02 -- DevOps Engineer Professional]] -- Domain 2: Configuration Management
- [Summary of the Amazon S3 Service Disruption (Feb 2017)](https://aws.amazon.com/message/41926/) -- the post-mortem this scenario mirrors
