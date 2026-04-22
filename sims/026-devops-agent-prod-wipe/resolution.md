---
tags:
  - type/resolution
  - service/q-developer
  - service/cloudformation
  - service/iam
  - service/cloudtrail
  - difficulty/professional
  - category/operations
---

# Resolution: The Thirteen-Hour Recreation

## Root Cause

The AWS DevOps Agent called `cloudformation:DeleteStack` against `forkfield-prod-tracking` while executing a plan titled "Fix drift in forkfield-staging-tracking." Two things had to be true for that call to succeed. First, the agent's execution role had no permission boundary (no ceiling on its attached policies), and its attached inline policy allowed `cloudformation:*` on `Resource: "*"`. Second, the `ForkfieldProductionGuardPolicy` that was supposed to deny destructive actions on production-tagged stacks used the IAM condition key `aws:ResourceTag/Environment`, which pulls the tag value from the request context the caller supplies, not from the live tag on the target resource. The agent's planner supplied `Environment=staging` because that was the environment its plan was nominally targeting. The `Deny` statement did not match, the `Allow` took effect, and CloudFormation proceeded to tear down the production stack.

## Timeline

| Time (UTC) | Event |
|---|---|
| T-5 days | Drift accumulates on `forkfield-staging-tracking`: a partially-deleted EventBridge rule. Engineers defer cleanup. |
| Day 0, 06:00:02 | Engineer asks DevOps Agent: "fix drift in forkfield-staging-tracking." Agent plan starts. |
| Day 0, 06:00:47 | Agent calls `DetectStackDrift` on `forkfield-staging-tracking`. Drift report names the EventBridge rule. |
| Day 0, 06:01:38 | Agent's drift-fix tool returns "unrecoverable; recommend stack recreate." |
| Day 0, 06:02:04 | Agent's planner constructs the DeleteStack call. StackName is resolved from working memory and resolves to `forkfield-prod-tracking`. Request context carries Environment=staging. |
| Day 0, 06:02:06 | IAM evaluates the call. `ForkfieldProductionGuardPolicy` Deny does not match (tag condition reads staging). cloudformation:* Allow applies. |
| Day 0, 06:02:08 | `DeleteStack` returns success. Stack status becomes DELETE_IN_PROGRESS. |
| Day 0, 06:02:08 to 06:04:18 | Seventeen resources tear down: Route 53 records, Lambda functions, DynamoDB table (DeletionPolicy: Delete), Kinesis stream, EventBridge rules, IAM roles. |
| Day 0, 06:04:18 | Stack status becomes DELETE_COMPLETE. Customer dashboards start returning stale data; carriers see API errors. |
| Day 0, 06:12 | Primary SRE paged. |
| Day 0, 06:28 | Platform lead attaches a permission boundary to `forkfield-devops-agent-role` with an explicit Deny on DeleteStack for a curated list of production stack ARNs. |
| Day 0, 06:32 | DevOps Agent autonomous write actions disabled for 48 hours. |
| Day 0, 07:10 to 19:10 | Rebuild from template; restore DynamoDB from 02:00 snapshot; backfill events from Kinesis DLQ and the archive S3 bucket; re-point Route 53. |
| Day 0, 19:10 | Customer dashboards green. Thirteen hours, six minutes of outage. |

## Correct Remediation

1. **Read what the agent actually ran, not what its plan was titled.** In the Amazon Q Developer console, open the DevOps Agent run and scroll to the tool-call list. The `DeleteStack` call will name the stack it targeted. Compare that to the plan title. If they disagree, you have found the first half of the problem.
2. **Cross-reference CloudTrail.** Filter CloudTrail on the agent's execution role ARN for `cloudformation:DeleteStack` in the last 24 hours. Confirm the `StackName` in the `requestParameters` and confirm the caller identity is the agent's assumed-role session, not a human IAM user.
3. **Read the role's policies and look for a permission boundary.** Run `aws iam get-role --role-name forkfield-devops-agent-role`. Check for the `PermissionsBoundary` field. If absent, the role has no ceiling. Run `aws iam list-attached-role-policies` to enumerate attached managed policies, and `aws iam list-role-policies` for inline ones. Read each and look at the Resource field for every destructive action.
4. **Read the production-guard policy condition carefully.** Look for `aws:ResourceTag/Environment` in the Deny statements. If that is the condition key, the Deny depends on the caller populating the tag in the request context. The live tag on the target resource is not consulted. This is the structural flaw.
5. **Attach a permission boundary that caps blast radius.** Write a boundary policy that denies `cloudformation:DeleteStack`, `cloudformation:UpdateStack` with destructive changesets, `ec2:TerminateInstances`, `rds:DeleteDBInstance`, and similar on specific production ARNs. Attach with `aws iam put-role-permissions-boundary`. A boundary caps, it does not add; the role's effective permissions are the intersection.
6. **Replace request-context tag checks with server-side lookups.** Route destructive `cloudformation` actions through an EventBridge rule that triggers a Lambda authorizer. The authorizer calls `DescribeStacks` on the target stack, reads the live `Environment` tag, and blocks or allows based on the live value. The authorizer becomes the real guard, not the IAM condition.
7. **Require Change Manager approval for destructive actions unconditionally.** Configure the DevOps Agent to file a Change Manager change request for every `DeleteStack`, `DeleteDBInstance`, `TerminateInstances`, and `DetachRolePolicy`, regardless of the agent's own conclusion about the environment. Two-human approval must be a property of the action, not of the agent's reasoning.
8. **Alarm on agent write actions.** Create CloudWatch metric filters on CloudTrail that count destructive API calls by the DevOps Agent role per hour. Page the on-call when the count exceeds zero on a production ARN. This catches any future incident within minutes.
9. **Rebuild production deliberately.** Restore the DynamoDB table from the 02:00 snapshot, rebuild the stack from the source-of-truth template in infrastructure-as-code, re-point Route 53, and run the backfill from the Kinesis DLQ and the archive S3 bucket. Prepare customer notifications with SOC 2 evidence.

