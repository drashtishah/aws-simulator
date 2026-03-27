---
tags:
  - type/simulation
  - service/elb
  - service/auto-scaling
  - service/ec2
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# The Targets That Disappeared

## Opening

company: Ridgewell
industry: logistics SaaS, growth-stage, 38 engineers
product: route optimization platform for enterprise logistics companies
scale: 340 enterprise logistics customers, 2,800 concurrent sessions during peak hours, $6.2M ARR
time: 6:15 AM, Wednesday
scene: routine deployment during peak dispatch hours (6 AM to 10 AM), dispatchers across three time zones logging in to plan delivery routes
alert: "502 Bad Gateway" errors reported by dispatchers within 90 seconds of deployment start
stakes: dispatchers mid-route planning for the day's deliveries, four-minute outage generates support tickets faster than anyone can read them
early_signals:
  - deployment started at 6:15 AM: three dependency patches and a logging format change, nothing touching business logic
  - CodeDeploy replacing instances in target group in batches of two (50% of fleet)
  - first support ticket within 90 seconds, four more immediately after
  - screenshot from a dispatcher at a freight company in Memphis: "502 Bad Gateway"
  - 14 customers reported the same issue within two minutes
  - route optimization requests timing out
  - some dispatchers switching to manual planning (spreadsheets and phone calls)
investigation_starting_point: pulled in at 6:18 AM. Deployment still running. Error rate climbing. Platform engineer who triggered the deploy insists code changes are harmless -- he is probably right about the code. The problem is somewhere else.

## Resolution

root_cause: deregistration delay on the target group was 30 seconds, but ALB health check required 150 seconds (5 consecutive checks at 30-second intervals) to mark a new target as healthy -- old targets drained and left before replacements were ready
mechanism: CodeDeploy deregistered the first batch of two instances, which drained in 30 seconds and left the target group. Replacement instances needed another 120 seconds to pass health checks. When the second batch started, the remaining two old instances were also deregistered. HealthyHostCount dropped to zero. The ALB entered fail-open mode, routing requests to initializing instances that returned 502 and 503 errors. Error window lasted roughly three minutes.
fix: increase deregistration delay to at least 300 seconds so old targets continue serving while new ones initialize. Reduce healthy threshold from 5 to 2 so new targets become healthy faster. Reduce deployment batch size from 50% to 25% so at least two healthy targets remain at all times. Never deploy during the 6 AM to 10 AM peak window.
contributing_factors:
  - deregistration delay left at 30 seconds, far shorter than the 150-second health check time-to-healthy
  - deployment batch size of 50% replaced half the fleet at once, leaving no capacity margin
  - deployment scheduled during peak dispatch hours (6 AM to 10 AM)
  - no HealthyHostCount alarm configured to detect when healthy capacity dropped
