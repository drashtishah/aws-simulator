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

1. **Immediate**: Add a firewall rule to the security group (sg-0a1b2c3d4e5f67890) that allows incoming web traffic. Specifically, allow TCP traffic on port 443 (the standard port for HTTPS -- secure web connections) from 0.0.0.0/0 (all IPv4 addresses) and ::/0 (all IPv6 addresses). Security group changes take effect instantly -- no server restart needed.
2. **Verification**: Confirm the application is reachable again by checking that health checks pass and the site loads from an external browser.
3. **Prevention**: Create a runbook (a documented checklist) listing every port that each production service needs open, along with the reason each port is required. Reference this list before and after any firewall changes.
4. **Detection**: Set up a CloudWatch alarm on the `StatusCheckFailed` metric with a 1-minute evaluation period. CloudWatch alarms watch a metric and notify your team when something crosses a threshold -- this reduces the time between an outage starting and someone knowing about it.
5. **Process**: Require a second engineer to review any production firewall changes before they are applied. Test changes in a staging environment (a copy of production used for safe testing) first.

## Key Concepts

### Security Groups -- Your Server's Firewall

A security group is a virtual firewall that wraps around your server (EC2 instance) and controls what network traffic can reach it. Think of it as a bouncer at a door -- only traffic that matches a rule on the guest list gets in.

- **Default deny**: If no rule explicitly allows traffic, it is silently dropped. There is no way to write a "block this" rule -- you only write "allow this" rules. Everything else is blocked automatically.
- **Stateful**: If a rule lets a request in, the response is automatically allowed out. You do not need a separate outbound rule for replies. This is what "stateful" means -- the firewall remembers the conversation.
- **Immediate effect**: Changes apply the moment you save them. No server restart needed.
- **Multiple groups**: A server can have up to five security groups attached. AWS combines all their rules together -- if any group allows the traffic, it gets through.

### Security Groups vs Network ACLs -- Two Layers of Firewall

AWS gives you two firewalls. Security groups wrap individual servers and are stateful (they remember connections). Network ACLs (Access Control Lists) wrap an entire subnet (a section of your network) and are stateless -- you must write separate rules for traffic going in and coming out. In this incident, the Network ACL was fine. The security group was the one blocking traffic.

### CloudWatch Instance Metrics -- What They Do and Do Not Tell You

EC2 instances report two built-in health metrics: `StatusCheckFailed_Instance` (checks if the operating system is responsive) and `StatusCheckFailed_System` (checks if the underlying hardware is working). These only tell you whether the machine is running -- they do not tell you whether users can actually reach your application. To detect network-level or application-level problems, you need a custom health check or a load balancer health check that tests the application from the outside.

## Other Ways This Could Break

### Network ACL deny rule blocks port 443
Instead of the security group (the firewall around the server), the problem is in the Network ACL -- a separate firewall that protects the entire subnet (a section of your network). Network ACLs evaluate rules in numbered order, and a deny rule with a lower number than an allow rule wins. Unlike security groups, Network ACLs are stateless, meaning you need separate rules for traffic going in and coming out. The security group would look fine, making this harder to spot.
**Prevention:** After any changes, review Network ACL rules to make sure allow rules for required ports have lower rule numbers than deny rules. Turn on VPC Flow Logs (a feature that records which traffic was accepted or rejected) to see exactly where traffic is being blocked.

### Route table missing default route to Internet Gateway
Every subnet has a route table that tells traffic where to go. If the route table loses its default route -- the entry (0.0.0.0/0) that sends internet-bound traffic to the Internet Gateway (the door between your virtual network and the internet) -- all internet traffic stops reaching the subnet. Not just one port, but everything. The server also loses its ability to reach the internet, which distinguishes this from a security group issue.
**Prevention:** Label production route tables clearly and use AWS Config rules (automated compliance checks) to detect when a public subnet's route table is missing its default route to the Internet Gateway.

### Elastic IP or public IP disassociated from instance
Every server that needs to be reached from the internet must have a public IP address. If the public IP gets removed, the server becomes unreachable on all ports -- not just one. You can spot this by checking the instance details: the public IP field will be empty.
**Prevention:** Use an Elastic IP (a permanent public IP address that you own and control) for production servers instead of auto-assigned public IPs that can change. Set up a CloudWatch alarm to alert if a production server loses its public IP.

### Security group connection tracking limit exceeded
The firewall rules are correct, but the server is handling so many simultaneous connections that it hits a built-in limit on how many connections the security group can track at once. This causes intermittent timeouts under heavy load rather than a complete outage. You can spot this by checking ENA driver metrics (network card statistics) for a counter called conntrack_allowance_exceeded going up.
**Prevention:** Monitor connection tracking metrics from the network card. If you are hitting limits, move to a larger server type that supports more connections, or adjust security group rules to reduce tracking overhead.

## SOP Best Practices

- Before and after changing any firewall rules, check them against a documented list of ports your application needs to be reachable on. Automate this check in your deployment pipeline (CI/CD) so human error cannot skip it.
- Test firewall changes in a staging environment (a copy of your production setup used for testing) before applying them to the real production servers. The staging network layout should match production so the test is meaningful.
- Turn on VPC Flow Logs for your production subnets. Flow Logs record every connection attempt and whether it was accepted or rejected. When something goes wrong, these logs let you quickly see where traffic is being blocked instead of guessing.
- Set up CloudWatch alarms that check whether your application is reachable from outside your network -- not just whether the server is running. Instance status checks only confirm the machine is on; they do not catch firewall misconfigurations that block user traffic.

## Learning Objectives

1. **Security group mechanics**: Understand that security groups are default-deny, stateful firewalls that control traffic at the instance level
2. **Troubleshooting connectivity**: When an instance is running but unreachable, check security group inbound rules for the required port
3. **Change management**: Security group modifications take effect immediately -- always validate required ports before and after changes

## Related

- [[exam-topics#CLF-C02 -- Cloud Practitioner]] -- Domain 3: Cloud Technology and Services
- [[catalog]] -- ec2, vpc, cloudwatch service entries
