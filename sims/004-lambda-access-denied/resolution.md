---
tags:
  - type/resolution
  - service/lambda
  - service/iam
  - service/dynamodb
  - service/cloudwatch
  - difficulty/associate
  - category/security
---

# Resolution: PacketForge Lambda Lockout -- The Missing Permission

## Root Cause

The Lambda function `packetforge-threat-sync` was refactored from using `dynamodb:BatchWriteItem` to individual `dynamodb:PutItem` and `dynamodb:UpdateItem` calls. The IAM execution role `packetforge-threat-sync-role` was not updated to include these new actions. The staging environment's permissive role (`dynamodb:*`) masked the gap; the production role's least-privilege policy correctly denied the unauthorized actions.

## Timeline

| Time | Event |
|---|---|
| 2 weeks ago | Code refactor begins in staging: BatchWriteItem replaced with PutItem/UpdateItem |
| 2 weeks ago | Staging tests pass (staging IAM role allows dynamodb:*) |
| Day 0, 11:28 UTC | CI/CD pipeline deploys new Lambda version to production |
| Day 0, 11:30 UTC | First scheduled invocation fires; fails with AccessDeniedException |
| Day 0, 11:32 UTC | CloudWatch error rate alarm triggers |
| Day 0, 11:35 UTC | Second invocation fails; customer-facing threat feed data begins aging |
| Day 0, 11:50 UTC | Threat feed staleness exceeds 15-minute SLA for Sentinel customers |
| Day 0, 12:04 UTC | Ridgeline Financial opens P1 support ticket |
| Day 0, 12:18 UTC | Root cause identified: execution role missing PutItem/UpdateItem |
| Day 0, 12:22 UTC | IAM policy updated; next invocation succeeds |
| Day 0, 12:27 UTC | Threat feed data refreshed; customer API serving current data |

## Correct Remediation

1. **Immediate**: Add `dynamodb:PutItem` and `dynamodb:UpdateItem` to the Lambda execution role's IAM policy
2. **Cleanup**: Remove `dynamodb:BatchWriteItem` from the policy since it is no longer used by the function
3. **Prevention**: Add an IAM policy simulation step to the CI/CD pipeline that tests all DynamoDB actions the code uses against the production execution role before deployment
4. **Staging parity**: Replace the staging environment's permissive `dynamodb:*` policy with the same least-privilege policy used in production
5. **Detection**: Add a CloudWatch alarm on Lambda `Errors` metric with a threshold of 1 and a 1-minute evaluation period

## Key Concepts

### Lambda Execution Roles

Every Lambda function has an IAM execution role that defines what AWS services and resources the function can access. When the function code calls an AWS API (e.g., `dynamodb:PutItem`), AWS evaluates the execution role's policies to determine whether the action is allowed.

- The execution role is an IAM role with a trust policy that allows `lambda.amazonaws.com` to assume it
- Policies attached to the role define the function's permissions
- If the role does not explicitly allow an action, the API call returns `AccessDeniedException`
- Each function has exactly one execution role, but the role can have multiple policies attached

### Principle of Least Privilege

IAM follows an implicit deny model: if a policy does not explicitly allow an action, it is denied. This is the principle of least privilege in practice:

- Only grant the specific actions the function needs (e.g., `dynamodb:PutItem`, not `dynamodb:*`)
- Scope the resource ARN to the specific table (e.g., `arn:aws:dynamodb:us-east-1:*:table/packetforge-threats`)
- When code changes add new API calls, the IAM policy must be updated to match
- Use `iam:SimulatePrincipalPolicy` to test whether a role has the required permissions before deploying

### Staging/Production IAM Parity

A common failure mode: staging environments use permissive IAM policies for developer convenience, while production uses least-privilege policies. This mismatch causes code that works in staging to fail in production. The fix is to use identical IAM policies in both environments, or to add IAM policy simulation to the deployment pipeline.

## Other Ways This Could Break

### KMS Key Policy Blocking DynamoDB Access

The Lambda execution role has the correct DynamoDB permissions, but the DynamoDB table is encrypted with a customer-managed KMS key. The execution role does not have `kms:Decrypt` or `kms:GenerateDataKey` permissions on that key. The error is an `AccessDeniedException` on the KMS action, not on the DynamoDB action itself. This is easy to confuse with a missing DynamoDB permission because the error surfaces during a DynamoDB call. Prevention: when a table uses a customer-managed KMS key, add the required KMS actions to the execution role scoped to the key ARN.

### Organization SCP Overriding Account-Level IAM

The IAM execution role policy correctly allows `dynamodb:PutItem` and `dynamodb:UpdateItem`, but a Service Control Policy at the AWS Organization level explicitly denies DynamoDB write actions in the production account. The deny comes from above the account and overrides anything the role allows. The IAM policy looks fine on inspection, which makes this harder to diagnose. Prevention: audit SCPs before deploying and use `iam:SimulatePrincipalPolicy` against the production role to test effective permissions end-to-end.

### EventBridge Loses Lambda Invoke Permission

After a resource policy change, EventBridge can no longer invoke the Lambda function. The function never executes -- CloudWatch Logs show zero invocations rather than `AccessDeniedException` during execution. The difference from this sim's scenario is that the problem is invocation authorization (who can trigger the function), not execution authorization (what the function can do once running). Prevention: after changing Lambda resource policies, verify that the event source can still invoke the function.

### IAM Condition Key Mismatch

The IAM policy includes a condition key such as `aws:SourceVpc` that restricts when the allowed actions apply. The actions are listed as allowed, but the condition does not match the Lambda execution environment. `SimulatePrincipalPolicy` without context keys would show Allow, masking the real issue. Prevention: avoid VPC or IP-based condition keys on Lambda execution roles unless the function runs in a VPC, and test policies with realistic context keys.

## SOP Best Practices

- Run `iam:SimulatePrincipalPolicy` against the production execution role for every DynamoDB action the code uses before deploying. Add this as a CI/CD pipeline gate.
- Use identical least-privilege IAM policies in staging and production. Never use wildcard permissions (`dynamodb:*`) in staging -- they mask permission gaps that surface in production.
- When refactoring code that changes which AWS API actions are called, treat the IAM policy as part of the code change. Update and review it in the same pull request.
- Set a CloudWatch alarm on the Lambda Errors metric with a threshold of 1 and a 1-minute evaluation period so permission failures are caught within one invocation cycle.

## Learning Objectives

1. **Lambda execution roles**: Understand that Lambda functions require an IAM execution role with explicit permissions for every AWS API action the function calls
2. **Least privilege**: IAM denies by default -- when code adds new API calls, the policy must be updated to allow them
3. **Environment parity**: Staging and production should use equivalent IAM policies to catch permission gaps before they reach customers

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[catalog]] -- lambda, iam, dynamodb, cloudwatch service entries
