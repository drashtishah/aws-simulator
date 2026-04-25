---
tags:
  - type/simulation
  - service/elb
  - service/ec2
  - service/auto-scaling
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# The Failover That Failed Itself

## Opening

- company: Lumen Cast
- industry: live video streaming for sports
- product: low-latency relay for live event streams; viewers connect through edge nodes that relay from a single origin
- scale: ~340,000 concurrent viewers during marquee events; an NBA playoff game tonight is forecast to peak at 280,000
- time: Friday, 14:11 PT, three hours before the puck drop
- scene: an SRE has started a routine Instance Refresh on the edge fleet to roll out a new TLS certificate; the deploy is at step 2 of 4
- alert: PagerDuty INC-20260424-1411 fires at 14:11 with text `lumen-edge ALB error_count > 1000/min, p50 connection failures rising`
- stakes: stream availability for a major sporting event in three hours; the team has a hard rule: no deploys within four hours of a live event start, and they are about to break it
- early_signals:
  - target group HealthyHostCount oscillates between AZ-1a and AZ-1b every five minutes
  - NLB AZ DNS failover events visible in CloudWatch metrics
  - viewer client logs show ~33% of new connections failing during the flap window
  - the Instance Refresh activity log shows 4 instances per AZ being replaced per step, MinHealthyPercentage=66
  - cross-zone load balancing on the NLB: disabled (this is the default for NLB and was never changed)
  - the recently deployed AMI is the same as before, just with a new cert; instance bootstrap takes ~75 seconds
- investigation_starting_point: NLB console open, target group health visible, Auto Scaling activity log accessible, CloudWatch metrics

## Resolution

- root_cause: lumen-edge-asg launches new EC2 instances directly into the lumen-edge-target-group without an Auto Scaling lifecycle hook; new instances need 60-90 seconds for ENI attachment, route programming, and certificate loading before they pass /healthz; the target group's health check marks them unhealthy after just 2 * 10s = 20 seconds; during the Instance Refresh, four instances per AZ are simultaneously in this unhealthy launch window
- mechanism: the deploy step at 14:08 replaced 4 of 12 instances in AZ-1a; for ~75 seconds those 4 instances were in the target group but failing /healthz; the surviving 8 instances were marked unhealthy because of normal load redistribution latency; HealthyHostCount in AZ-1a dropped to 4 (below threshold of 6); NLB AZ DNS failover removed AZ-1a from its DNS response; all traffic redirected to AZ-1b which doubled in load and started failing health checks; the next deploy step at 14:13 replaced 4 instances in AZ-1b which were already strained; AZ-1b also dropped below threshold; AZ-1a (whose original capacity had warmed up by then) was reinstated and got all the traffic; the cycle repeated every ~5 minutes
- fix: SRE cancelled the Instance Refresh to stop the bleeding; added an Auto Scaling lifecycle hook on launch with HeartbeatTimeout=180s; updated the bootstrap script to call complete-lifecycle-action only after a local /healthz returns 200 three times; enabled cross-zone load balancing on the NLB; increased target-group HealthyThresholdCount from 2 to 3 and Interval from 10 to 15; resumed the Instance Refresh, which completed cleanly in 35 minutes with stable healthy counts in both AZs throughout
- contributing_factors:
  - the team had been on Fargate (where targets register only after the task passes its in-platform health check) until two quarters ago; the EC2 launch type they migrated to does not have that built-in
  - cross-zone load balancing was never enabled on the NLB because the default is disabled; nobody changed it
  - the Instance Refresh policy used MinHealthyPercentage=66 because that was the documented default; for an aggressive deploy this is too low
  - HealthCheckGracePeriod=120s on the ASG was assumed to cover the issue, but it only prevents the ASG from terminating the instance, not the target group from marking it unhealthy