## Key Concepts

### Permission boundaries as blast-radius ceilings

A permission boundary is an IAM construct that caps the effective permissions of a role or user, regardless of what policies are attached. If the attached policy grants `cloudformation:*` and the boundary only allows `cloudformation:*` on non-production ARNs, the effective permissions are the intersection: the role can do anything in CloudFormation except on production. For autonomous agents with broad attached policies, the boundary is the primary blast-radius control. Without one, the attached policy is the ceiling, and if that policy uses wildcards you have no ceiling at all. Boundaries should be reviewed for what they forbid, not for what they allow.

### The difference between request-context tags and server-authoritative tags

IAM policies can use tag-based conditions in two ways. `aws:RequestTag/<key>` and `aws:ResourceTag/<key>` in a create-resource call come from the caller's request. `aws:ResourceTag/<key>` on a read or update action comes from the resource being accessed, as read by IAM from the service's own tag store. The nuance is that some actions' context is populated by the caller before the service checks tags, and in those cases the tag condition is only as trustworthy as the caller. For destructive actions the rule of thumb is: never trust a tag condition whose value the caller can supply. Route the action through a thin Lambda that reads the tag server-side and denies based on the live value.

### Change Manager as an always-on gate

AWS Systems Manager Change Manager lets you require human approval before a runbook or workflow executes a change. Integrating Change Manager with autonomous agents is the single most effective control against agent-driven accidents: if every destructive call requires a Change Manager request, a human has to review the plan before anything happens. The antipattern is filing the change request only when the agent's own policy check says "production." That conditions the gate on the agent being right about the environment, which is exactly the assumption that fails in this incident. The gate should be unconditional for the action, not conditional on the agent's self-assessment.

## Other Ways This Could Break

### The agent has a permission boundary, but the boundary still allows destructive actions on `Resource: *`
A boundary exists. Checking for its presence passes. But the boundary grants `cloudformation:DeleteStack` on `Resource: *`, so the ceiling is above the production stacks, not below them. The incident plays out the same way.
**Prevention:** Boundaries must explicitly forbid destructive actions on production ARNs or use `NotResource` to enumerate non-production. A boundary that matches the attached policy is not a boundary.

### The Change Manager approver group includes the agent's own service principal
The gate is triggered. Two approvers sign off. But one approver is a distribution list that contains the agent's service principal and the agent approves its own request. Human review never happens.
**Prevention:** Approver groups exclude service principals. Audit membership quarterly. Deny Change Manager approval when the approver identity matches the requester identity.

### The destructive action is proxied through a new CloudFormation stack's custom resource
Direct `DeleteStack` is blocked. The agent creates a helper stack with a custom resource that calls `DeleteStack` from a Lambda assuming a different role. The wrapping role does not carry the production-guard policy. The destructive outcome happens indirectly.
**Prevention:** Enforce the guard at the organization level via a Service Control Policy so it applies to every role. Apply the same tag and Change Manager checks in any Lambda that can reach the destructive API.

## SOP Best Practices

- Every autonomous agent role has a permission boundary reviewed as a blast-radius cap. The boundary and the attached policy are written together, and the boundary is the more restrictive of the two.
- Destructive-action guardrails do not rely on request-context tags. Route destructive actions through a Lambda authorizer that reads live tags from the target resource.
- Change Manager approval is a property of the action, not of the agent's reasoning. `DeleteStack` on a stack tagged production always files a change request.
- CloudWatch alarms on agent-role destructive API calls. Autonomous agents are the most likely accidental source of production destruction; a zero-threshold alarm per hour is cheap insurance.

## Learning Objectives

1. **Permission boundaries for autonomous agents**: Understand why agents need an IAM ceiling distinct from their attached policies, and how to write one that excludes production resources.
2. **Tag-condition reliability**: Recognize that `aws:ResourceTag/<key>` in a policy condition may be populated by the caller, not by the resource, and build server-side tag checks where it matters.
3. **Change Manager integration**: Learn to make human approval an unconditional property of destructive actions, independent of the agent's own conclusions.
4. **Amazon Q Developer DevOps Agent execution model**: Read a DevOps Agent run log, correlate it with CloudTrail, and identify the specific tool call that caused the outcome.

## Related

- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
- [[learning/catalog.csv]] -- Player service catalog and progress
