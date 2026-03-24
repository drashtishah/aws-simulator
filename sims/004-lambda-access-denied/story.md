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

It is 11:32 AM on a Tuesday. The deployment pipeline just finished pushing a new version of the threat-feed synchronization Lambda function. The deploy succeeded -- green checkmarks across the board. But within minutes, the CloudWatch error rate dashboard turns red. The Lambda function is firing every 5 minutes on schedule, but every invocation fails with the same error: `AccessDeniedException`.

PacketForge is a growth-stage cybersecurity startup that provides real-time threat intelligence feeds to 220 enterprise customers. The core product aggregates threat data from 14 external sources, enriches it with PacketForge's proprietary analysis, and pushes it to customer-facing APIs. Enterprise customers on the Sentinel plan pay $180K per year for guaranteed 15-minute update freshness on threat indicators. The threat-sync Lambda function is the heart of the pipeline -- it pulls raw threat data, processes it, and writes the enriched results to a DynamoDB table that feeds the customer API.

The function code has not changed its external dependencies -- it still reads from the same threat sources and writes to the same DynamoDB table. But the new version refactored the data processing pipeline. Previously, the function used a single batch-write operation. The refactored code uses individual PutItem and UpdateItem calls for better error handling and idempotency. The code worked perfectly in the staging environment for two weeks.

Your phone buzzes again -- the customer success team is pinging. Ridgeline Financial, the largest enterprise account at $480K ARR, has opened a Priority 1 support ticket. Their security operations center uses PacketForge threat feeds to generate real-time blocking rules for their network perimeter. Stale data means unblocked threats.

## Resolution

The investigation revealed a gap between the Lambda function's code permissions and its IAM execution role. The original version of `packetforge-threat-sync` used `dynamodb:BatchWriteItem` for all writes. The execution role's IAM policy included `dynamodb:BatchWriteItem`, `dynamodb:GetItem`, and `dynamodb:Query`. When the code was refactored to use individual `PutItem` and `UpdateItem` calls instead of batch writes, the developer updated the code but did not update the IAM policy.

The staging environment used a more permissive IAM role (`dynamodb:*`) for convenience, which masked the permission gap. When the code deployed to production, the production execution role's least-privilege policy correctly blocked the unauthorized actions, resulting in `AccessDeniedException` on every write attempt.

The immediate fix was to add `dynamodb:PutItem` and `dynamodb:UpdateItem` to the execution role's IAM policy. The team also removed `dynamodb:BatchWriteItem` since it was no longer used, keeping the policy aligned with the principle of least privilege. As a preventive measure, the team added an IAM policy simulation step to the CI/CD pipeline that validates the Lambda execution role has permissions for all DynamoDB actions the code uses before deploying to production.
