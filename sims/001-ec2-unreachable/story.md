---
tags:
  - type/simulation
  - service/ec2
  - service/vpc
  - service/cloudwatch
  - difficulty/foundational
  - category/networking
---

# The BrightPath Outage: Students Locked Out

## Opening

company: BrightPath Education
industry: edtech, seed-stage startup, 12 engineers
product: course materials, assignment submissions, real-time collaboration tools
scale: 8,200 students across 14 universities
time: 9:47 PM, Wednesday
scene: night before midterm submissions are due
alert: "CRITICAL: BrightPath Learning Platform -- health check failures on brightpath-prod-web-01"
stakes: 3,400 students have midterm papers due at 8:00 AM sharp, professors strict about deadline
early_signals:
  - support inbox filling up, students reporting site will not load (browsers spin, time out, no error page, no partial load)
  - 23 messages in Slack channel in 4 minutes, all "is the site down?"
  - Georgetown professor emailed CEO directly
investigation_starting_point: SSH into jump box confirms instance reachable on private network, application process running, database responding, system metrics normal. From outside, instance might as well not exist. Something is blocking traffic before it reaches the application.

## Resolution

root_cause: during scheduled security hardening sprint 2 hours earlier, engineering lead reviewed security group rules across all environments, removed several overly permissive rules, accidentally removed inbound TCP 443 (HTTPS) from 0.0.0.0/0 on sg-0a1b2c3d4e5f67890
mechanism: security group default-deny silently dropped every HTTPS request from students. Instance healthy, app running, database fine -- no user traffic could reach server.
fix: add inbound rule to sg-0a1b2c3d4e5f67890 allowing TCP 443 from 0.0.0.0/0. Security group changes take effect instantly, no restart required. Health checks recovered within seconds.
contributing_factors:
  - no automated validation of security group changes against required application ports
  - no staging environment test before applying hardened rules to production
