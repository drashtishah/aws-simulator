---
tags:
  - type/simulation
  - service/lambda
  - service/cloudwatch
  - service/iam
  - difficulty/starter
  - category/operations
---

# A Function in the Wrong Room

## Opening

company: Calendine
industry: scheduling software, seed-stage startup, 8 engineers
product: scheduling tool for independent consultants, single API endpoint handles booking creation -- if endpoint goes down, consultants' clients see blank page where calendar should be
scale: small but critical -- enterprise demo scheduled
time: 14:12 UTC deploy finished, 14:18 UTC smoke test failed
scene: deploy finished clean (green checkmark, clean logs, no warnings), closed terminal tab, went to get water
alert: smoke test at 14:18 UTC returned `message: "Internal server error"`, API Gateway logs showed `ResourceNotFoundException: Function not found` for `calendine-booking-api`
stakes: demo for potential enterprise customer at 14:45 UTC, sales engineer has been preparing since Monday
early_signals:
  - pipeline confirmed successful deployment (green checkmark)
  - API endpoint returns JSON `message: "Internal server error"`
  - CloudWatch API Gateway logs show `ResourceNotFoundException: Function not found`
  - ARN in error points to us-east-1, API Gateway is in us-east-1
  - Lambda console in us-east-1 shows no function named `calendine-booking-api`
investigation_starting_point: the pipeline says the function deployed successfully, but the function does not exist in us-east-1 where the API Gateway expects it. The function is confirmed deployed somewhere, but it is not where it should be.

## Resolution

root_cause: CI/CD pipeline environment had `AWS_DEFAULT_REGION` set to `us-west-2` -- someone on the team changed it the previous week while testing a disaster recovery configuration and never changed it back
mechanism: deploy command had no explicit `--region` flag, so the function deployed to us-west-2 while the API Gateway in us-east-1 referenced an ARN in us-east-1. The function sat in us-west-2 since 14:12 UTC, running normally, waiting for invocations that would never come.
fix: redeploy function to us-east-1 by both correcting `AWS_DEFAULT_REGION` in pipeline configuration and adding explicit `--region us-east-1` flag to deploy script so it never depends on ambient configuration again. Demo happened at 14:52 UTC, seven minutes late. Orphaned function in us-west-2 deleted the following morning.
contributing_factors:
  - no explicit --region flag in deploy command, relying entirely on ambient environment variable
  - disaster recovery testing changed pipeline environment variable without reverting it
  - no post-deploy validation step to confirm function exists in the expected region
