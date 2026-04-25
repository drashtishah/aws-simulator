# Opening: The Failover That Failed Itself

It is Friday, 14:11pm Pacific. You are a senior SRE on call for Lumen Cast, a
Series C live video streaming service for sports. An NBA playoff game starts in three
hours and is forecast to peak at 280,000 concurrent viewers.

A routine TLS-cert Instance Refresh on the edge fleet started at 14:00. PagerDuty
INC-20260424-1411 fired eleven minutes later: `lumen-edge ALB error_count > 1000/min,
p50 connection failures rising`. The deploy is at step 2 of 4.

The target group's HealthyHostCount is oscillating between AZ-1a and AZ-1b every
five minutes. NLB AZ DNS failover events are visible in CloudWatch. Viewer client
logs show ~33% of new connections failing during the flap window. The Instance Refresh
activity log shows 4 instances per AZ being replaced per step with MinHealthyPercentage=66.
Cross-zone load balancing on the NLB is disabled (the default for NLB; nobody changed it).
Bootstrap timing for new instances is ~75 seconds before /healthz returns 200.

Your job: stop the oscillation before the puck drop, and decide what configuration
needs to change so this does not recur during the live event.
