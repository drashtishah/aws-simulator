---
tags:
  - type/simulation
  - service/route53
  - service/lambda
  - service/ecs
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# Two Automations, One Record

## Opening

- company: Halcyon Pay
- industry: B2B payments and reconciliation, $4B in monthly volume across 800 mid-market customers
- product: api.halcyonpay.com is the public payments API; customer integrations call it directly
- scale: ~14,000 requests per second peak; backed by ECS Fargate behind an NLB
- time: Friday, 16:42 PT, midway through a planned blue/green deploy of the API
- scene: customers are reporting intermittent payment-submission failures; the deploy is at 60% traffic shift; on-call has been bouncing between Slack threads from three customers
- alert: PagerDuty INC-20260424-1631 fires at 16:31 with text `External synthetic: api.halcyonpay.com NXDOMAIN from 4 of 6 prober regions`
- stakes: every minute of partial DNS failure causes intermittent customer integrations; one customer's accounts-payable batch is timing out; reputation cost is rising
- early_signals:
  - synthetic checks: api.halcyonpay.com works for 90s, fails for 90s, works for 90s
  - dig +trace from outside AWS: returns NOERROR with empty answer section, then later returns the expected IPs
  - NLB target group reports all targets healthy
  - the new ECS task set is healthy; the old task set is still running
  - someone disabled the deploy hook two months ago, then re-enabled it (per CloudTrail)
- investigation_starting_point: Route 53 console open, ECS console open, CloudWatch synthetic results visible

## Resolution

- root_cause: two independent automations modify the api.halcyonpay.com A-record RRset; a Lambda runs every 30 seconds in response to Route 53 health checks; a CodeDeploy AfterAllowTraffic hook runs on every deployment; both perform read-modify-write with no version check and no SetIdentifier separation
- mechanism: at 16:31:14 the deploy hook started a write batch; at 16:31:14 the health-check Lambda also started one (independently scheduled); the deploy hook read RRset version V1 (containing both old and new task IPs); the health-check Lambda read the same V1; the deploy hook computed V2-deploy = V1 minus old IPs plus new IPs and wrote it; one second later the health-check Lambda computed V2-health = V1 minus the IP it had just probed (an old IP that had become unhealthy mid-deploy) and wrote it; V2-health overwrote V2-deploy and re-added the old (now terminated) IPs; the next health-check Lambda invocation 30 seconds later started from V2-health, removed the just-re-added old IPs, and wrote a result that omitted the new IPs because the deploy hook's update had been overwritten and the Lambda did not know about them; for ~90 seconds, the RRset contained only IPs that were either terminated or unhealthy; one cycle produced an empty RRset
- fix: SRE disabled the EventBridge schedule on the health-check Lambda to break the race; the team then introduced weighted routing with two SetIdentifier values ('health-check' and 'deploy-hook'); each automation writes only under its own SetIdentifier and never overwrites the other; long-term plan is to migrate to Cloud Map as the sole writer
- contributing_factors:
  - the team had been migrating from Cloud Map to a custom Lambda for cost reasons (Cloud Map per-instance billing) and built the health-check Lambda without realizing the deploy hook also wrote to the same RRset
  - the deploy hook was a legacy from a previous architecture that no one had been the owner of for two quarters
  - Route 53 ChangeResourceRecordSets has no compare-and-swap, so neither automation could detect the conflict in real time
  - high deploy frequency (this team deploys ~12 times per day) made the race practically guaranteed
