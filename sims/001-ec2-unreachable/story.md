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

It is 9:47 PM on a Wednesday -- the night before midterm submissions are due. Your phone lights up with a PagerDuty alert: "CRITICAL: BrightPath Learning Platform -- health check failures on brightpath-prod-web-01." You grab your laptop and pull up the incident channel.

BrightPath Education is a seed-stage edtech startup that serves 8,200 students across 14 universities. The platform hosts course materials, assignment submissions, and real-time collaboration tools. Tomorrow morning, 3,400 students have midterm papers due through the platform. The submission window closes at 8:00 AM sharp -- professors are strict about it.

The support inbox is already filling up. Students are reporting that the site will not load at all -- browsers just spin and eventually time out. No error page, no partial load, just nothing. The Slack channel has 23 messages in the last four minutes, all variations of "is the site down?" A professor from Georgetown just emailed the CEO directly.

You SSH into the jump box and confirm you can reach the instance on the private network. The application process is running, the database is responding, and system metrics look normal. But from the outside, the instance might as well not exist. Something is blocking traffic before it ever reaches the application.

## Resolution

The team traced the outage to a security group change made two hours earlier during a scheduled security hardening sprint. The engineering lead had reviewed the security group rules across all environments and removed several rules that appeared overly permissive. In the process, the inbound rule allowing TCP port 443 (HTTPS) from 0.0.0.0/0 was accidentally removed from the production web server's security group, sg-0a1b2c3d4e5f67890.

With no inbound rule for port 443, the security group's default-deny behavior silently dropped every HTTPS request from students. The instance was healthy, the application was running, and the database was fine -- but no user traffic could reach the server.

The fix was immediate: add an inbound rule to sg-0a1b2c3d4e5f67890 allowing TCP port 443 from 0.0.0.0/0. Security group changes take effect instantly with no restart required. Within seconds of the rule being added, the health checks recovered and students could access the platform again.

The post-incident review identified two contributing factors: no automated validation of security group changes against required application ports, and no staging environment test before applying the hardened rules to production.
