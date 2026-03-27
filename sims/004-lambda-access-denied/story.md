---
tags:
  - type/simulation
  - service/lambda
  - service/iam
  - service/dynamodb
  - service/cloudwatch
  - difficulty/associate
  - category/security
---

# PacketForge Lambda Lockout: The Missing Permission

## Opening

company: PacketForge
industry: cybersecurity, growth-stage startup, 35 engineers
product: real-time threat intelligence feeds -- aggregates threat data from 14 external sources, enriches with proprietary analysis, pushes to customer-facing APIs
scale: 220 enterprise customers, Sentinel plan at $180K/year guarantees 15-minute update freshness on threat indicators
time: 11:32 AM, Tuesday
scene: deployment pipeline just finished pushing new version of threat-feed synchronization Lambda function
alert: deploy succeeded (green checkmarks), but CloudWatch error rate dashboard turns red within minutes -- Lambda function fires every 5 minutes on schedule, every invocation fails with `AccessDeniedException`
stakes: Ridgeline Financial (largest enterprise account, $480K ARR) opened P1 support ticket -- their security operations center uses PacketForge threat feeds for real-time blocking rules on network perimeter, stale data means unblocked threats
early_signals:
  - CloudWatch error rate dashboard red
  - every Lambda invocation fails with `AccessDeniedException`
  - function code still reads same threat sources and writes to same DynamoDB table
  - new version refactored data processing: replaced single BatchWriteItem with individual PutItem and UpdateItem calls for better error handling and idempotency
  - code worked perfectly in staging environment for two weeks
investigation_starting_point: deploy succeeded, function fires on schedule but every invocation fails with AccessDeniedException. The code refactor changed which DynamoDB API operations are called. Staging worked fine but production does not.

## Resolution

root_cause: Lambda execution role's IAM policy included `dynamodb:BatchWriteItem`, `dynamodb:GetItem`, and `dynamodb:Query` but not `dynamodb:PutItem` or `dynamodb:UpdateItem`. Code refactor replaced BatchWriteItem with PutItem and UpdateItem calls but developer did not update the IAM policy.
mechanism: staging environment used a more permissive IAM role (`dynamodb:*`) for convenience, masking the permission gap. Production execution role's least-privilege policy correctly blocked the unauthorized actions, resulting in `AccessDeniedException` on every write attempt.
fix: add `dynamodb:PutItem` and `dynamodb:UpdateItem` to the execution role's IAM policy, remove `dynamodb:BatchWriteItem` (no longer used) to maintain least privilege. Preventive measure: add IAM policy simulation step to CI/CD pipeline that validates Lambda execution role has permissions for all DynamoDB actions the code uses before deploying to production.
contributing_factors:
  - staging IAM role used wildcard permissions (`dynamodb:*`), hiding the mismatch
  - IAM policy update not included in the same pull request as the code refactor
  - no automated validation of required permissions against actual API calls in the deployment pipeline
