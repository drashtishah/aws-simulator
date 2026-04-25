---
tags:
  - type/resolution
  - service/iam
  - service/sts
  - service/cloudfront
  - service/route53
  - service/s3
  - difficulty/professional
  - category/reliability
---

# Resolution: The Region You Did Not Know You Lived In

## Root Cause

Westmark Insights designed its customer-facing data plane to be regionally independent: ECS Fargate, Aurora, and an ALB all live in eu-west-1, with a quarterly-tested DR plan to eu-central-1. During the October 19 us-east-1 service event, this customer-facing data plane stayed fully healthy.

What failed was a layer of operational dependencies that the team did not realize had implicit us-east-1 anchoring:

1. **CD pipeline AssumeRole calls**: GitHub Actions used the AWS CLI's default endpoint configuration. The default for STS is the global endpoint `sts.amazonaws.com`, which is an anycast routed to us-east-1 backends. When us-east-1 STS was unreachable, every `AssumeRole` call failed with `EndpointConnectionError`.
2. **IAM Identity Center for console login**: Identity Center is configured per-region in the console, but its global control plane lives in us-east-1. Federated console logins rely on this control plane to issue session credentials. Existing sessions continued working until expiry; new sign-ins failed.
3. **ACM certificate for the docs CloudFront distribution**: AWS requires that ACM certificates used by CloudFront be issued in us-east-1, regardless of where the distribution serves traffic. This is documented in the CloudFront User Guide and is a hard platform requirement, not a configuration choice. The team's certificate was scheduled to auto-renew during the outage window; the renewal failed because ACM in us-east-1 was unreachable.
4. **Lambda@Edge function for the support Slack bot**: Lambda@Edge functions can only be created and updated in us-east-1; the Lambda runtime replicates them to edge locations worldwide. Existing replicated copies kept running, but the function could not be deployed, updated, or rolled back during the outage.
5. **Legacy docs S3 bucket in us-east-1**: The `westmark-docs-static` bucket was created in 2022 when the company was a US-only startup. It was never migrated when the company moved its primary infrastructure to eu-west-1. The bucket was the origin for the docs CloudFront distribution. CloudFront cache hits continued serving stale content for ~75 minutes; after that, cache misses started returning 502 because the origin was unreachable.

This is the cross-cutting customer-side lesson from the 2017, 2021, and 2025 us-east-1 outages: any AWS architecture, no matter how regionally distributed, has implicit us-east-1 dependencies through global services, certificate requirements, Lambda@Edge, and historical artifacts. Quarterly regional failover drills do not exercise them because the failover practice runs entirely within the customer's primary region pair.

## Timeline

| Time (UTC) | Event |
|---|---|
| 21:14 | AWS US-EAST-1 service event begins (DynamoDB DNS race) |
| 21:14 | Westmark customer-facing data plane in eu-west-1: unaffected |
| 21:18 | First failed CD deploy: AssumeRole returns 5xx |
| 21:42 | Engineers cannot log in to AWS console (Identity Center degraded) |
| 22:29 | Docs CloudFront starts returning 502 as cache hits expire |
| 22:43 | ACM cert auto-renewal job fires and fails |
| 22:50 | Support Slack bot continues running but cannot be updated |
| 23:14 | PagerDuty INC fires; SRE on call begins investigation |
| 23:31 | SRE identifies STS global endpoint as the CD failure cause |
| 23:33 | Workstation switched to AWS_STS_REGIONAL_ENDPOINTS=regional |
| 23:35 | First successful AssumeRole via sts.eu-west-1.amazonaws.com |
| 23:42 | Manual deploy completed using regional STS path |
| ~12 hours | us-east-1 recovers; ACM, S3, Identity Center, Lambda@Edge follow |

## Correct Remediation

1. **Inventory implicit us-east-1 dependencies.** Run a scripted or mental audit:
   - Any code or CLI session that calls `sts.amazonaws.com` (the global endpoint).
   - Any ACM certificate used by a CloudFront distribution.
   - Any Lambda@Edge function.
   - Any S3 bucket in us-east-1 referenced by a non-us-east-1 service.
   - IAM Identity Center deployment (always anchored in us-east-1).
   - Route 53 health checks (the Route 53 service is global but health checkers run from us-east-1).
