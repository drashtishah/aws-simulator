# Opening: The Drain That Took Twenty

It is Thursday, 14:09pm Pacific. You are the Incident Commander on call for Beacon Routing,
a Series B last-mile delivery routing SaaS. Your phone buzzes with PagerDuty
INC-20260423-1408: `Beacon prod ALB UnHealthyHostCount = 20, HealthyHostCount = 4`.

The on-call engineer just told you in Slack: "I just ran a drain on staging, it returned fine."
Two hours into a planned staging refresh, the routine drain script printed exit code 0
and the AWS CLI returned 200 OK.

The fleet for `beacon-routing-prod-asg` is supposed to hold 24 EC2 instances behind the
production ALB. CloudWatch shows `HealthyHostCount` dropping from 24 to 4 within 30 seconds.
Customer trucks (~41,000 active) are still sending GPS pings; the API is returning 502s on
roughly five sixths of requests. Auto Scaling has begun launching replacement instances, but
the AMI bootstrap takes ~90 seconds to pass health checks.

Your job: find which call drained the production fleet, restore capacity quickly, and
identify the guardrails that should have prevented this.
