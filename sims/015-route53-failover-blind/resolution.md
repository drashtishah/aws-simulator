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

## Other Ways This Could Break

### Health check passes but EvaluateTargetHealth is false

The health check is correctly configured and reports HEALTHY when the primary is up. But because EvaluateTargetHealth is false on the alias record, Route 53 ignores the health check entirely. When the primary goes down, the health check transitions to UNHEALTHY but Route 53 never reads that value. The symptoms during an outage are identical, but the health check history looks normal until the actual failure. Prevention: always set EvaluateTargetHealth to true on failover alias records and use AWS Config rules to detect records with it set to false.

### DNS TTL caching delays failover

Route 53 correctly detects the primary is unhealthy and starts returning the secondary in DNS responses. But recursive resolvers and client-side DNS caches hold the old primary IP address until the TTL expires. Users continue hitting the dead primary for the duration of the TTL. The root cause is not a failover misconfiguration but an excessively high TTL on the failover record. Prevention: set failover record TTL to 60 seconds or less and test failover end-to-end including DNS propagation delay.

### Health check region selection causes false positives

The health check is configured with a limited set of checker regions. If the primary ALB is experiencing a regional network partition, health checkers in unaffected regions may still reach the ALB and report HEALTHY while actual users cannot. Failover does not trigger because the majority of checkers see the endpoint as healthy. Prevention: use the default set of health check regions (all available) rather than restricting to a few, and monitor HealthCheckPercentageHealthy in CloudWatch to detect partial reachability.

### Secondary region is unhealthy when failover triggers

Route 53 correctly detects the primary is down and fails over. But the secondary region has its own issues -- stale deployment, expired TLS certificate, or cold-start database replica lag. Traffic moves to the secondary but users still get errors. DNS failover worked, but the standby was not actually ready to serve production traffic. Prevention: run continuous health checks against the secondary endpoint, include the secondary in regular deployments and load testing, and add a health check to the secondary failover record set.

## SOP Best Practices

- Route 53 health checks must match the target's actual listener configuration: correct protocol (HTTP vs HTTPS), correct port, and a path that returns HTTP 200 -- not a redirect.
- Always set EvaluateTargetHealth to true on failover alias records. Without it, Route 53 treats the primary as permanently healthy and failover can never trigger.
- Every CloudWatch alarm must have at least one action (SNS topic) that reaches a human. An alarm with no subscribers is invisible.
- Test disaster recovery end-to-end on a regular schedule. Simulate a primary region failure and verify that DNS failover completes, the secondary serves traffic, and the on-call team is notified.

## Learning Objectives

1. **Health check alignment**: Route 53 health checks must match the actual listener configuration of the target resource -- correct protocol, port, and a path that returns a 2xx response
2. **EvaluateTargetHealth**: Failover routing only works when EvaluateTargetHealth is enabled on the primary record set; without it, Route 53 treats the primary as always healthy
3. **Alarm actionability**: A CloudWatch alarm with no notification action is invisible; health check monitoring must page the on-call team on state changes, not silently sit in ALARM

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- route53, elb, cloudwatch service entries
