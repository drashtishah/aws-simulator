---
tags:
  - type/resolution
  - service/bedrock
  - service/api-gateway
  - service/dynamodb
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# Resolution: The Tenant Who Drank the Pool

## Root Cause

Bedrock's TPM quota for `claude-sonnet-4-6` in `us-east-1` is 4,000,000 tokens per minute, and that quota is account-wide. API Gateway usage plans enforce per-key request throttling but have no visibility into Bedrock token consumption. When Northwind's approved backfill ramped to 1,200 rps at ~500 tokens per call (~600,000 TPM), combined with normal traffic from the other 86 tenants (~3.2M TPM aggregate), account utilization climbed into the high 90s. From there, normal bursts pushed over the 4M TPM ceiling and Bedrock returned `ThrottlingException` to whichever tenants happened to be calling in that moment.

The platform's fairness layer is API Gateway, which throttles by request rate per API key. That layer has no way to see "this single request just spent 1500 tokens" or "this tenant just consumed 50% of the account quota." Multi-tenant LLM platforms need a token-aware fairness layer in the application path because Bedrock service quotas are scoped to the account, not the API key.

## Timeline

| Time (UTC) | Event |
|---|---|
| Last week | Northwind submits backfill plan; reviewed by sales for tier-fit; approved |
| Today 09:14 | Northwind backfill begins, ramps to 1,200 rps in 4 minutes |
| 09:14 - 09:32 | Account TPM utilization climbs from 76% (baseline) to 98% |
| 09:32 | First Bedrock InvocationThrottles non-zero |
| 09:34 | First tenant slack channel reports 429 |
| 09:42 | 41 tenant slack channels active; PagerDuty fires on api 5xx rate |
| 09:48 | On-call paged |
| 09:52 | Engineer correlates Bedrock InvocationThrottles + EstimatedTPMQuotaUsage at 98% with the 5xx spike |
| 09:55 | Engineer matches Bedrock invocation logs to API Gateway access logs by request ID; finds Northwind's API key responsible for ~15% of account tokens |
| 10:00 | Northwind's batch processor sent pause signal; backfill stops within 30 seconds |
| 10:02 | Account TPM falls to 65%; Bedrock throttling stops |
| 10:05 | Tenant 5xx rates back to baseline |
| 10:30 - 14:00 | Token-aware per-tenant rate limiter shipped behind a feature flag; tested against synthetic load |
| 16:00 | Cross-region inference profile (us-east-1 + us-west-2 + us-east-2) enabled |
| 17:30 | Northwind moved to dedicated Provisioned Throughput (15 model units) |
| Next day 04:00 | Northwind backfill resumed against Provisioned Throughput; completes without affecting other tenants |

## Correct Remediation

1. **Locate the throttle**: Tenants report 429s. The first question is which layer issued the 429. Check API Gateway throttle counters per usage plan (`AWS/ApiGateway/ThrottleEvents` per key). If those are zero, the 429 is downstream.
2. **Look at Bedrock metrics**: Pull `AWS/Bedrock/InvocationThrottles` for `claude-sonnet-4-6` in `us-east-1`. If non-zero, Bedrock is rejecting calls. Pull `AWS/Bedrock/EstimatedTPMQuotaUsage` for the same model; values above 90% mean the account is at or near its TPM ceiling.
3. **Find the heavy spender**: With Bedrock model invocation logging enabled, you have per-call records of input/output token counts and the IAM principal. Group by IAM principal over the affected window to identify the largest consumer. The platform uses one IAM role for all tenants, so principal alone does not split by tenant; join the Bedrock logs to API Gateway access logs by request ID to attribute tokens to tenant_id.
4. **Stop the bleeding**: Pause the heavy tenant. If you have a control channel to their batch processor (signal, feature flag, or manual phone call), use it. Account TPM will fall within 60 seconds and Bedrock throttling will stop.
5. **Add per-tenant token fairness**: Deploy a token-aware rate limiter in the invoke-model Lambda. Track tokens consumed per tenant in a sliding 60-second window, stored in DynamoDB (with DAX for sub-millisecond reads). Reject the request locally if the tenant's running total would exceed their per-tenant cap. Per-tenant caps should sum to less than the account TPM; for an 87-tenant account on 4M TPM, a typical cap is 200,000 to 400,000 TPM per tenant with reservations for paying tiers.
6. **Expand capacity**: Switch the model invocation to a cross-region inference profile (Geographic for compliance, Global for highest throughput). The change is one parameter: pass the inference profile ARN instead of the model ID. Effective TPM grows by the sum of destination region quotas.
7. **Move heavy tenants to Provisioned Throughput**: For tenants whose steady-state load is large, buy dedicated model units. Their invocations route to provisioned capacity and do not contend with on-demand TPM at all. Cost is higher but performance is predictable, which matters for SLAs.
8. **Add monitoring**: Alarm on `EstimatedTPMQuotaUsage > 70%` (warning) and `> 90%` (paging). Alarm on `InvocationThrottles > 0`. Add per-tenant dashboards so anomaly detection works at the tenant level.

## Key Concepts

