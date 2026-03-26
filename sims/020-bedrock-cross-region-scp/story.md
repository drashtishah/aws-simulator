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

# Intermittent by Design

## Opening

The error rate was exactly 31.2%. It had been 31.2% for six hours. Not 30%, not 32%. The number held steady through the afternoon like a fixed constant in a physics equation. At Polaris Underwriting, the claims assessment pipeline processes 4,200 insurance claims per day. Each claim passes through Amazon Bedrock for document analysis and payout estimation. On a normal day, the failure rate is under 0.3%.

On Tuesday, the parent company's cloud governance team at Meridian Insurance Group applied an updated Service Control Policy to the Polaris organizational unit. The change was routine. A tightening of approved regions. The ticket was closed the same day. On Wednesday afternoon, claims adjusters started reporting that roughly one in three AI assessments was failing. The adjusters filed a support ticket at 2:14 PM. By 2:47 PM, the SRE team confirmed the pattern.

The failures return AccessDeniedException. The IAM role has not changed. The Bedrock model access configuration has not changed. The Lambda function code has not changed. The same claim document, submitted twice in a row, succeeds on the first attempt and fails on the second. Or fails on both. Or succeeds on both. There is no pattern in the payload, the timestamp, the claim type, or the adjuster who submitted it. The error rate is 31.2% and it does not move.

Eight hundred forty-seven claims are queued behind the failures. The claims processing SLA requires assessment within four hours of submission. Twelve adjusters have switched to manual processing as a workaround. Manual processing takes eleven minutes per claim. The math does not work.

## Resolution

The cross-region inference profile `us.anthropic.claude-3-5-sonnet-20241022-v2:0` routes InvokeModel requests across three regions for load balancing: us-east-1, us-east-2, and us-west-2. The Service Control Policy applied by Meridian's governance team on Tuesday denies all API actions -- except IAM, Organizations, STS, Support, and Budgets -- in any region outside us-east-1 and us-west-2. The region us-east-2 is blocked.

When Bedrock's load balancer selects us-east-1 or us-west-2 as the destination for an InvokeModel call, the request succeeds. When it selects us-east-2, the SCP intercepts the call before it reaches the Bedrock endpoint and returns AccessDeniedException. The load balancer distributes roughly evenly across the three regions. One out of three is blocked. The error rate holds at approximately 31%.

The fix has two paths. The first is to switch from the system-defined cross-region inference profile to an application inference profile that only includes approved regions (us-east-1 and us-west-2). The second is to coordinate with the governance team to add a targeted exception in the SCP for Bedrock actions in us-east-2. The first path is faster and does not require organizational approval. The second path preserves the throughput benefits of the third region but requires a change request through governance.

The deeper lesson is that cross-region inference profiles and Service Control Policies operate at different layers of the stack. The inference profile is a Bedrock-level routing construct. The SCP is an Organizations-level access control construct. Neither is aware of the other. When they conflict, the result is not an error at deployment or configuration time. The result is an intermittent runtime failure that looks like a service defect.
