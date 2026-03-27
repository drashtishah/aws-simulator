---
tags:
  - type/simulation
  - service/cloudformation
  - service/iam
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# The Stack That Wouldn't Move

## Opening

company: Threadline
industry: project management SaaS, Series B, 38 engineers
product: project management platform used by about 1,200 teams, mostly mid-size agencies and consultancies
infrastructure: ship twice daily through CodePipeline running CloudFormation updates against single production stack (threadline-prod-stack) managing EC2 auto-scaling group, RDS PostgreSQL instance (db.r5.large), three Lambda functions, SQS queue, and IAM roles. Worked this way for two years.
time: Wednesday (stack stuck since Monday at 9:12 AM, root cause from Friday at 4:47 PM)
scene: stack in UPDATE_ROLLBACK_FAILED for three days, nobody can deploy
alert: "UPDATE_ROLLBACK_FAILED -- stack threadline-prod-stack will not accept updates"
stakes: four pull requests queued in pipeline, one fixes billing calculation bug overcharging enterprise customers since Tuesday
early_signals:
  - Friday 4:47 PM: developer Marcus Chen opened RDS console and deleted production database instance to save costs (db.r5.large bill came up in standup). Did not tell anyone, did not update CloudFormation template, left for weekend eleven minutes later.
  - Monday 9:12 AM: CI/CD pipeline triggered stack update for merged PR (routine Lambda function configuration change). Update failed validation check on unrelated parameter, CloudFormation tried to roll back, discovered RDS instance it expected was gone. Stack entered UPDATE_ROLLBACK_FAILED.
  - three more deployment attempts since Monday, each failed immediately
  - stack will not accept updates, will not delete cleanly
  - engineering lead manually restarting pipeline each morning
  - CloudWatch dashboard shows deployment failure count climbing
  - CI/CD role IAM permissions tightened last month, team suspects this is the issue (it is not)
  - Marcus Chen is on PTO this week, Slack status says "hiking in Patagonia"
investigation_starting_point: stack is in UPDATE_ROLLBACK_FAILED. The stack events should reveal which resource caused the rollback failure. The CI/CD role permissions are a red herring -- they were confirmed correct.

## Resolution

root_cause: developer Marcus Chen deleted RDS instance threadline-prod-db (managed by CloudFormation stack threadline-prod-stack) directly from the AWS Console on Friday, March 20 at 4:47 PM EST. Did not modify CloudFormation template or run a stack update.
mechanism: when CI/CD pipeline triggered stack update Monday morning, update encountered a validation issue and CloudFormation initiated rollback. During rollback, CloudFormation attempted to restore stack to previous state which included the RDS instance. Instance no longer existed. CloudFormation cannot create a resource during rollback -- it can only restore to prior state. Rollback failed, stack entered UPDATE_ROLLBACK_FAILED.
fix: aws cloudformation continue-update-rollback --stack-name threadline-prod-stack --resources-to-skip ProdDatabase. Stack returned to UPDATE_ROLLBACK_COMPLETE, deployments resumed. RDS instance recreated by adding it back to template and running normal stack update. Data restored from most recent automated snapshot (Friday 3:00 AM).
contributing_factors:
  - no drift detection to catch manual resource deletion before next deployment
  - no stack policy preventing deletion of critical resources
  - no SCP restricting manual RDS deletions in production account
  - team implemented all three afterward: daily drift detection, stack policy on RDS resource, SCP from platform team
  - IAM permissions on CI/CD role confirmed correct -- never the problem
