---
tags:
  - type/simulation
  - service/bedrock
  - service/api-gateway
  - service/dynamodb
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# The Tenant Who Drank the Pool

## Opening

- company: Quirescript
- industry: B2B AI knowledge platform
- product: White-labeled AI assistants for enterprise teams; tenants point Quirescript at their docs and get a custom-branded assistant
- scale: 64 engineers, 87 enterprise tenants, top tier (10 tenants) average 50k requests/day, long tail averages 3k/day
- time: Tuesday 09:48 UTC, mid-morning peak across US and EU tenants
- scene: On-call platform engineer, slack channels for 41 tenants are simultaneously complaining about 429s
- alert: "quirescript-api: 5xx error rate 14.2% across all tenants"
- stakes: Two contracts up for renewal this quarter cite "five nines"; the head of customer success is on the bridge call; one tenant has explicitly threatened to leave over a previous reliability incident
- early_signals:
  - 5XX errors at the API Gateway layer are 14.2%, baseline 0.04%
  - 4XX errors (which would include API-Gateway-issued 429s) are at baseline
  - Per-key API Gateway throttle counters all show zero
  - Lambda invoke-model errors carry the message "ThrottlingException: Too many tokens, please wait before trying again"
  - Northwind Logistics backfill kicked off at 09:14 UTC, approved last week
- investigation_starting_point: All 87 tenants share one AWS account. They all hit the same Bedrock model (claude-sonnet-4-6) in us-east-1. API Gateway has a usage plan per tenant key with rate=200 rps and burst=400. The invoke-model Lambda is the path between the gateway and Bedrock. Each tenant's identity is in the request context but not in the IAM principal that calls Bedrock; the Lambda assumes one role for all tenants.

## Resolution

- root_cause: Bedrock's TPM quota for claude-sonnet-4-6 in us-east-1 is account-wide (4,000,000 tokens per minute). API Gateway usage plans throttle per-key by request rate, but they have no visibility into Bedrock token consumption. Northwind's approved backfill at 1,200 rps with ~500 tokens per call drives account TPM utilization to 98%; remaining headroom is consumed by normal traffic from other tenants; bursts push over the line and Bedrock returns ThrottlingException to whichever tenant happens to be calling at that millisecond.
- mechanism: At 09:14 Northwind's backfill begins. Their per-key API Gateway throttle is 200 rps; the backfill batches into 200-rps bursts and stays under the per-key cap. But each request consumes 500 tokens, so Northwind alone is burning ~600,000 TPM. Combined with 87 other tenants doing normal traffic (~3.2M TPM aggregate), account utilization climbs from 80% to 98% in 18 minutes. From 09:32 onward, every minute that the rolling sum exceeds 4M TPM produces a burst of ThrottlingException responses from Bedrock. The Lambda surfaces these as 5xx to the calling tenant. Northwind itself rarely sees throttling because their requests come in steady streams that the rolling window absorbs; smaller tenants whose requests land at peak moments take the hit.
- fix: Two-stage. (1) Temporary stop-bleed: pause Northwind's backfill (their batch processor accepts a pause signal). Account TPM falls to 65% within 60 seconds; Bedrock throttling stops; other tenants recover. (2) Structural: deploy a per-tenant token-aware rate limiter in the invoke-model Lambda. The limiter tracks tokens consumed per tenant in a sliding 60-second window stored in DAX-fronted DynamoDB. Each tenant gets a per-tenant cap of 400,000 TPM. Northwind's backfill is permitted to resume but is throttled at the application layer when it hits its own cap, so it can no longer starve others. For headroom, switch the invoke-model Lambda to use a Geographic cross-region inference profile (us-east-1 + us-west-2 + us-east-2), tripling effective capacity. Northwind is moved to Provisioned Throughput (15 model units, dedicated 750k TPM) so future backfills do not contend with on-demand at all.
- contributing_factors:
  - The platform was designed with API Gateway usage plans as the only fairness layer; nobody owned token-level fairness
  - The Northwind backfill was approved by sales without involving capacity engineering; the only review was around per-key rate, not aggregate token consumption
  - There was no alarm on Bedrock EstimatedTPMQuotaUsage; the team only had alarms on API Gateway 4XX rates
  - The invoke-model Lambda assumed a single IAM role for all tenants, so Bedrock's CloudTrail and invocation logs could not directly attribute tokens to tenants without joining to API Gateway logs
  - us-east-1 was the only region in use; cross-region inference profiles had not been adopted
