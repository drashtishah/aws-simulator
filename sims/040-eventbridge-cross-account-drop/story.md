---
tags:
  - type/simulation
  - service/eventbridge
  - service/iam
  - service/cloudwatch
  - service/cloudtrail
  - difficulty/associate
  - category/operations
---

# The Events Nobody Sent

## Opening

- company: Quillmark Publishing
- industry: Digital media and publishing platform
- product: nine-account AWS Organization with a central audit pipeline collecting access events from all product accounts
- scale: central audit account 111122223333, 8 existing product accounts, ninth account (444455556666) onboarded 2026-04-21
- time: Thursday 09:00 UTC, 48 hours after the new account went live
- scene: Audit team Slack channel. A P2 ticket just arrived: "New product account shows zero events in the central audit log for the past 48 hours. Rule shows Enabled. Invocations are climbing. No errors in CloudWatch."
- alert: the absence of events was noticed only because an SRE manually checked the audit log count per account. No alarm exists on the consolidation Lambda going silent.
- stakes: 48 hours of compliance audit records from the new product account are missing. If the gap is not recovered, the quarterly audit report will show a coverage hole.
- early_signals: zero entries in the audit log for account 444455556666 since onboarding; source-account CloudWatch shows Invocations rising and FailedInvocations=0; no DLQ; no Lambda errors
- investigation_starting_point: You know the new account is 444455556666. The forwarding rule is Enabled and firing. You have access to EventBridge consoles in both the source account (444455556666) and the central audit account (111122223333), plus CloudWatch and CloudTrail in both accounts.

## Resolution

- root_cause: The new product account's application emits audit events with source set to quillmark.product-audit. The central consolidation rule on audit-bus uses EventPattern {\"source\": [{\"prefix\": \"quillmark.audit.\"}]}, the convention all 8 existing accounts follow (e.g., quillmark.audit.identity, quillmark.audit.billing). The string quillmark.product-audit does not begin with quillmark.audit., so the prefix match fails for every event from the new account.
- mechanism: EventBridge accepts all events onto the bus (PutEvents failedEntryCount=0) but silently discards any event that matches no rule. The consolidation rule's TriggeredRules stays at zero; the Lambda is never invoked. FailedInvocations on the source rule is also zero because delivery to the bus succeeded. There is no error signal on either side of the cross-account boundary.
- fix: Update the new account's application configuration to emit events with source quillmark.audit.product, following the Organization convention. Deploy the config change, emit a test event, and verify TriggeredRules on consolidate-all-accounts increments. Replay the 48-hour gap from application logs if a durable event store is available.
- contributing_factors: No onboarding checklist required new teams to register their source prefix or test event delivery end-to-end before go-live. No CloudWatch alarm existed on the consolidation Lambda going silent. The source-account metrics (Invocations, FailedInvocations) appear healthy, so the issue is not self-revealing from the source side.
