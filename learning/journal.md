---
tags:
  - type/learning-journal
  - domain/aws-simulator
---

# Learning Journal

Progress entries are added automatically after each completed simulation.

## The BrightPath Outage: Students Locked Out

- **Date**: 2026-03-24
- **Sim**: [[001-ec2-unreachable]]
- **Difficulty**: 1
- **Category**: networking
- **Services**: EC2, VPC, CloudWatch
- **Questions asked**: 3
- **Hints used**: 0
- **Criteria met**: 3 / 3

### Coaching summary

Strong architectural instinct -- started by understanding the infrastructure layout before investigating. Correctly identified the security group as the culprit and found the missing port 443 rule without hints. Needs to broaden investigation to multiple services (only queried EC2) and develop the habit of checking audit trails and recent changes early.

### Key takeaway

Security groups are deny-by-default firewalls. If no inbound rule explicitly allows traffic on a port, that traffic is silently dropped.
