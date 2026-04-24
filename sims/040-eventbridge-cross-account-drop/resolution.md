---
tags:
  - type/resolution
  - service/eventbridge
  - service/iam
  - service/cloudwatch
  - service/cloudtrail
  - difficulty/associate
  - category/operations
---

# Resolution: The Events Nobody Sent

## Root Cause

The new product account emits EventBridge events with `source` set to `quillmark.product-audit`. The central consolidation rule uses this EventPattern:

```json
{
  "source": [{ "prefix": "quillmark.audit." }]
}
```

The value `quillmark.product-audit` does not start with `quillmark.audit.`, so the prefix match fails for every event from the new account.

## Why This Is Hard to See

EventBridge cross-account event delivery operates in two independent layers:

**Layer 1: source-rule target invocation.** The source account rule fires, assumes the cross-account IAM role, and calls `events:PutEvents` on the central bus. This layer is measured by `FailedInvocations` on the source rule. Zero here means delivery succeeded.

**Layer 2: destination-bus rule evaluation.** The central bus receives the event and evaluates each rule's EventPattern against it. If no rule matches, the event is silently discarded. This layer is measured by `TriggeredRules` on the destination rule. Zero here means no event matched the pattern.

The failure in this sim is entirely in layer 2. Layer 1 is healthy. The source account's metrics look correct. The only signals are on the destination side: `TriggeredRules=0` and Lambda `Invocations=0`.

## EventBridge Prefix Match Syntax

EventPattern supports two forms for source matching:

```json
{ "source": ["quillmark.audit.identity"] }
```
This is an exact match. Only events with source exactly equal to `quillmark.audit.identity` match.

```json
{ "source": [{ "prefix": "quillmark.audit." }] }
```
This is a prefix match. Any event with a source value beginning with `quillmark.audit.` matches, including `quillmark.audit.identity`, `quillmark.audit.billing`, and `quillmark.audit.product`.

The prefix form is necessary for a central aggregation rule that accepts events from many accounts with slightly different source values under a shared prefix convention.

## Correct Remediation

1. Update the new account's application configuration to emit events with `source` set to `quillmark.audit.product` (or any value starting with `quillmark.audit.`).
2. Deploy the config change and emit a test event.
3. In the central account, watch `TriggeredRules` on `consolidate-all-accounts`. It should increment after the next event.
4. Verify Lambda `Invocations` also rises.
5. Replay the 48-hour gap from application logs or a durable event store if available.

## Key Concepts

### Two-Layer Delivery Model

When diagnosing a cross-account EventBridge silent drop:

- `FailedInvocations=0` on the source rule: the cross-account IAM role and PutEvents call succeeded. Delivery is not the problem.
- `failedEntryCount=0` in CloudTrail PutEvents responseElements: the destination bus accepted the event. The bus is reachable and the resource policy permits the call.
- `TriggeredRules=0` on the destination rule: the event arrived but no rule matched. The problem is in the EventPattern or in the event content.

If all three are zero and the Lambda has no invocations, the failure is a content mismatch between the event and the destination rule.

### Diagnosing the Mismatch

The key artifacts are:

1. CloudTrail PutEvents records in the central account. The `requestParameters.entries[0].source` field shows exactly what value the sending application is using.
2. The central rule's EventPattern from `DescribeRule`. Compare the required prefix against the actual source value.

## Learning Objectives

1. EventBridge cross-account delivery success (FailedInvocations=0) does not mean events are processed: they must also match a rule on the destination bus.
2. When events reach a bus but no rule matches, there is no error signal on the source side; diagnosis requires checking destination-side metrics (TriggeredRules, Lambda Invocations).
3. EventBridge EventPattern prefix matching uses `{"prefix": "..."}` syntax; a simple string entry is an exact match only.
4. How to trace a cross-account event flow end-to-end: source rule metrics, CloudTrail PutEvents responses at the destination, destination-rule CloudWatch metrics.
5. Standardized event source naming conventions prevent silent drops in multi-account Organizations; enforce via schema registry or onboarding runbooks.

## Related

- [[exam-topics#SOA-C02 -- SysOps Administrator Associate]] - Domain 3: Monitoring and Logging
- [[exam-topics#DVA-C02 -- Developer Associate]] - Domain 1: Development with AWS Services
- [[learning/catalog.csv]] - Player service catalog and progress
