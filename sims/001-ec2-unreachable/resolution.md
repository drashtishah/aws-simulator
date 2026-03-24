---
tags:
  - type/resolution
  - service/ec2
  - service/vpc
  - service/cloudwatch
  - difficulty/foundational
  - category/networking
---

# Resolution: The BrightPath Outage -- Students Locked Out

## Root Cause

The EC2 instance `brightpath-prod-web-01` (i-0abc123def456789a) had its security group `sg-0a1b2c3d4e5f67890` modified during a security hardening sprint. The inbound rule allowing TCP port 443 (HTTPS) from 0.0.0.0/0 was removed. Because security groups are default-deny, all inbound HTTPS traffic was silently dropped before reaching the application.

## Timeline

| Time | Event |
|---|---|
| 19:30 UTC | Security hardening sprint begins; engineering lead reviews security group rules |
| 19:42 UTC | Inbound rule for TCP 443 removed from sg-0a1b2c3d4e5f67890 |
| 19:42 UTC | All external HTTPS traffic to brightpath-prod-web-01 begins failing immediately |
| 19:48 UTC | First student reports "site won't load" in support channel |
| 20:15 UTC | Support inbox reaches 23 tickets |
| 21:47 UTC | CloudWatch alarm fires on health check failures; PagerDuty pages on-call SRE |
| 22:08 UTC | Root cause identified: missing inbound rule for port 443 |
| 22:09 UTC | Inbound rule re-added to security group; traffic restores within seconds |

## Correct Remediation

1. **Immediate**: Add inbound rule to sg-0a1b2c3d4e5f67890 allowing TCP port 443 from 0.0.0.0/0 (IPv4) and ::/0 (IPv6)
2. **Verification**: Confirm health checks pass and the application is accessible from an external browser
3. **Prevention**: Create a runbook that documents required security group rules for each production service, with port numbers and justifications
4. **Detection**: Add a CloudWatch alarm on the `StatusCheckFailed` metric with a 1-minute evaluation period to reduce detection time
5. **Process**: Require peer review and staging environment validation before modifying production security groups

## Key Concepts

### Security Groups

Security groups are stateful virtual firewalls attached to EC2 instances (technically, to elastic network interfaces). Key properties:

- **Default deny**: If no rule explicitly allows traffic, it is dropped. There is no explicit deny -- you control access by what you allow.
- **Stateful**: If an inbound rule allows traffic in, the response traffic is automatically allowed out, regardless of outbound rules.
- **Immediate effect**: Changes apply instantly. No instance restart or reattachment needed.
- **Multiple groups**: An instance can have up to five security groups. Rules across all groups are evaluated together as a union.

### Security Groups vs Network ACLs

Security groups operate at the instance level and are stateful. Network ACLs operate at the subnet level and are stateless (you must configure both inbound and outbound rules). For this incident, the Network ACL was not the issue -- it correctly allowed traffic on port 443. The security group was the chokepoint.

### CloudWatch Instance Metrics

EC2 instances report `StatusCheckFailed_Instance` (OS-level) and `StatusCheckFailed_System` (hardware-level) metrics. These check if the instance is running, not if the application is reachable. A custom health check or an ALB target group health check is needed to detect application-level failures.

## AWS Documentation Links

- [Security Groups for Your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Security Group Rules Reference](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html)
- [Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)
- [EC2 Status Checks](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html)
- [CloudWatch Metrics for EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/viewing_metrics_with_cloudwatch.html)

## Learning Objectives

1. **Security group mechanics**: Understand that security groups are default-deny, stateful firewalls that control traffic at the instance level
2. **Troubleshooting connectivity**: When an instance is running but unreachable, check security group inbound rules for the required port
3. **Change management**: Security group modifications take effect immediately -- always validate required ports before and after changes

## Related

- [[exam-topics#CLF-C02 -- Cloud Practitioner]] -- Domain 3: Cloud Technology and Services
- [[catalog]] -- ec2, vpc, cloudwatch service entries