2. **Switch SDK and CLI clients to regional STS endpoints.** For the AWS CLI: `aws configure set sts_regional_endpoints regional` or set `AWS_STS_REGIONAL_ENDPOINTS=regional` in the environment. For SDKs, set the equivalent client config option (e.g., `region_set` in boto3 falls back to `regional`; the v2 AWS SDK for JavaScript defaults to regional). The STS endpoint then becomes `sts.<region>.amazonaws.com`. Note: this does not change the IAM control plane (which still lives in us-east-1), only the STS API call routing.
3. **Pre-issue and cache CloudFront certificates with margin.** ACM auto-renewal is a control-plane operation. For mission-critical certs, issue them with a long validity period from a public CA outside ACM, or pre-renew at least two months before any planned us-east-1 maintenance window. Document the renewal date and the fact that ACM-for-CloudFront cannot be worked around regionally.
4. **Document Lambda@Edge as inherently coupled to us-east-1.** The function continues running at edge locations during a us-east-1 outage, but cannot be updated. For functions on the customer hot path, treat the Lambda@Edge deploy as a separate mini-region with its own freeze window during any us-east-1 incident.
5. **Migrate legacy S3 buckets out of us-east-1** if they are origins for non-us-east-1 services. The docs bucket should live in eu-west-1, and CloudFront should have origin failover to a us-east-1 replica via S3 Cross-Region Replication for resilience. The CloudFront distribution itself is global and does not need to be moved.
6. **Add a us-east-1-aware runbook entry.** List every operational path that depends on us-east-1 (CD deploys, console login, ACM cert ops, Lambda@Edge deploys, S3 in us-east-1) and the manual workaround for each (use regional STS, defer non-critical deploys, use pre-issued long-lived IAM access keys for emergency console-equivalent access via CLI).
7. **Test with a chaos exercise.** Schedule a quarterly drill where IAM Identity Center is simulated unreachable and the global STS endpoint returns 5xx. Verify the team can still operate the data plane via regional STS plus pre-issued credentials. Quarterly regional failover drills do not exercise this dimension; the chaos exercise does.

## Key Concepts

### Global services and their us-east-1 anchoring

A handful of AWS services have control planes that live in us-east-1 even though they appear "regionless" in the console. The most operationally significant:

- **IAM**: the IAM control plane (CreateRole, AttachPolicy, etc.) lives in us-east-1. IAM data-plane (credential validation for actual API calls) is replicated across regions, so a running EC2 instance with cached credentials continues working during a us-east-1 outage.
- **Global STS endpoint (`sts.amazonaws.com`)**: a single endpoint that routes to us-east-1. Newer SDKs default to regional STS endpoints (`sts.<region>.amazonaws.com`); older code and the AWS CLI sometimes still use the global one.
- **CloudFront**: the distribution is global, but the management API (CreateDistribution, UpdateDistribution) is anchored in us-east-1.
- **ACM certificates for CloudFront**: must be issued in us-east-1 specifically. This is a documented platform requirement, not a configuration choice.
- **Lambda@Edge**: functions can only be created in us-east-1; the runtime then replicates them to all CloudFront edge locations. Updates require a deploy in us-east-1.
- **Route 53**: the service is global, but health checkers run from a small set of regions including us-east-1.
- **AWS Organizations and Control Tower**: management account operations live in us-east-1.
- **Billing**: all account-level billing data is in us-east-1.

A multi-region architecture is regional only at the data plane. The control plane has implicit us-east-1 dependencies that surface during a us-east-1 outage.

### Static stability as a design principle

Static stability is the property that a running system continues to operate even when its dependencies (especially the control plane) are unavailable. Common patterns:

- **Pre-warm capacity**: scale up before a planned maintenance window so no scale-out is needed during the outage.
- **Cache credentials**: short-lived credentials in flight continue working until expiry; the system does not need to call STS during the outage.
- **Pre-issue certificates**: certificates that auto-renew during the outage will fail to renew; pre-issue with margin.
- **Avoid deploys**: a freeze window during the outage prevents new deploys from being attempted (and failing) at a moment when the team's attention is on incident response.
- **Document control-plane dependencies**: the runbook for any incident should include a section on which control-plane operations are degraded and what manual workarounds exist.

