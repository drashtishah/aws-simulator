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

## AWS Documentation Links

- [AWS CLI Configuration and Credential File Settings](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
- [Environment Variables for the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html)
- [AWS Lambda Function Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html)
- [API Gateway Lambda Integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-integrations.html)
- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/general/latest/gr/rande.html)

## Learning Objectives

1. **Regional resource isolation**: AWS resources are regional -- a Lambda function in us-west-2 does not exist in us-east-1, even in the same account
2. **Credential resolution chain**: The AWS CLI resolves region from --region flag, then AWS_DEFAULT_REGION, then AWS_REGION, then config file -- knowing this chain is the key to diagnosing deployment issues
3. **Diagnostic commands**: `aws configure list` reveals the active region and its source; it should be the first command run when a deployment target seems wrong
4. **Explicit over implicit**: Deploy scripts should use explicit `--region` flags rather than relying on ambient environment configuration

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment, Domain 4: Troubleshooting
- [[catalog]] -- lambda, cloudwatch, iam service entries
