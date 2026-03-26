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

1. **Immediate**: Add the missing permissions to the Lambda function's execution role. The execution role is an IAM role -- a set of permissions that controls what AWS services the function can access. Add `dynamodb:PutItem` (permission to insert a new row) and `dynamodb:UpdateItem` (permission to modify an existing row) to the role's IAM policy (the JSON document listing allowed actions).
2. **Cleanup**: Remove `dynamodb:BatchWriteItem` from the policy since the refactored code no longer uses that action. Keeping unused permissions around increases security risk for no benefit -- this follows the principle of least privilege (granting only what is needed).
3. **Prevention**: Add an IAM policy simulation step to your deployment pipeline (CI/CD). Before deploying, use SimulatePrincipalPolicy (a tool that checks whether a role is actually allowed to perform specific actions) to verify the production execution role has every permission the code needs. This catches gaps before they reach production.
4. **Staging parity**: Replace the staging environment's permissive `dynamodb:*` policy (which allows all DynamoDB actions) with the same tightly scoped policy used in production. When staging and production have different permissions, bugs hide in staging and only surface in production.
5. **Detection**: Set up a CloudWatch alarm on the Lambda `Errors` metric with a threshold of 1 and a 1-minute evaluation period. This means your team gets alerted within one invocation cycle if the function starts failing, whether from permission errors or anything else.

## Key Concepts

### Lambda Execution Roles -- What Your Function Is Allowed to Do

Every Lambda function runs with an IAM execution role -- think of it as an ID badge that determines which doors the function can open. When the function tries to call another AWS service (for example, writing data to a DynamoDB table), AWS checks the execution role's permissions to decide whether to allow or deny the action.

- The execution role is an IAM role with a trust policy -- a special document that says "Lambda is allowed to use this role." Without this trust policy, the Lambda service cannot pick up the role.
- Policies attached to the role define the function's actual permissions -- which actions it can perform and on which resources.
- If the role does not explicitly allow an action, the API call returns `AccessDeniedException`. There is no "maybe" -- either it is allowed or it is denied.
- Each function has exactly one execution role, but the role can have multiple policies attached to it.

### Principle of Least Privilege -- Only Allow What Is Needed

IAM uses an "implicit deny" model: if a permission is not explicitly granted, it is automatically denied. This is the principle of least privilege -- give each function only the exact permissions it needs and nothing more.

- Grant specific actions like `dynamodb:PutItem` (insert a row) rather than `dynamodb:*` (all DynamoDB actions). Broad permissions create unnecessary security risk.
- Scope permissions to specific resources using ARNs (Amazon Resource Names -- unique addresses for AWS resources). For example, grant access to `arn:aws:dynamodb:us-east-1:*:table/packetforge-threats` rather than all tables.
- When code changes introduce new API calls, the IAM policy must be updated to match. New code with old permissions will fail.
- Use `iam:SimulatePrincipalPolicy` -- a tool that checks whether a role can perform specific actions -- to test permissions before deploying.

### Staging/Production IAM Parity -- Why Environments Should Match

A common trap: staging environments use broad, permissive IAM policies (like `dynamodb:*`) for developer convenience, while production uses tightly scoped least-privilege policies. This mismatch means code that works perfectly in staging can fail immediately in production because the production role does not allow the same actions. The fix is to use identical IAM policies in both environments, or to add IAM policy simulation to your deployment pipeline so permission gaps are caught before code reaches production.

## Other Ways This Could Break

### KMS Key Policy Blocking DynamoDB Access

The DynamoDB permissions look correct, but the table is encrypted with a customer-managed KMS key. KMS (Key Management Service) manages encryption keys that protect your data. The function gets `AccessDeniedException` on the encryption operation (`kms:Decrypt` or `kms:GenerateDataKey`) rather than on the DynamoDB action itself. This is confusing because the error happens during a DynamoDB call but the actual problem is that the function cannot access the encryption key. Prevention: when a DynamoDB table uses a customer-managed encryption key, add `kms:Decrypt` and `kms:GenerateDataKey` permissions to the execution role, scoped to that specific key.

### Organization SCP Overriding Account-Level IAM

The function's own permissions look correct, but a Service Control Policy (SCP) -- a rule set at the AWS Organization level that applies to all accounts underneath it -- explicitly blocks DynamoDB writes in the production account. SCPs act like a ceiling on permissions: even if a role allows an action, an SCP can deny it from above. The IAM policy looks fine when you inspect it, which makes this hard to diagnose. Prevention: review SCPs in your AWS Organization before deploying, and use `iam:SimulatePrincipalPolicy` (a tool that checks effective permissions across all policy layers) against the production role.

### EventBridge Loses Lambda Invoke Permission

After a policy change, the scheduling service (EventBridge) can no longer trigger the Lambda function. The function never runs at all -- CloudWatch Logs show zero invocations, not an `AccessDeniedException` during execution. The key difference from this sim is that the problem is about who is allowed to start the function (invocation authorization), not what the function can do once it is running (execution authorization). Prevention: after changing a Lambda function's resource-based policy (the policy that controls who can trigger the function), test that the event source can still invoke it.

### IAM Condition Key Mismatch

The actions are listed as allowed in the policy, but a condition limits when they apply. For example, an `aws:SourceVpc` condition restricts the action to calls from a specific virtual network -- but Lambda functions do not always run inside a VPC. The policy appears to allow the action, but the condition silently blocks it. Testing with `SimulatePrincipalPolicy` without providing the right context values would show "Allow," hiding the real problem. Prevention: avoid VPC or IP-based conditions on Lambda execution roles unless the function runs in a VPC. When testing policies, always include realistic context values.

## SOP Best Practices

- Before deploying, test whether the production role actually has the permissions your code needs. Run `iam:SimulatePrincipalPolicy` -- a tool that checks whether a role can perform specific actions -- for every DynamoDB action the code calls. Add this as a required gate in your deployment pipeline (CI/CD) so it runs automatically.
- Use the same tightly scoped permissions in staging as in production. Never use wildcard permissions like `dynamodb:*` (meaning "allow all DynamoDB actions") in staging -- they hide permission gaps that will only surface when you deploy to production.
- When you change your code to call different AWS actions than before, update the IAM policy in the same pull request. Treat permissions as part of the code change, not a separate task -- otherwise it is easy to forget and ship broken code.
- Set up a CloudWatch alarm on the Lambda Errors metric with a threshold of 1 and a 1-minute evaluation period. This alerts your team within one invocation cycle if the function starts failing, whether from permission errors or anything else.

## Learning Objectives

1. **Lambda execution roles**: Understand that Lambda functions require an IAM execution role with explicit permissions for every AWS API action the function calls
2. **Least privilege**: IAM denies by default -- when code adds new API calls, the policy must be updated to allow them
3. **Environment parity**: Staging and production should use equivalent IAM policies to catch permission gaps before they reach customers

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[catalog]] -- lambda, iam, dynamodb, cloudwatch service entries