The 2025 us-east-1 outage made this principle famous because many customers discovered, in real time, that their "multi-region" architectures had implicit us-east-1 control-plane dependencies they had never inventoried.

### Regional STS endpoints in practice

The fix is small. For the AWS CLI:

```
aws configure set sts_regional_endpoints regional
# OR set in the environment:
export AWS_STS_REGIONAL_ENDPOINTS=regional
```

For boto3 (Python):

```python
import boto3
sts = boto3.client('sts', endpoint_url='https://sts.eu-west-1.amazonaws.com')
# OR rely on the regional endpoint default (boto3 1.28+):
session = boto3.Session(region_name='eu-west-1')
sts = session.client('sts')
```

For the AWS SDK for JavaScript v3, regional endpoints are the default since v3.0; for v2, set `AWS.config.update({region: 'eu-west-1', stsRegionalEndpoints: 'regional'})`.

This change does not move the IAM control plane (which still lives in us-east-1). It only changes where the `AssumeRole` API call lands. For the duration of a us-east-1 outage, this is enough to keep CD pipelines and any STS-dependent code path working.

## Other Ways This Could Break

### Aurora Global Database write forwarding through us-east-1
The data plane appears multi-region, but writes from secondary regions are forwarded to the primary writer via a single endpoint. If the primary region is down, secondaries can read but cannot write.
**Prevention:** Use Aurora Global Database with managed planned failover so a secondary can be promoted in seconds. Document the RTO and RPO. For unplanned failover, accept some data loss in exchange for rapid promotion.

### CloudWatch cross-region dashboards depend on the source region
Operators in eu-west-1 trying to view us-east-1 metrics during the outage get partial data or none. Affects observability, not availability.
**Prevention:** Replicate critical metrics into the operating region via CloudWatch metric streams; rely on the regional dashboard during cross-region incidents.

### AWS Secrets Manager replicas drift because the source region is unreachable
Replicas continue serving stale secrets; rotations cannot complete because the rotation Lambda needs to reach the source region's primary secret.
**Prevention:** Use multi-region secrets with replicate-on-write; set the operating region as the primary, not the corporate-default region. Pre-issue any time-bound credentials with margin.

## SOP Best Practices

- **Treat us-east-1 as a hidden dependency for any multi-region architecture.** The data plane can be regional; the control plane and a small set of global services are not. Map them explicitly.
- **Switch all SDK and CLI clients to regional STS endpoints by default.** This is a one-line config change that removes the most common implicit us-east-1 dependency. Set it at the SDK level so it is uniform across all team services.
- **Maintain a us-east-1-aware operations runbook.** List every operational path that depends on us-east-1 and the manual workaround for each. Refresh quarterly; new AWS services often add new dependencies.
- **Practice with chaos drills, not just failover drills.** A scheduled exercise where IAM Identity Center is unreachable surfaces dependencies that quarterly regional failover drills miss because regional failover does not exercise the cross-cutting global services.

## Learning Objectives

1. **Global vs regional services**: Know which AWS services have implicit us-east-1 control-plane dependencies and how to identify them in your own architecture.
2. **Static stability**: Design the running system to keep working even when its control plane is unavailable; the data plane and the control plane have different availability characteristics.
3. **Regional STS endpoints**: Make the one-line config change to use `sts.<region>.amazonaws.com` instead of the global endpoint.
4. **Operational runbooks for cross-region incidents**: Inventory and document the paths that depend on us-east-1; chaos-test them; do not rely on quarterly regional failover drills to surface them.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 1: Design for Organizational Complexity
- [[exam-topics#ANS-C01 -- Advanced Networking Specialty]] -- Domain 5: Network Security, Compliance, and Governance
- [How to use Regional AWS STS endpoints](https://aws.amazon.com/blogs/security/how-to-use-regional-aws-sts-endpoints/)
- [How to Prevent Crippling Your Infrastructure When AWS US-EAST-1 Fails](https://medium.com/datamindedbe/how-to-prevent-crippling-your-infrastructure-when-aws-us-east-1-fails-13c200364b9e) -- post-2025-outage analysis
