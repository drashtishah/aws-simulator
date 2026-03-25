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

The stack has been in UPDATE_ROLLBACK_FAILED for three days. Nobody can deploy.

Threadline is a project management platform used by about 1,200 teams, mostly mid-size agencies and consultancies. Series B. Thirty-eight engineers. They ship twice a day through a CodePipeline that runs CloudFormation updates against a single production stack. The stack manages everything: the EC2 auto-scaling group, the RDS PostgreSQL instance, three Lambda functions, an SQS queue, and the associated IAM roles. It has worked this way for two years.

On Friday at 4:47 PM, a developer named Marcus Chen opened the RDS console and deleted the production database instance. He did this to save costs. The instance was a db.r5.large and the monthly bill had come up in standup that morning. He did not tell anyone. He did not update the CloudFormation template. He left for the weekend eleven minutes later.

On Monday at 9:12 AM, the CI/CD pipeline picked up a merged pull request and triggered a stack update. CloudFormation attempted to modify the Lambda function configuration. The update itself was routine. But when it failed a validation check on an unrelated parameter and tried to roll back, it discovered that the RDS instance it expected to find -- the one described in its template, the one it believed it owned -- was gone. CloudFormation could not roll back to a state that included a resource that no longer existed. The stack entered UPDATE_ROLLBACK_FAILED.

Since Monday, three more deployment attempts have been made. Each one failed immediately. The stack will not accept updates. It will not delete cleanly. Four pull requests are queued in the pipeline. One of them fixes a billing calculation bug that has been overcharging enterprise customers since Tuesday. The engineering lead has been manually restarting the pipeline each morning, hoping something has changed. Nothing has changed.

The CloudWatch dashboard shows the deployment failure count climbing. The CI/CD role's IAM permissions were tightened last month, and some people on the team suspect that might be the issue. It is not.

You have been asked to look at the stack and figure out why it will not move.

## Resolution

The root cause was a manually deleted RDS instance.

Marcus Chen deleted `threadline-prod-db` (the RDS PostgreSQL instance managed by the CloudFormation stack `threadline-prod-stack`) directly from the AWS Console on Friday, March 20 at 4:47 PM EST. He did not modify the CloudFormation template. He did not run a stack update. He simply deleted the database.

When the CI/CD pipeline triggered a stack update on Monday morning, the update encountered a validation issue and CloudFormation initiated a rollback. During the rollback, CloudFormation attempted to restore the stack to its previous state, which included the RDS instance. The instance no longer existed. CloudFormation cannot create a resource during a rollback -- it can only restore to the prior state. The rollback failed, and the stack entered UPDATE_ROLLBACK_FAILED.

The fix was `aws cloudformation continue-update-rollback` with `--resources-to-skip threadline-prod-db`. This told CloudFormation to complete the rollback while ignoring the missing RDS instance. The stack returned to UPDATE_ROLLBACK_COMPLETE, and deployments resumed.

The RDS instance was then recreated by adding it back to the template and running a normal stack update. The data was restored from the most recent automated snapshot, taken Friday at 3:00 AM.

The team implemented three changes afterward: enabled CloudFormation drift detection on a daily schedule, added a stack policy preventing deletion of the RDS resource through CloudFormation, and requested an SCP from the platform team to restrict manual RDS deletions in the production account. The IAM permissions on the CI/CD role were confirmed to be correct. They had never been the problem.
