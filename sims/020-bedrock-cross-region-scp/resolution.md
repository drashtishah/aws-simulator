---
tags:
  - type/simulation
  - service/bedrock
  - service/iam
  - service/organizations
  - service/cloudwatch
  - difficulty/professional
  - category/operations
---

# Resolution -- Intermittent by Design

## Root Cause

The Polaris Underwriting claims pipeline uses a system-defined cross-region inference profile (`us.anthropic.claude-3-5-sonnet-20241022-v2:0`) that load-balances Bedrock InvokeModel requests across three regions: us-east-1, us-east-2, and us-west-2. On Tuesday, the Meridian Insurance Group governance team applied an updated Service Control Policy to the Polaris OU. The SCP denies all API actions (with narrow exceptions for IAM, Organizations, STS, Support, and Budgets) in any region outside us-east-1 and us-west-2.

When Bedrock routes a request to us-east-2, the SCP denies the call before it reaches the Bedrock service endpoint. The caller receives an AccessDeniedException. When Bedrock routes to us-east-1 or us-west-2, the call succeeds normally. Because the load balancer distributes roughly equally across three regions, one-third of all calls fail. The error rate stabilized at 31.2%.

## Timeline

| Time | Event |
|---|---|
| Tuesday 10:30 AM | Meridian governance team applies updated SCP (`RegionRestriction-v3`) to Polaris OU |
| Tuesday 10:30 AM | SCP begins blocking API calls in unapproved regions including us-east-2 |
| Tuesday 10:30 AM - Wednesday 1:00 PM | Failures accumulate unnoticed in overnight batch processing |
| Wednesday 1:47 PM | Claims adjusters report one in three assessments failing |
| Wednesday 2:14 PM | Support ticket filed by claims operations lead |
| Wednesday 2:47 PM | SRE team confirms 31.2% error rate, AccessDeniedException |
| Wednesday 3:00 PM | Investigation begins |

## Correct Remediation

### Immediate (minutes)

Switch the Bedrock API calls from the system-defined cross-region inference profile to a direct model invocation in a single allowed region (us-east-1). This eliminates the routing to us-east-2 and restores 100% success rate at the cost of cross-region load balancing.

### Short-term (hours)

Create an application inference profile that explicitly includes only us-east-1 and us-west-2 as destination regions. Update the Lambda function to use this profile ARN. This restores cross-region load balancing without routing to SCP-blocked regions.

### Long-term (days)

Establish a coordination process between the governance team and the engineering teams that use cross-region AWS features. SCPs and cross-region inference profiles, S3 cross-region replication, DynamoDB global tables, and similar features must be validated against each other before SCP changes are applied. Add a pre-deployment check to the governance pipeline that cross-references SCP region restrictions against active cross-region configurations.

## Key Concepts

### Cross-Region Inference Profiles

Amazon Bedrock cross-region inference profiles route InvokeModel requests to multiple regions for higher throughput and availability. System-defined profiles (prefixed with `us.`, `eu.`, etc.) include a fixed set of regions. Application inference profiles allow custom region selection. The caller does not control which region handles a given request -- Bedrock's load balancer decides.

### SCPs and Region Restrictions

Service Control Policies set the maximum permissions for accounts within an organizational unit. A common pattern is a region-restriction SCP that denies all actions outside approved regions using the `aws:RequestedRegion` condition key. This operates at the API call level. When a service like Bedrock routes a call to a region internally, the SCP evaluates the actual destination region, not the region the caller invoked.

### Intermittent Failure Debugging

Intermittent failures with identical inputs typically indicate a variable outside the application layer. Common sources include DNS round-robin, load balancer routing, cache hit/miss patterns, and cross-region service routing. When the failure rate is stable and non-trivial (not near 0% or 100%), the variable is likely binary or categorical -- a fixed fraction of some routing destination is failing consistently.

## AWS Documentation Links

- [[Amazon Bedrock cross-region inference|https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html]]
- [[Service Control Policies|https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html]]
- [[aws:RequestedRegion condition key|https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-requestedregion]]
- [[Application inference profiles|https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html]]

## Learning Objectives

- How cross-region inference profiles in Amazon Bedrock route requests across multiple regions for load balancing
- How Service Control Policies interact with cross-region AWS service features
- Debugging intermittent failures by examining the routing layer rather than the application layer
- Coordinating cloud governance policies (SCPs) with service-level configurations (inference profiles)

## Related

- [[010-cloudformation-stuck]] -- organizational policy conflicts
- [[006-wrong-region]] -- region-related misconfiguration
- [[004-lambda-access-denied]] -- IAM and access denied debugging
