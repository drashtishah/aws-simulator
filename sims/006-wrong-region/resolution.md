---
tags:
  - type/resolution
  - service/lambda
  - service/cloudwatch
  - service/iam
  - difficulty/starter
  - category/operations
---

# Resolution: A Function in the Wrong Room

## Root Cause

The Lambda function `calendine-booking-api` was deployed to `us-west-2` instead of `us-east-1`. The CI/CD pipeline environment had `AWS_DEFAULT_REGION=us-west-2`, set the previous week during disaster recovery testing and never reverted. The API Gateway in `us-east-1` references the function ARN `arn:aws:lambda:us-east-1:491783620174:function:calendine-booking-api`. Because the function does not exist in `us-east-1`, every invocation returns `ResourceNotFoundException`.

## Timeline

| Time (UTC) | Event |
|---|---|
| 2026-03-25T13:45:00Z | Developer pushes code to main branch, CI/CD pipeline triggers |
| 2026-03-25T14:10:22Z | Pipeline build step completes successfully |
| 2026-03-25T14:12:08Z | Pipeline deploy step runs `aws lambda update-function-code`; AWS_DEFAULT_REGION resolves to us-west-2 |
| 2026-03-25T14:12:11Z | Function `calendine-booking-api` updated in us-west-2 (deploy succeeds) |
| 2026-03-25T14:18:33Z | Developer smoke-tests the API endpoint in us-east-1; receives "Internal server error" |
| 2026-03-25T14:19:01Z | CloudWatch logs for API Gateway show ResourceNotFoundException for us-east-1 Lambda ARN |
| 2026-03-25T14:22:15Z | Developer checks Lambda console in us-east-1; function does not exist |
| 2026-03-25T14:28:40Z | Developer runs `aws configure list` and discovers region is us-west-2 |
| 2026-03-25T14:30:12Z | Developer confirms function exists in us-west-2 with `aws lambda get-function --region us-west-2` |
| 2026-03-25T14:35:44Z | Function redeployed to us-east-1 with explicit `--region us-east-1` flag |
| 2026-03-25T14:36:02Z | API endpoint returns 200. Booking creation works. |
| 2026-03-25T14:40:00Z | CI/CD pipeline environment variable corrected to `AWS_DEFAULT_REGION=us-east-1` |

## Correct Remediation

1. **Identify the mismatch**: Run `aws configure list` to see the active region and its source (environment variable, config file, or flag)
2. **Confirm the function location**: Run `aws lambda get-function --function-name calendine-booking-api --region us-west-2` to confirm the function exists in the wrong region
3. **Redeploy to the correct region**: Run `aws lambda update-function-code --function-name calendine-booking-api --region us-east-1 --s3-bucket calendine-deploy --s3-key booking-api/latest.zip`
4. **Fix the pipeline**: Update `AWS_DEFAULT_REGION` in the CI/CD environment to `us-east-1`
5. **Prevent recurrence**: Add an explicit `--region us-east-1` flag to the deploy script so it does not rely on ambient configuration
6. **Cleanup**: Delete the orphaned function in us-west-2 to avoid confusion and cost

## Key Concepts

### AWS Region and Credential Resolution Chain

The AWS CLI and SDKs resolve the region using a priority chain. Understanding this chain is essential for debugging region-related deployment issues:

1. **Explicit `--region` flag** -- highest priority, overrides everything
2. **`AWS_DEFAULT_REGION` environment variable** -- common in CI/CD pipelines
3. **`AWS_REGION` environment variable** -- used by some SDKs
4. **Config file** (`~/.aws/config`) -- the `region` setting under the active profile
5. **Instance metadata** (EC2/ECS) -- used when running on AWS infrastructure

The command `aws configure list` shows the active value for each setting and where it came from (env, config file, or instance metadata). This is the single most useful diagnostic command for region and credential issues.

### aws configure list

This command displays the current configuration, including the region and its source:

```
      Name                    Value             Type    Location
      ----                    -----             ----    --------
   profile                <not set>             None    None
access_key     ****************3K7A              env    AWS_ACCESS_KEY_ID
secret_key     ****************mN9v              env    AWS_SECRET_ACCESS_KEY
    region                us-west-2              env    AWS_DEFAULT_REGION
```

The `Type` and `Location` columns tell you exactly where the value is coming from. In this incident, it shows the region is `us-west-2` from the `AWS_DEFAULT_REGION` environment variable.

### aws sts get-caller-identity

This command confirms which AWS account and IAM principal is making API calls. It does not tell you the region, but it confirms you are authenticated and shows the account ID -- useful for verifying you are deploying to the right account.

### Lambda ARNs Are Regional

A Lambda function ARN includes the region: `arn:aws:lambda:us-east-1:491783620174:function:calendine-booking-api`. An API Gateway integration that references this ARN expects the function to exist in `us-east-1`. If the function is deployed to `us-west-2` instead, the ARN does not resolve and the invocation fails with `ResourceNotFoundException`.

## Other Ways This Could Break

### S3 deployment bucket in a different region than the Lambda function
Instead of the function being in the wrong region, the deployment artifact (zip file in S3) is in a different region than the target function. Lambda returns PermanentRedirect because the S3 bucket must be in the same region as the function.
**Prevention:** Create a deployment artifact S3 bucket in each region where you deploy Lambda functions. Validate that the bucket region matches the function region in the pipeline.

### API Gateway integration ARN points to a different account
The function exists in the correct region but in a different AWS account. The ARN includes the account ID, so a mismatch produces the same ResourceNotFoundException. Cross-account invocation requires explicit Lambda resource policy permissions.
**Prevention:** Use aws sts get-caller-identity in the pipeline to confirm the account ID before deploying. Pin the account ID in the API Gateway integration ARN.

### AWS_REGION and AWS_DEFAULT_REGION set to different values
The CLI uses AWS_DEFAULT_REGION, but some SDKs prefer AWS_REGION. If both are set to different values, the CLI and the application code may target different regions, causing the function to deploy to one region while the SDK-based integration expects another.
**Prevention:** Set both AWS_REGION and AWS_DEFAULT_REGION to the same value in CI/CD environments. Better yet, use explicit --region flags and region parameters in code.

### Lambda function alias or version referenced in API Gateway does not exist
The function exists in the correct region, but the API Gateway integration ARN includes a version number or alias (e.g., :prod) that has not been published. The ARN does not resolve, producing the same ResourceNotFoundException.
**Prevention:** Use Lambda aliases managed by your deployment pipeline. Verify the alias exists after each deploy with aws lambda get-alias before updating the API Gateway integration.

## SOP Best Practices

- Always use explicit --region flags in CI/CD deploy commands rather than relying on AWS_DEFAULT_REGION or config file defaults -- ambient configuration is the most common source of wrong-region deployments
- Run aws configure list as the first diagnostic step when any deployment produces unexpected ResourceNotFoundException or region-related errors
- Pin both AWS_REGION and AWS_DEFAULT_REGION to the same value in pipeline environments, and treat any divergence as a configuration error
- After fixing a wrong-region deployment, delete orphaned resources in the incorrect region to avoid phantom costs and debugging confusion

## Learning Objectives

1. **Regional resource isolation**: AWS resources are regional -- a Lambda function in us-west-2 does not exist in us-east-1, even in the same account
2. **Credential resolution chain**: The AWS CLI resolves region from --region flag, then AWS_DEFAULT_REGION, then AWS_REGION, then config file -- knowing this chain is the key to diagnosing deployment issues
3. **Diagnostic commands**: `aws configure list` reveals the active region and its source; it should be the first command run when a deployment target seems wrong
4. **Explicit over implicit**: Deploy scripts should use explicit `--region` flags rather than relying on ambient environment configuration

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment, Domain 4: Troubleshooting
- [[catalog]] -- lambda, cloudwatch, iam service entries
