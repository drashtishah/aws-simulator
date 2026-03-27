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

company: Polaris Underwriting
industry: insurance technology, enterprise, 180 engineers, subsidiary of Meridian Insurance Group
product: claims assessment pipeline using Amazon Bedrock for document analysis and payout estimation
scale: 4,200 insurance claims per day, normal failure rate under 0.3%
time: Wednesday afternoon, 2:14 PM (SCP change applied Tuesday)
scene: claims adjusters reporting roughly one in three AI assessments failing since Wednesday afternoon
alert: error rate exactly 31.2%, holding steady for 6 hours -- not 30%, not 32%
stakes: 847 claims queued behind failures, claims processing SLA requires assessment within 4 hours of submission, 12 adjusters switched to manual processing (11 minutes per claim), math does not work
early_signals:
  - Tuesday, parent company cloud governance team (Meridian Insurance Group) applied updated Service Control Policy to Polaris organizational unit -- routine tightening of approved regions, ticket closed same day
  - Wednesday afternoon, adjusters report roughly 1 in 3 AI assessments failing
  - 2:14 PM adjusters filed support ticket; 2:47 PM SRE team confirmed the pattern
  - failures return AccessDeniedException
  - IAM role, Bedrock model access configuration, Lambda function code all unchanged
  - same claim document submitted twice in a row succeeds then fails, or fails both, or succeeds both -- no pattern in payload, timestamp, claim type, or adjuster
investigation_starting_point: error rate is 31.2% and does not move. AccessDeniedException with no changes to IAM, Bedrock config, or Lambda code. No pattern in payload or timing. The intermittent nature is the key clue.

## Resolution

root_cause: cross-region inference profile (us.anthropic.claude-3-5-sonnet-20241022-v2:0) routes InvokeModel requests across 3 regions for load balancing: us-east-1, us-east-2, us-west-2. Service Control Policy (RegionRestriction-v3) applied by Meridian governance team on Tuesday denies all API actions (except IAM, Organizations, STS, Support, Budgets) in any region outside us-east-1 and us-west-2. Region us-east-2 is blocked.
mechanism: when Bedrock load balancer selects us-east-1 or us-west-2, request succeeds. When it selects us-east-2, SCP intercepts the call before it reaches the Bedrock endpoint and returns AccessDeniedException. Load balancer distributes roughly evenly across 3 regions. 1 of 3 blocked. Error rate holds at approximately 31%.
fix: two paths -- (1) switch from system-defined cross-region inference profile to application inference profile including only approved regions (us-east-1 and us-west-2), faster, no organizational approval needed; (2) coordinate with governance team to add targeted SCP exception for Bedrock actions in us-east-2, preserves throughput benefits of third region but requires change request.
contributing_factors:
  - cross-region inference profiles and SCPs operate at different layers of the stack (Bedrock-level routing vs Organizations-level access control), neither aware of the other
  - conflict produces intermittent runtime failure, not a deployment-time or configuration-time error
  - no pre-deployment check comparing SCP region restrictions against active cross-region inference profiles
  - governance team closed the SCP ticket same day with no cross-reference to downstream service configurations
