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

## Other Ways This Could Break

### Network ACL deny rule blocks port 443
Instead of the security group, a Network ACL deny rule with a lower rule number than the allow rule blocks HTTPS traffic at the subnet level. Because NACLs are stateless, both inbound and outbound rules must be checked. The security group would look correct in this case, making the problem harder to spot.
**Prevention:** Audit NACL rules after changes and ensure allow rules for required ports have lower rule numbers than any broad deny rules. Use VPC Flow Logs to confirm where traffic is being rejected.

### Route table missing default route to Internet Gateway
The public subnet route table loses its 0.0.0.0/0 route pointing to the Internet Gateway. All internet traffic stops reaching the subnet entirely -- not just one port. The instance also loses outbound internet access, which distinguishes it from a security group issue.
**Prevention:** Tag production route tables and use AWS Config rules to detect when a public subnet route table lacks a default route to an Internet Gateway.

### Elastic IP or public IP disassociated from instance
The instance loses its public IP address, so DNS resolution or direct IP access fails. Unlike a security group issue, the instance becomes unreachable on all ports, and the public IP no longer appears in describe-instances output.
**Prevention:** Use Elastic IPs for production instances instead of auto-assigned public IPs. Set up CloudWatch alarms to alert when a production instance has no associated public IP.

### Security group connection tracking limit exceeded
The security group rules are correct, but the instance has too many concurrent tracked connections and starts dropping new ones. Symptoms appear as intermittent timeouts under high load rather than a complete outage. ENA driver metrics show conntrack_allowance_exceeded incrementing.
**Prevention:** Monitor conntrack_allowance_available via ENA driver metrics. Scale to a larger instance type for higher connection tracking limits, or configure security group rules to avoid tracking where possible.

## SOP Best Practices

- Always validate security group rules against a documented list of required application ports before and after any modification -- automate this check in CI/CD pipelines.
- Test security group changes in a staging environment that mirrors production network topology before applying them to production.
- Enable VPC Flow Logs on production subnets to provide an audit trail of accepted and rejected traffic, which accelerates root-cause analysis during connectivity incidents.
- Set up CloudWatch alarms on external reachability probes (not just instance status checks) so that network-level outages are detected within minutes, not hours.

## Learning Objectives

1. **Security group mechanics**: Understand that security groups are default-deny, stateful firewalls that control traffic at the instance level
2. **Troubleshooting connectivity**: When an instance is running but unreachable, check security group inbound rules for the required port
3. **Change management**: Security group modifications take effect immediately -- always validate required ports before and after changes

## Related

- [[exam-topics#CLF-C02 -- Cloud Practitioner]] -- Domain 3: Cloud Technology and Services
- [[catalog]] -- ec2, vpc, cloudwatch service entries
