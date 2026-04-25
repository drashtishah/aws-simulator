---
tags:
  - type/simulation
  - service/auto-scaling
  - service/ec2
  - service/cloudtrail
  - service/cloudwatch
  - difficulty/professional
  - category/operations
---

# The Drain That Took Twenty

## Opening

- company: Beacon Routing
- industry: last-mile delivery routing SaaS
- product: routing engine that ingests GPS pings from delivery trucks and returns next-stop optimizations
- scale: 1,400 fleet operators, 41,000 trucks active, ~28 million pings per day
- time: Thursday, 14:08 PT
- scene: an on-call engineer is two hours into a planned staging refresh; the runbook is a familiar one
- alert: PagerDuty INC-20260423-1408 fires at 14:09 with text `Beacon prod ALB UnHealthyHostCount = 20, HealthyHostCount = 4`
- stakes: every minute of degraded routing means trucks taking longer routes; SLA breach in 12 minutes; one customer is mid-peak afternoon delivery
- early_signals:
  - on-call engineer says "I just ran a drain on staging, it returned fine"
  - support sees a spike in 502s from the routing API
  - ALB target group shows 20 instances InService -> 0 InService -> Draining within 30 seconds
  - the staging soak test that was supposed to be drained is still running healthy
- investigation_starting_point: PagerDuty incident open, jump-host shell history visible, CloudTrail accessible, ASG and EC2 consoles available

## Resolution

- root_cause: drain-instances.sh was invoked with an --instance-ids list copy-pasted from the wrong tmux pane; the IDs belonged to the production tier, not staging
- mechanism: the script forwards --instance-ids directly to aws ec2 terminate-instances; that API call bypasses both ASG MinSize and instance scale-in protection because it is an EC2 control-plane action, not an Auto Scaling action; CloudTrail recorded one TerminateInstances call with all 20 production IDs at 14:08:42
- fix: the on-call engineer raised desired-capacity to 28 to force eager replacement, then turned on instance scale-in protection on the prod ASG; the SRE team replaced the script's direct EC2 call with TerminateInstanceInAutoScalingGroup and added a Tier-tag validation step
- contributing_factors:
  - the runbook script had no tier check and treated the --instance-ids argument as trusted
  - the prod ASG had MinSize=20 but no scale-in protection enabled, so the ASG could not refuse the operation (and even if scale-in protection was on, the direct EC2 call would have ignored it)
  - the launch template's AMI took 90 seconds to bootstrap, so replacement was slower than the loss
  - the operator's IAM role allowed ec2:TerminateInstances on resources of any tier
