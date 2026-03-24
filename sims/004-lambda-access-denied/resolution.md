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

## AWS Documentation Links

- [Lambda Execution Role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [IAM Policies for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/using-identity-based-policies.html)
- [IAM Policy Simulator](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
- [Troubleshooting Lambda AccessDenied](https://docs.aws.amazon.com/lambda/latest/dg/troubleshooting-execution.html)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## Learning Objectives

1. **Lambda execution roles**: Understand that Lambda functions require an IAM execution role with explicit permissions for every AWS API action the function calls
2. **Least privilege**: IAM denies by default -- when code adds new API calls, the policy must be updated to allow them
3. **Environment parity**: Staging and production should use equivalent IAM policies to catch permission gaps before they reach customers

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[catalog]] -- lambda, iam, dynamodb, cloudwatch service entries
