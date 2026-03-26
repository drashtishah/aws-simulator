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

1. **Find out where the CLI is sending commands**: Run `aws configure list`. This shows the current region setting and tells you where it comes from -- an environment variable, a config file, or a flag you typed. In this case, it reveals the CLI is targeting `us-west-2` instead of `us-east-1`.
2. **Confirm the function landed in the wrong place**: Run `aws lambda get-function --function-name calendine-booking-api --region us-west-2`. If the function shows up here, the deploy went to the wrong region.
3. **Redeploy to the correct region**: Run `aws lambda update-function-code --function-name calendine-booking-api --region us-east-1 --s3-bucket calendine-deploy --s3-key booking-api/latest.zip`. The `--region` flag overrides any default setting and sends the deploy exactly where you want it.
4. **Fix the pipeline so it does not happen again**: The environment variable `AWS_DEFAULT_REGION` tells the CLI which region to use when no `--region` flag is given. Update it to `us-east-1` in the CI/CD workflow file.
5. **Add a permanent safeguard**: Put an explicit `--region us-east-1` flag in the deploy command itself. Even if someone changes the environment variable later, the deploy will still go to the right region.
6. **Clean up the accidental copy**: Delete the orphaned function in `us-west-2` so it does not cost money or confuse anyone: `aws lambda delete-function --function-name calendine-booking-api --region us-west-2`

## Key Concepts

### How the CLI Decides Which Region to Use

When you run an AWS CLI command, it needs to know which region to talk to. It checks several places in a fixed order, and the first one it finds wins:

1. **The `--region` flag on the command itself** -- highest priority, overrides everything else
2. **The `AWS_DEFAULT_REGION` environment variable** -- a setting baked into the shell environment, common in CI/CD pipelines
3. **The `AWS_REGION` environment variable** -- similar to the above, but preferred by some programming language SDKs
4. **The config file** (`~/.aws/config`) -- a file on disk where you can save a default region
5. **Instance metadata** (EC2/ECS) -- used when your code runs on AWS infrastructure itself

This order matters because if an environment variable is set, the CLI will use it even if your config file says something different. In this incident, the environment variable pointed to the wrong region, and nobody noticed because the config file was never consulted.

### aws configure list -- Your First Diagnostic Command

This command shows you exactly what the CLI is using right now and where each setting comes from:

```
      Name                    Value             Type    Location
      ----                    -----             ----    --------
   profile                <not set>             None    None
access_key     ****************3K7A              env    AWS_ACCESS_KEY_ID
secret_key     ****************mN9v              env    AWS_SECRET_ACCESS_KEY
    region                us-west-2              env    AWS_DEFAULT_REGION
```

The `Type` column is the key. It tells you the source: `env` means an environment variable, `config-file` means the config file on disk, and `iam-role` means the machine itself is providing credentials. In this incident, the region row shows `us-west-2` coming from the environment variable `AWS_DEFAULT_REGION`.

### aws sts get-caller-identity -- Checking Who You Are

This command answers the question "which AWS account and user is the CLI acting as right now?" It does not tell you the region, but it confirms you are logged in and shows your account number -- helpful when you want to make sure you are deploying to the right account.

### Every Resource Address Includes the Region

Every AWS resource has a unique address called an ARN (Amazon Resource Name). For a Lambda function, the ARN looks like this: `arn:aws:lambda:us-east-1:491783620174:function:calendine-booking-api`. Notice that `us-east-1` is baked into the address. The API Gateway is configured to call this exact address. If the function was deployed to `us-west-2` instead, it has a different ARN, and the address the API Gateway is looking for simply does not exist. AWS returns a "resource not found" error (called `ResourceNotFoundException`).

## Other Ways This Could Break

### The deployment zip file is stored in a different region than the function
The function itself is in the right region, but the zip file containing the code is stored in an S3 bucket in a different region. AWS requires the S3 bucket and the Lambda function to be in the same region. When they are not, AWS returns a redirect error (`PermanentRedirect`) instead of deploying the code.
**Prevention:** Create a separate S3 bucket for deployment artifacts in each region where you run Lambda functions. Have your pipeline verify that the bucket region matches the function region before deploying.

### The API Gateway points to a function in a different AWS account
The function is in the correct region, but it lives in a different AWS account. Every resource address (ARN) includes the account number, and if the account number does not match, AWS reports the function as "not found" -- even though it exists elsewhere. Allowing cross-account access requires extra permission configuration on the function itself.
**Prevention:** Before deploying, run `aws sts get-caller-identity` to confirm you are operating in the correct account. Hard-code the account ID in the API Gateway integration so mismatches are caught immediately.

### Two region variables conflict with each other
AWS has two environment variables that control the target region: `AWS_DEFAULT_REGION` (used by the CLI) and `AWS_REGION` (preferred by some programming language SDKs). If both are set to different values, the CLI might deploy to one region while application code running in a different language SDK talks to another region.
**Prevention:** Always set both `AWS_REGION` and `AWS_DEFAULT_REGION` to the same value in your CI/CD environment. Even better, use explicit `--region` flags so you never depend on either variable.

### The function exists but the API Gateway references a version label that was never created
The function is in the right region and account, but the API Gateway's address includes a version label (like `:prod`) that does not exist yet. Think of it like mailing a letter to the right building but the wrong apartment number -- the building exists, but the specific unit does not. AWS returns the same "not found" error.
**Prevention:** Use version labels (called aliases in Lambda) that your deployment pipeline creates automatically. After each deploy, verify the alias exists by running `aws lambda get-alias` before updating the API Gateway.

## SOP Best Practices

- Always spell out the region explicitly in deploy commands using the `--region` flag. Do not rely on environment variables or config files to pick the right region -- those defaults are the most common reason deploys end up in the wrong place.
- When a deploy produces a "resource not found" error (called `ResourceNotFoundException`), the first thing to check is which region the CLI is targeting. Run `aws configure list` -- it shows the active region and where that setting is coming from.
- If your CI/CD environment uses region variables, make sure both `AWS_REGION` and `AWS_DEFAULT_REGION` are set to the same value. Different tools read different variables, and a mismatch means some tools talk to one region while others talk to another.
- After fixing a wrong-region deploy, go back and delete the accidental copy of the resource in the wrong region. Leftover resources cost money and confuse anyone who looks at the account later.

## Learning Objectives

1. **Regional resource isolation**: AWS resources are regional -- a Lambda function in us-west-2 does not exist in us-east-1, even in the same account
2. **Credential resolution chain**: The AWS CLI resolves region from --region flag, then AWS_DEFAULT_REGION, then AWS_REGION, then config file -- knowing this chain is the key to diagnosing deployment issues
3. **Diagnostic commands**: `aws configure list` reveals the active region and its source; it should be the first command run when a deployment target seems wrong
4. **Explicit over implicit**: Deploy scripts should use explicit `--region` flags rather than relying on ambient environment configuration

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment, Domain 4: Troubleshooting
- [[catalog]] -- lambda, cloudwatch, iam service entries
