---
tags:
  - type/simulation
  - service/route53
  - service/elb
  - service/cloudwatch
  - difficulty/associate
  - category/networking
---

# Sixteen Seconds of Nothing

## Opening

The Slack message from a customer said "docs.spellbook.dev is not loading." It was 2:14 PM on a Tuesday. A developer at one of their API doc customers, sitting in Berlin, had tried to open a reference page and waited sixteen seconds before the browser gave up. Connection timed out.

Spellbook hosts API documentation for 400 SaaS companies. 2.1 million developers visit each month to look up endpoints, read authentication guides, copy code samples. The platform runs in two regions: us-east-1 as the primary, eu-west-1 as the failover. Six months ago, the SRE team spent two weeks building the multi-region setup. Route 53 failover routing. Separate Application Load Balancers. ECS clusters in both regions. A DocumentDB global cluster. The whole architecture diagram on the wiki, clean lines and green boxes.

The primary ALB in us-east-1 was unreachable. An availability zone issue had taken down enough capacity that the target group was empty. No healthy instances behind the load balancer. The secondary region in eu-west-1 was running perfectly. Four healthy targets, normal response times, ready to serve traffic.

The failover never happened. Route 53 kept sending every request to the dead primary. The eu-west-1 stack sat idle, healthy and useless, while 2.1 million developers' documentation platform returned nothing at all.

## Resolution

The Route 53 health check was created six months ago, during the multi-region buildout. It was configured to check port 80 using HTTP. The ALB only listens on port 443 using HTTPS. The health check path was set to `/`, which the application redirects to `/docs` with a 301 status code. The health check saw a non-200 response and marked the endpoint unhealthy. It had been in UNHEALTHY state since March 4th. Three weeks.

But the failover record set for the primary endpoint had `EvaluateTargetHealth` set to `false`. Route 53 never consulted the health check result when making routing decisions. The health check existed, it was associated with the record, but the routing policy ignored it entirely. A CloudWatch alarm had been created for the health check metric. It had been in ALARM state for three weeks. No SNS topic was attached. No one received a page. No one received an email.

The fix required two changes: update the health check to use HTTPS on port 443 with a path of `/healthz` that returns a 200, and set `EvaluateTargetHealth` to `true` on the primary failover record set. The team also attached an SNS topic to the CloudWatch alarm so that health check state changes would page the on-call engineer. The postmortem found that the multi-region setup had never been tested with an actual primary failure. The architecture diagram on the wiki showed what was intended, not what was configured.
