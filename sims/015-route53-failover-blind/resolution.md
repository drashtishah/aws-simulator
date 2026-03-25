---
tags:
  - type/resolution
  - service/route53
  - service/elb
  - service/cloudwatch
  - difficulty/associate
  - category/networking
---

# Resolution: Sixteen Seconds of Nothing

## Root Cause

The Route 53 failover routing policy for `docs.spellbook.dev` had two compounding misconfigurations. First, the associated health check was configured to use HTTP on port 80 with a resource path of `/`, but the primary ALB only listens on HTTPS port 443 and the application returns a 301 redirect on `/`. The health check had been in UNHEALTHY state since March 4th. Second, the primary failover record set had `EvaluateTargetHealth` set to `false`, so Route 53 never used the health check result when deciding whether to route traffic to the primary or secondary endpoint. When the us-east-1 ALB experienced an actual outage, DNS failover did not trigger.

## Timeline

| Time | Event |
|---|---|
| 2025-09-25, 14:00 UTC | SRE team creates multi-region failover setup with Route 53, health check configured on port 80 HTTP |
| 2026-03-04, ~08:00 UTC | Health check transitions to UNHEALTHY (port 80 never responded correctly); CloudWatch alarm enters ALARM state |
| 2026-03-04 to 2026-03-25 | Health check remains UNHEALTHY for three weeks; alarm in ALARM state; no notifications sent |
| 2026-03-25, 13:32 UTC | AZ degradation in us-east-1 begins; primary ALB target group loses healthy targets |
| 2026-03-25, 13:34 UTC | Primary ALB returns 503 for all requests; Route 53 continues routing to primary (EvaluateTargetHealth: false) |
| 2026-03-25, 14:14 UTC | First customer report via Slack: "docs.spellbook.dev is not loading" |
| 2026-03-25, 14:18 UTC | On-call SRE confirms primary ALB unreachable, secondary ALB healthy |
| 2026-03-25, 14:26 UTC | SRE identifies Route 53 health check in UNHEALTHY state since March 4th |
| 2026-03-25, 14:31 UTC | SRE identifies EvaluateTargetHealth: false on primary failover record |
| 2026-03-25, 14:38 UTC | Manual DNS update to point traffic to eu-west-1 ALB; service restored |
| 2026-03-25, 15:10 UTC | Health check updated to HTTPS port 443, path /healthz; EvaluateTargetHealth set to true |

## Correct Remediation

1. **Immediate**: Manually update the Route 53 record to point to the healthy eu-west-1 ALB to restore service
2. **Fix health check**: Update the health check configuration to use HTTPS, port 443, and a path that returns HTTP 200 (e.g., `/healthz`)
3. **Enable failover**: Set `EvaluateTargetHealth` to `true` on the primary failover record set so Route 53 acts on health check results
4. **Fix monitoring**: Attach an SNS topic to the CloudWatch alarm on `HealthCheckStatus` that pages the on-call engineer
5. **Validate**: Run a failover test by temporarily making the health check fail and confirming Route 53 switches to the secondary record
6. **Process**: Add disaster recovery testing to the quarterly runbook -- simulate a primary region failure and verify failover completes

## Key Concepts

### Route 53 Failover Routing Policy

Route 53 failover routing uses two record sets for the same domain name: a primary and a secondary. When the primary is healthy, all DNS queries resolve to the primary. When the primary becomes unhealthy, Route 53 returns the secondary record instead. The health determination depends on two mechanisms: an associated Route 53 health check, and the `EvaluateTargetHealth` setting on the record set. Both must be correctly configured for failover to work.

### Health Check Configuration

Route 53 health checks send requests from multiple global checker locations to the specified endpoint. The health check configuration includes:

- **Protocol**: HTTP, HTTPS, or TCP. Must match the target's listener protocol.
- **Port**: The port to connect to. Must match the port the target actually listens on.
- **Resource Path**: For HTTP/HTTPS checks, the URL path to request. The target must return a 2xx or 3xx status code (configurable). A 301 redirect counts as a failure if the health check is not configured to follow redirects.
- **Failure Threshold**: Number of consecutive failures before marking unhealthy (default 3).

A health check that has been UNHEALTHY since creation indicates a configuration error, not an endpoint problem.

### EvaluateTargetHealth

The `EvaluateTargetHealth` property on a Route 53 alias record set controls whether Route 53 checks the health of the resource that the alias points to. When set to `false`, Route 53 always considers the record healthy regardless of the actual state of the target resource or any associated health check. For failover routing policies, this property must be `true` on the primary record for Route 53 to fail over to the secondary when the primary endpoint is unhealthy.

## AWS Documentation Links

- [Route 53 Failover Routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-failover.html)
- [Route 53 Health Checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating.html)
- [Route 53 Health Check Types](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-types.html)
- [EvaluateTargetHealth for Alias Records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-alias.html#rrsets-values-alias-evaluate-target-health)
- [CloudWatch Metrics for Route 53 Health Checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/monitoring-health-checks.html)

## Learning Objectives

1. **Health check alignment**: Route 53 health checks must match the actual listener configuration of the target resource -- correct protocol, port, and a path that returns a 2xx response
2. **EvaluateTargetHealth**: Failover routing only works when EvaluateTargetHealth is enabled on the primary record set; without it, Route 53 treats the primary as always healthy
3. **Alarm actionability**: A CloudWatch alarm with no notification action is invisible; health check monitoring must page the on-call team on state changes, not silently sit in ALARM

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- route53, elb, cloudwatch service entries
