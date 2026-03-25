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

The deployment started at 6:15 AM on a Wednesday. A routine update -- three dependency patches and a logging format change. Nothing that touched business logic. The pipeline approved it. CodeDeploy began replacing instances in the target group in batches of two.

Ridgewell's route optimization platform serves 340 enterprise logistics companies. Peak hours are 6 AM to 10 AM, when dispatchers across three time zones log in, pull overnight shipment data, and plan the day's delivery routes. The platform handles roughly 2,800 concurrent sessions during that window. $6.2M ARR. Thirty-eight engineers. The kind of company where a four-minute outage during peak hours generates support tickets faster than anyone can read them.

Within ninety seconds of the deployment starting, the first ticket arrived. Then four more. The Slack channel for the on-call team lit up with a screenshot from a dispatcher at a freight company in Memphis: "502 Bad Gateway." The dispatcher had been mid-route when the page went white. Two minutes later, fourteen customers had reported the same thing. Route optimization requests were timing out. Some dispatchers had already switched to manual planning -- spreadsheets and phone calls, the way they did it before Ridgewell existed.

You are the on-call engineer. You were pulled in at 6:18 AM. The deployment is still running. The error rate is climbing. The platform engineer who triggered the deploy is in the channel, insisting the code changes are harmless. He is probably right about the code. The problem is somewhere else.

## Resolution

The deregistration delay on the target group was 30 seconds. The ALB health check required five consecutive successful checks at 30-second intervals -- 150 seconds to mark a new target as healthy. When CodeDeploy deregistered the first batch of two instances, those targets drained their connections in 30 seconds and left the target group. But the two replacement instances had only been running for 30 seconds. They needed another 120 seconds to pass their health checks. The target group had two healthy targets instead of four.

Then the second batch started. The remaining two old instances were deregistered. They drained in 30 seconds. The two new instances from the first batch still had not passed their health checks. HealthyHostCount dropped to zero. The ALB entered fail-open mode -- when every target in a target group is unhealthy, the ALB routes requests to all of them rather than returning 503 directly. The new instances were still initializing. They returned 502 and 503 errors. The dispatchers saw "Bad Gateway."

The deployment itself completed successfully. Every new instance eventually passed its health checks. The error window lasted roughly three minutes. The fix is structural: increase the deregistration delay to at least 300 seconds so old targets continue serving traffic while new ones initialize, reduce the healthy threshold from 5 to 2 so new targets become healthy faster, reduce the deployment batch size from 50% to 25% so at least two healthy targets remain at all times, and never deploy during the 6 AM to 10 AM peak window.
