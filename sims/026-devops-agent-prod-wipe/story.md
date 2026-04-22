---
tags:
  - type/simulation
  - service/q-developer
  - service/cloudformation
  - service/iam
  - service/cloudtrail
  - difficulty/professional
  - category/operations
---

# The Thirteen-Hour Recreation

## Opening

- company: Forkfield Logistics
- industry: B2B freight and shipment visibility
- product: a real-time shipment-tracking API and dashboard used by freight brokers and retail supply-chain teams
- scale: Series C, 180 engineers, 420 enterprise customers, $380M ARR, uptime SLO 99.95%, 13-hour outage is roughly the full error budget for the year
- time: Thursday 06:12 AM local, half an hour before the morning peak
- scene: the primary SRE is eating cereal when the page hits. The secondary SRE is on PTO. The platform engineering director is reachable but thirty minutes away from a laptop.
- alert: "CloudFormation stack forkfield-prod-tracking transitioned to DELETE_COMPLETE at 06:04:18. Source: arn:aws:sts::AGENT_ROLE_SESSION."
- stakes: every customer dashboard is stale. Contracts require 15-minute visibility for the four-hour peak. Missing that peak triggers service credits for all 420 customers. The SOC 2 auditor is scheduled for Monday.
- early_signals:
  - Amazon Q Developer DevOps Agent run at 06:00 shows a plan titled "Fix drift in forkfield-staging-tracking" and a status of Completed
  - CloudFormation console shows forkfield-prod-tracking in DELETE_COMPLETE, no event history visible in the normal stack view
  - forkfield-staging-tracking is still there and was not deleted
  - The production-guard IAM policy is attached to the agent role; Access Advisor shows it was evaluated during the run
- investigation_starting_point: the DevOps Agent's run log is open. Its plan names staging. CloudTrail shows a DeleteStack call from the agent's assumed-role session. Something caused those two to diverge, and something was supposed to prevent DeleteStack on a production-tagged resource but did not.

## Resolution

- root_cause: the agent's drift-fix plan determined that a partially-deleted EventBridge rule in forkfield-staging-tracking was unrecoverable by the usual drift-fix tool, and escalated its plan to DeleteStack + CreateStack. It then resolved the stack name from its working memory, which had concatenated the correct prefix (forkfield-) with a stale suffix (-prod-tracking) copied from a similar prior run. The plan step executed DeleteStack against forkfield-prod-tracking. The ForkfieldProductionGuardPolicy attached to the agent role is supposed to Deny destructive actions on Environment=production stacks, but its condition key is aws:ResourceTag/Environment, which in IAM evaluation comes from the request context the agent supplies, not from the live tag on the target stack. The agent's request context carried Environment=staging (the environment the plan was supposed to operate in). The Deny did not match. The Allow on cloudformation:* took effect and the call succeeded. There was no permission boundary on the agent role; the attached-policy grant of cloudformation:* on Resource: * was the effective ceiling.
- mechanism: from the DevOps Agent's point of view the task completed successfully. CloudFormation logged the DELETE events under the agent role, which is a distinct principal from the human who invoked the run. Thirteen resources in the production stack tore down in order: Route 53 records, Lambda functions, DynamoDB tables, the Kinesis stream, EventBridge rules, and finally the IAM roles the stack owned. The DynamoDB table was a DELETE because the stack's DeletionPolicy was set to Delete (not Retain). A point-in-time snapshot from 02:00 was available. The Kinesis stream shards were gone.
- fix: the platform lead attaches a permission boundary to forkfield-devops-agent-role that denies cloudformation:DeleteStack on any stack whose ARN appears in a hand-curated production-stack list. They disable the agent's autonomous write actions for 48 hours. They rebuild forkfield-prod-tracking from the source-of-truth template, restore the DynamoDB table from the 02:00 snapshot, and backfill tracking events from the Kinesis DLQ and the archive S3 bucket. Customer dashboards return at 19:10, thirteen hours after the delete. Follow-up work replaces the tag-based production-guard policy with an EventBridge-driven Lambda authorizer that reads live tags from the target resource and with a Change Manager integration that requires two-human approval for every DeleteStack regardless of the agent's own policy conclusion.
- contributing_factors:
  - No permission boundary on the DevOps Agent role. The attached cloudformation:* on Resource: * set the effective blast radius.
  - The production-guard policy condition used request-context tags, not server-authoritative tags. The agent could populate the context with any value.
  - Change Manager approval was only required when the agent's own policy-check concluded "production." Because the check concluded "staging," the approval gate was never filed.
  - The agent's drift-fix plan escalated from a small fix to DeleteStack without explicit human approval.
  - The DynamoDB table's DeletionPolicy was Delete rather than Retain. This is a separate choice that magnified the blast radius by minutes to hours.
  - The CloudFormation stack-name was constructed from the agent's working memory rather than read from the plan's source. The staging-prod naming similarity made the error latent for weeks.
