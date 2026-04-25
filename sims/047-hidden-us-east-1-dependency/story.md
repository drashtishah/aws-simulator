---
tags:
  - type/simulation
  - service/iam
  - service/sts
  - service/cloudfront
  - service/route53
  - service/s3
  - difficulty/professional
  - category/reliability
---

# The Region You Did Not Know You Lived In

## Opening

- company: Westmark Insights
- industry: B2B analytics platform for European retailers, GDPR + Schrems II compliance
- product: real-time inventory and footfall analytics dashboard for 320 mid-market retailers
- scale: ~14,000 customer queries per minute peak; primary region eu-west-1, DR practiced quarterly to eu-central-1
- time: Sunday, 23:14 UTC, two hours into a major AWS US-EAST-1 service event
- scene: the SRE on call has just confirmed via the AWS service health dashboard that us-east-1 is degraded across DynamoDB, IAM, EC2, Lambda, and ACM; eu-west-1 shows green
- alert: PagerDuty INC-20261019-2114 fires from a chained set of internal monitors:
  `westmark-cd: deploy to eu-west-1 failed: AssumeRole 5xx`
  `westmark-docs-cdn: 502 responses from origin`
  `westmark-support-bot: Slack reachability degraded`
  `westmark-iam: console login redirect failed`
- stakes: customers in EU are largely unaffected, but the team cannot deploy a critical customer fix that was scheduled for tonight; finance team in the office cannot log in; partners visiting docs.westmark-insights.com see a stale or broken page; a press release referencing the docs site goes out tomorrow morning
- early_signals:
  - customer-facing dashboard.westmark-insights.com is fully healthy; ALB target health is 100%
  - GitHub Actions deploy job is failing at the AssumeRole step with `EndpointConnectionError: Could not connect to the endpoint URL: https://sts.amazonaws.com/`
  - CloudWatch in eu-west-1 shows production metrics; CloudWatch in us-east-1 is sparse
  - the docs site briefly worked, then started returning 502s ~75 minutes into the outage
  - ACM in us-east-1 shows a renewal scheduled for tomorrow morning
- investigation_starting_point: the AWS Console (intermittent), AWS CLI from the SRE's workstation (working but with errors on STS-global calls), Westmark internal architecture diagrams

## Resolution

- root_cause: Westmark had correctly designed customer-facing data-plane independence from us-east-1, but five operational dependencies silently relied on us-east-1: the global STS endpoint, IAM Identity Center, ACM certificates for CloudFront, Lambda@Edge for the support bot, and a legacy S3 bucket holding the docs site that was created when the company was US-only
- mechanism: each of these services has its control plane (or sometimes its only existence) in us-east-1; STS global endpoint sts.amazonaws.com is a single anycast that routes to us-east-1 backends, so AssumeRole calls failed; IAM Identity Center config lives globally but is anchored in us-east-1, so federated console logins failed; ACM-for-CloudFront has a documented hard requirement that the certificate must be issued in us-east-1, so the team's ACM panel for the cert was unreachable; Lambda@Edge functions can only be created and updated in us-east-1 (they replicate to edge locations after); and the docs S3 bucket simply was in us-east-1 because the original team in 2022 was US-only and the bucket was never migrated
- fix: SRE switched the workstation AWS CLI to use regional STS endpoints (AWS_STS_REGIONAL_ENDPOINTS=regional), which let her call AssumeRole against sts.eu-west-1.amazonaws.com instead; deploys resumed; the docs site stayed degraded until us-east-1 recovered (no immediate fix because the CloudFront origin is in us-east-1); the support bot continued running at edge locations but could not be modified; engineers used pre-issued long-lived IAM access keys for emergency console-equivalent access via the CLI; once us-east-1 recovered, the team began a multi-month project to migrate the docs S3 bucket to eu-west-1, set up CloudFront origin failover, and document Lambda@Edge as inherently coupled to us-east-1
- contributing_factors:
  - the team's quarterly DR drills tested regional failover from eu-west-1 to eu-central-1 but never tested a us-east-1 outage scenario, because none of their data plane is in us-east-1
  - SDK config defaulted to the global STS endpoint because the workstation was set up before the regional-STS option became default
  - ACM-for-CloudFront and Lambda@Edge requirements were known to one engineer who had not documented them in the team architecture wiki
  - the docs S3 bucket migration had been on the backlog for two years but kept being deprioritized because nothing visibly required it
