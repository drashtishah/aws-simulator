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

Stop using cross-region routing for now. Switch the Bedrock API calls from the system-defined inference profile (which routes requests across multiple regions automatically) to a direct model call in a single allowed region (us-east-1). This means every request goes to one region, eliminating the chance of hitting the blocked us-east-2. The tradeoff is you lose the throughput and availability benefits of spreading requests across regions.

### Short-term (hours)

Create a custom inference profile that only includes allowed regions. A system-defined inference profile has a fixed list of regions you cannot change. An application inference profile (created with the CreateInferenceProfile API) lets you choose exactly which regions to include. Create one with only us-east-1 and us-west-2, and update the Lambda function to use the new profile ARN. This restores cross-region load balancing without routing to SCP-blocked regions.

### Long-term (days)

Fix the organizational gap that caused this. The SCP (which controls which regions are allowed) and the inference profile (which controls where Bedrock routes requests) operate at completely different layers -- neither checks the other. Establish a coordination process between the governance team (who manage SCPs) and the engineering teams (who use cross-region features). Add a pre-deployment check to the governance pipeline that automatically compares proposed SCP region changes against active cross-region configurations in affected accounts. This applies to inference profiles, S3 cross-region replication, DynamoDB global tables, and any other feature that routes traffic across regions.

## Key Concepts

### How cross-region inference profiles spread requests across regions

Amazon Bedrock cross-region inference profiles route AI model requests (InvokeModel calls) to multiple AWS regions for higher throughput and availability. There are two types. System-defined profiles (names starting with us., eu., etc.) include a fixed set of regions that you cannot change. Application inference profiles let you choose exactly which regions to include. In both cases, the caller does not control which region handles any given request -- Bedrock's internal load balancer decides. This is important because it means a request you make in us-east-1 might actually be processed in us-east-2 or us-west-2.

### How organizational policies can block regions -- SCPs and region restrictions

A Service Control Policy (SCP) is a policy set at the AWS Organizations level that defines the maximum permissions for all accounts in a group (called an organizational unit, or OU). SCPs cannot grant access -- they can only restrict it. If an SCP says "no API calls in us-east-2," then no IAM policy in any account in that OU can override it. A common pattern is a region-restriction SCP that blocks all actions outside approved regions using the aws:RequestedRegion condition key. The critical detail for this incident: when Bedrock routes a call to a region internally, the SCP evaluates the actual destination region, not the region the caller originally invoked. So even though your code calls Bedrock in us-east-1, if Bedrock routes the request to us-east-2, the SCP sees us-east-2.

### How to debug intermittent failures -- look at the routing

When the same request with the same inputs sometimes succeeds and sometimes fails, the problem is usually not in your application code. Something outside your code is varying between requests. Common sources include DNS round-robin (different servers answering different requests), load balancer routing (requests going to different backends), cache hit/miss patterns, and cross-region service routing. A key clue: when the failure rate is stable and non-trivial (not near 0% and not near 100%), it often means a fixed fraction of some routing destination is consistently failing. In this case, one out of three regions was blocked, producing a steady ~31% failure rate.

## Other Ways This Could Break

### The SCP blocks Bedrock in every region (100% failure)

If the SCP denied bedrock:InvokeModel in all regions -- including the ones the app normally uses -- every single request would fail, not just one-third. The error rate would be 100%, which is actually easier to diagnose because the pattern is obvious and the timeline correlates directly with the SCP change. The intermittent nature of this incident (31.2%) is what made it deceptive -- it looked like a flaky service rather than a clear policy conflict.

### The Lambda role's own permissions are missing for one region

If the IAM policy on the Lambda execution role (the permission document attached to the role) only granted bedrock:InvokeModel for models in us-east-1 and us-west-2 but not us-east-2, the symptom would look similar -- intermittent AccessDeniedException at roughly one-third of requests. The key difference is in the error message: it would say "not authorized to perform" without mentioning "service control policy." This tells you the block came from the role's own permissions, not from an organizational policy. The fix is updating the IAM policy resource ARNs.

### One of the regions requires opt-in and was never enabled

Some AWS regions are not active by default. You must explicitly turn them on in your account settings (these are called opt-in regions, like af-south-1 or ap-east-1). If a cross-region inference profile includes an opt-in region that the account never enabled, requests routed there fail. The error may differ from an SCP block. The fix is enabling the region in account settings, not changing policies.

### AWS Control Tower's managed region deny control causes the same problem

Organizations using AWS Control Tower (a service for setting up and governing multi-account environments) may have a managed region deny control that works like an SCP but is created and managed by Control Tower, not by your team. The symptoms are identical to this incident, but you cannot edit the control directly. Instead, you must modify the Control Tower configuration or layer a targeted SCP exception on top of it.

## SOP Best Practices

- Before applying SCP region restrictions, make a complete list of all cross-region AWS features your teams use -- inference profiles, S3 cross-region replication, DynamoDB global tables, Aurora global databases, and similar services. Verify that every destination region stays on the approved list. SCPs and cross-region features operate at different layers and neither checks the other.
- Use application inference profiles (custom profiles where you pick the regions) instead of system-defined profiles (fixed region lists) when your organization has region restrictions. This way you control exactly which regions Bedrock routes to, and you can match them to your organizational policies.
- Add a pre-deployment validation step to the governance pipeline that automatically compares proposed SCP region changes against active cross-region service configurations in affected accounts. This catches conflicts before they cause intermittent failures in production.
- Set up a CloudWatch alarm on Bedrock InvocationErrors as a percentage of InvocationCount. A stable, non-trivial error rate -- not near 0% and not near 100% -- is a strong signal of a routing or policy conflict rather than an application bug. In this case, the steady 31.2% rate was the key diagnostic clue.

## Learning Objectives

- How cross-region inference profiles in Amazon Bedrock route requests across multiple regions for load balancing
- How Service Control Policies interact with cross-region AWS service features
- Debugging intermittent failures by examining the routing layer rather than the application layer
- Coordinating cloud governance policies (SCPs) with service-level configurations (inference profiles)

## Related

- [[010-cloudformation-stuck]] -- organizational policy conflicts
- [[006-wrong-region]] -- region-related misconfiguration
- [[004-lambda-access-denied]] -- IAM and access denied debugging