### Bedrock service quotas are account-wide

Bedrock's on-demand TPM and RPM quotas apply to your AWS account for a given (model, region) pair. They do not split by IAM user, role, API key, or anything else the platform might use as a tenant identifier. This is fundamentally different from API Gateway usage plans, which are per-key. Any service that lets tenants hit Bedrock through your account is implicitly sharing the account's quota.

The implication: per-key API Gateway throttling is necessary (rate-limit each tenant) but not sufficient (it cannot prevent multi-tenant TPM exhaustion). Fair LLM multi-tenancy requires a token-aware layer in the application.

### Token-aware rate limiting

A request-rate limiter (e.g., 200 rps per tenant) is the wrong primitive for LLM workloads because tokens-per-request varies wildly. A 200-rps tenant making 5,000-token calls consumes 1,000,000 TPM. A 200-rps tenant making 50-token calls consumes 10,000 TPM.

Token-aware rate limiting tracks cumulative tokens over a sliding window. The per-call decision: "given the prompt tokens and max_tokens, would this request push the tenant's running 60-second sum over their cap?" If yes, reject locally; if no, dispatch and account for the tokens after Bedrock returns the actual usage.

Implementation patterns: a DynamoDB table keyed on (tenant_id, minute) with atomic ADD, fronted by DAX for read latency. Or an ElastiCache Redis sorted set with timestamp scores. Or a local Lambda layer that pushes to a central counter every N requests.

### Cross-region inference profiles

Bedrock cross-region inference profiles let a single API call route to one of several regions. Two flavors: Geographic (stays within a defined geo for compliance) and Global (routes anywhere). Effective TPM is roughly the sum of the destination region quotas, sometimes higher for Global thanks to capacity pooling. No code change beyond passing the profile ARN.

This is the simplest knob to expand capacity without architectural change. Always default new platforms to a cross-region profile.

### Provisioned Throughput

Provisioned Throughput is dedicated capacity in model units. You commit to a number of model units at a published per-unit TPM. The capacity is yours regardless of what other accounts (or the on-demand pool in your account) are doing. Higher cost but predictable.

Use cases: a tenant whose steady-state load is large enough to dominate on-demand contention; a workload with strict latency SLAs; a regulatory requirement that forbids sharing inference capacity with other workloads.

## Other Ways This Could Break

### One tenant's prompt is enormous

Throttle is at the model not the gateway, but the cause is one tenant making a small number of very expensive calls (100K+ token prompts) rather than many normal calls. Same TPM impact, different traffic shape; same fix applies.
**Prevention:** Cap max prompt size per tenant. Tenants that need long context use a separate provisioned-throughput model instance.

### Tokens reserved by max_tokens

A tenant sets `max_tokens` to 4096 for short answers. Bedrock reserves the full 4096 against your TPM at request start, even if the actual output is much shorter. TPM utilization climbs faster than actual token spend.
**Prevention:** Cap `max_tokens` per tenant in the invoke-model Lambda. Default to a tight value (256-512); tenants opt up only with explicit configuration.

### SDK retry storm under throttle

When throttles begin, every Lambda retries with exponential backoff. The retries themselves consume RPM and add to the throttle, prolonging the incident.
**Prevention:** Configure SDK retry mode `adaptive` so retry rate adjusts based on observed throttling. Cap `max_attempts` to 3 and surface the failure to the tenant rather than retrying forever.

### New region rollout missing quota request

You launched in us-west-2 last week. Default new-region Bedrock TPM is much lower than us-east-1. Traffic that lands in us-west-2 throttles even though the model and code are identical.
**Prevention:** Treat Bedrock quota requests as a launch-checklist item for any new region. Default quotas vary; us-east-1 is typically highest. File quota increase requests early because they take days to process.

## SOP Best Practices

- Treat Bedrock TPM as a shared resource. Enforce per-tenant fairness in your application layer using sliding-window token-aware rate limiters. Per-key API Gateway throttling is necessary but not sufficient.
- Alarm on `EstimatedTPMQuotaUsage` at 70% so you have time to react before throttling begins. Pair with `InvocationThrottles > 0` as a paging alarm.
- Use cross-region inference profiles for capacity headroom. Geographic for data-residency-bound workloads; Global for highest throughput. Same cost as single-region (Global is ~10% cheaper); the change is one parameter.
- Move large tenants to Provisioned Throughput. Dedicated model units are isolated from on-demand contention. Higher cost but predictable performance; matters for SLAs.

## Learning Objectives

1. **Quota scope mental model**: Articulate that Bedrock TPM is account-wide and that API Gateway throttling is per-key, and explain why this combination produces multi-tenant fairness gaps.
2. **Bedrock metric vocabulary**: Use `InvocationThrottles`, `EstimatedTPMQuotaUsage`, `InputTokenCount`, `OutputTokenCount` to diagnose capacity issues.
3. **Token-aware rate limiting**: Implement and reason about sliding-window token counters keyed on tenant.
4. **Capacity expansion options**: Pick between cross-region inference profiles, Provisioned Throughput, and application-layer fairness based on workload shape.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
