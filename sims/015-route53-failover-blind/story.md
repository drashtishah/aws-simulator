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

company: Spellbook
industry: developer tools / documentation, Series B, 28 engineers
product: API documentation hosting for SaaS companies
scale: 400 SaaS company customers, 2.1 million developers visit monthly to look up endpoints, read authentication guides, copy code samples
time: 2:14 PM, Tuesday
scene: customer in Berlin reports docs.spellbook.dev is not loading, browser waited 16 seconds then timed out
alert: Slack message from a customer developer: "docs.spellbook.dev is not loading"
stakes: 2.1 million developers depend on the documentation platform, customers use it to look up API endpoints during active development work
early_signals:
  - customer in Berlin waited 16 seconds before connection timed out
  - platform runs in two regions: us-east-1 (primary) and eu-west-1 (failover)
  - multi-region setup built 6 months ago by SRE team over two weeks: Route 53 failover routing, separate ALBs, ECS clusters in both regions, DocumentDB global cluster
  - primary ALB in us-east-1 unreachable, AZ issue took down enough capacity that target group is empty
  - secondary region eu-west-1 running perfectly: 4 healthy targets, normal response times
  - failover never happened -- Route 53 kept sending every request to the dead primary
  - eu-west-1 stack sitting idle, healthy and useless
investigation_starting_point: the primary is down and the secondary is healthy, but failover did not trigger. Something in the Route 53 failover configuration is preventing the switch.

## Resolution

root_cause: Route 53 failover record set had EvaluateTargetHealth set to false, and the associated health check was misconfigured -- checking HTTP port 80 with path "/" instead of HTTPS port 443 with a health endpoint returning 200
mechanism: the health check was created 6 months ago during the multi-region buildout. It checked port 80 using HTTP, but the ALB only listens on port 443 using HTTPS. The path "/" returns a 301 redirect to /docs, which the health check treated as a failure. The health check had been UNHEALTHY since March 4th (three weeks). But EvaluateTargetHealth was set to false on the primary failover record, so Route 53 never consulted the health check result when routing. A CloudWatch alarm existed for the health check metric and had been in ALARM state for three weeks, but no SNS topic was attached -- no page, no email.
fix: two changes. (1) Update the health check to use HTTPS on port 443 with path /healthz that returns 200. (2) Set EvaluateTargetHealth to true on the primary failover record set. Also attach an SNS topic to the CloudWatch alarm so health check state changes page the on-call engineer.
contributing_factors:
  - health check configured with wrong protocol (HTTP vs HTTPS), wrong port (80 vs 443), and wrong path (/ returns 301)
  - EvaluateTargetHealth set to false, disconnecting the health check from routing decisions
  - CloudWatch alarm had no SNS topic attached, so ALARM state went unnoticed for three weeks
  - multi-region setup never tested with an actual primary failure
  - architecture diagram on the wiki showed what was intended, not what was configured
