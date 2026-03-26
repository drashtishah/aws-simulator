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

1. **Restore service immediately**. Manually update the Route 53 DNS record to point traffic to the healthy backup load balancer in eu-west-1. This gets the documentation site back online while you fix the underlying configuration.
2. **Fix the health check so it tests the right thing**. The health check was probing HTTP on port 80, but the load balancer only listens on HTTPS port 443. And the URL path `/` returns a redirect (301), which counts as a failure. Update the health check to use HTTPS, port 443, and a path that returns a 200 success response (for example, `/healthz`).
3. **Enable failover so Route 53 actually acts on health check results**. The setting `EvaluateTargetHealth` on the primary failover record was set to `false`, which told Route 53 to always consider the primary healthy -- regardless of reality. Set it to `true` so Route 53 will switch to the backup when the primary is unhealthy.
4. **Connect the alarm to a notification channel**. The CloudWatch alarm on `HealthCheckStatus` has been firing for three weeks, but nobody knew because no notification target was attached. Create an SNS topic (a messaging channel), subscribe the on-call engineer, and attach it to the alarm so health check failures reach a human.
5. **Test the failover end-to-end**. Temporarily simulate a primary failure and confirm that Route 53 starts returning the backup load balancer's address. Also confirm the alarm sends a notification to the on-call engineer.
6. **Add disaster recovery testing to the regular schedule**. Schedule a quarterly failover test so the team verifies the backup region is working before they need it during a real outage.

## Key Concepts

### How DNS failover works in Route 53

Route 53 is AWS's domain name system (DNS) service -- it translates human-readable domain names like `docs.spellbook.dev` into server addresses that computers use. Failover routing uses two records for the same domain name: a primary and a secondary (backup). Under normal conditions, when someone looks up the domain, Route 53 returns the primary server's address. When the primary becomes unhealthy, Route 53 returns the backup server's address instead.

For this to work, two things must be correctly configured: (1) a health check that actually tests the primary endpoint, and (2) the `EvaluateTargetHealth` setting must be turned on so Route 53 pays attention to the health check result. If either piece is broken, failover never triggers.

### How health checks determine if an endpoint is alive

Route 53 health checks send automated test requests from multiple locations around the world to your endpoint at regular intervals. The health check configuration includes:

- **Protocol**: HTTP, HTTPS, or TCP. This must match how your load balancer or server actually accepts connections. If the server expects HTTPS, checking with HTTP will fail.
- **Port**: The port number to connect to. This must match the port the server actually listens on (for example, 443 for HTTPS).
- **Resource Path**: For HTTP/HTTPS checks, the URL path to request (for example, `/healthz`). The server must return a success response (2xx status code). A redirect response (301) counts as a failure unless the health check is specifically configured to follow redirects.
- **Failure Threshold**: How many consecutive failures before the endpoint is marked unhealthy (default: 3).

A health check that has been UNHEALTHY ever since it was created is almost always a configuration error -- it means the check was set up to probe the wrong protocol, port, or path, not that the actual endpoint is down.

### The EvaluateTargetHealth switch: connecting health checks to routing decisions

`EvaluateTargetHealth` is a boolean (true/false) setting on a Route 53 alias record. It controls whether Route 53 checks the health of the resource the record points to. When set to `false`, Route 53 always considers the record healthy, no matter what the health check says or what state the actual endpoint is in. This effectively disables failover.

For failover routing to work, this setting must be `true` on the primary record. Without it, Route 53 will keep sending all traffic to the primary even when it is completely down, because Route 53 believes it is healthy.

## Other Ways This Could Break

### Health check works correctly, but Route 53 ignores it because EvaluateTargetHealth is turned off

In this scenario, the health check itself is configured properly -- right protocol, right port, right path. It reports HEALTHY when the primary is up. But the DNS failover record has EvaluateTargetHealth set to false, so Route 53 never looks at the health check result when deciding where to send traffic. When the primary goes down, the health check correctly switches to UNHEALTHY, but Route 53 does not care. The outage looks identical to this sim, but the health check history looks normal until the real failure happens. Prevention: always set EvaluateTargetHealth to true on failover alias records. Use AWS Config rules (automated compliance checks) to detect any records where this setting is turned off.

### DNS caching delays the failover even after Route 53 switches

Route 53 correctly detects the primary is down and starts returning the backup's address in DNS responses. But internet DNS resolvers and users' computers have cached the old (primary) address and will keep using it until the cache expires. This expiration time is called the TTL (Time to Live). Users keep hitting the dead primary for the entire TTL duration, even though Route 53 has already switched. The failover itself worked -- the delay is caused by stale cached DNS entries on the internet. Prevention: set the failover record's TTL to 60 seconds or less so caches expire quickly. Test failover end-to-end to measure the actual recovery time including DNS propagation.

### Health check only runs from a few locations and misses a regional outage

The health check is configured to probe from only a few geographic locations. If the primary load balancer is experiencing a network problem in one region, checkers in unaffected regions may still reach it and report HEALTHY. Actual users in the affected region cannot reach the site, but failover does not trigger because the majority of checkers see the endpoint as alive. Prevention: use the default set of health check regions (all available locations) rather than limiting to a few. Monitor the HealthCheckPercentageHealthy metric in CloudWatch to spot cases where some checkers succeed while others fail.

### The backup region has its own problems when traffic arrives

Route 53 correctly detects the primary is down and sends traffic to the backup. But the backup region is not actually ready -- maybe it has a stale code deployment, an expired security certificate, or a database that has not caught up with recent changes. Users get errors in the backup region too. The DNS failover worked, but the standby was never truly production-ready. Prevention: run continuous health checks against the backup endpoint too. Include the backup region in regular code deployments and load testing. Add a health check to the secondary failover record so Route 53 knows if the backup is also unhealthy.

## SOP Best Practices

- The Route 53 health check must test the same protocol, port, and URL path that the actual load balancer uses. If the load balancer listens on HTTPS port 443, the health check must probe HTTPS port 443. And the URL path must return a 200 success response -- a redirect (301) counts as a failure and will make the health check report UNHEALTHY even when the endpoint is working fine.
- Always set EvaluateTargetHealth to true on failover alias records. This is the switch that tells Route 53 to actually look at health check results when deciding where to send traffic. Without it, Route 53 treats the primary as permanently healthy, and the backup will never receive traffic automatically, no matter how broken the primary is.
- Every CloudWatch alarm must be connected to a notification channel (an SNS topic) that reaches a real person. An alarm that fires but does not notify anyone is invisible. It is the same as having no alarm at all. In this sim, the alarm was in ALARM state for three weeks and nobody knew.
- Test your disaster recovery setup end-to-end on a regular schedule. Simulate a primary region failure and verify three things: (1) DNS failover completes and Route 53 starts returning the backup's address, (2) the backup region actually serves traffic correctly, and (3) the on-call team receives a notification.

## Learning Objectives

1. **Health check alignment**: Route 53 health checks must match the actual listener configuration of the target resource -- correct protocol, port, and a path that returns a 2xx response
2. **EvaluateTargetHealth**: Failover routing only works when EvaluateTargetHealth is enabled on the primary record set; without it, Route 53 treats the primary as always healthy
3. **Alarm actionability**: A CloudWatch alarm with no notification action is invisible; health check monitoring must page the on-call team on state changes, not silently sit in ALARM

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- route53, elb, cloudwatch service entries
