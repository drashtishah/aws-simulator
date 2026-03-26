---
tags:
  - type/resolution
  - service/cloudformation
  - service/iam
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# Resolution: The Stack That Wouldn't Move

## Root Cause

The CloudFormation stack `threadline-prod-stack` entered UPDATE_ROLLBACK_FAILED because a managed RDS instance (`threadline-prod-db`, logical ID `ProdDatabase`) was manually deleted from the AWS Console. When a subsequent stack update failed and CloudFormation attempted to roll back, it could not restore the RDS instance that no longer existed. CloudFormation does not create resources during rollback -- it only reverts to the prior state. With the resource missing, the rollback could not complete.

## Timeline

| Time | Event |
|---|---|
| Fri, Mar 20, 4:47 PM EST | Marcus Chen deletes RDS instance `threadline-prod-db` from the AWS Console |
| Fri, Mar 20, 4:58 PM EST | Marcus leaves for the weekend |
| Sat, Mar 21, 3:00 AM EST | Automated RDS snapshot runs; no instance found, no snapshot created |
| Mon, Mar 23, 9:12 AM EST | CI/CD pipeline triggers `UpdateStack` on `threadline-prod-stack` |
| Mon, Mar 23, 9:13 AM EST | Lambda configuration update begins; validation check fails on unrelated parameter |
| Mon, Mar 23, 9:13 AM EST | CloudFormation initiates rollback (UPDATE_ROLLBACK_IN_PROGRESS) |
| Mon, Mar 23, 9:14 AM EST | Rollback fails on `ProdDatabase` -- resource not found |
| Mon, Mar 23, 9:14 AM EST | Stack enters UPDATE_ROLLBACK_FAILED |
| Mon, Mar 23 - Wed, Mar 25 | Three manual deployment retries, all fail immediately |
| Wed, Mar 25 | Player arrives; four PRs queued, pipeline blocked for three days |

## Correct Remediation

1. **Find the stuck resource**: Look at the stack events (the history of what CloudFormation tried to do). The resource called `ProdDatabase` (the production database) failed during rollback with the reason "DBInstance threadline-prod-db not found." CloudFormation tried to restore the database to its previous state, but the database no longer exists.
2. **Find out who deleted it**: Check CloudTrail -- the AWS audit log that records every API call. Look for a `DeleteDBInstance` event. In this case, IAM user `mchen` deleted it from the web console on Friday at 4:47 PM.
3. **Tell CloudFormation to finish the rollback without the missing database**: Run `aws cloudformation continue-update-rollback --stack-name threadline-prod-stack --resources-to-skip ProdDatabase`. The `--resources-to-skip` flag tells CloudFormation: "pretend this resource rolled back successfully and finish the job." This unsticks the stack.
4. **Confirm the stack is unstuck**: Check that the stack status changes to `UPDATE_ROLLBACK_COMPLETE`. Once it reaches this status, it can accept new updates and the deployment pipeline is unblocked.
5. **Recreate the database**: Update the CloudFormation template and run a stack update to create a new RDS instance. Restore data from the most recent automated snapshot (a backup AWS takes automatically -- in this case, Friday 3:00 AM).
6. **Set up automatic change detection**: Schedule daily drift detection -- a CloudFormation feature that compares what the template says should exist with what actually exists in AWS. Use `aws cloudformation detect-stack-drift` triggered by an EventBridge rule (a scheduler) and a Lambda function. This catches manual changes before they cause rollback failures.
7. **Protect the database from accidental deletion via CloudFormation**: Apply a stack policy -- a set of rules attached to the stack that restricts which resources CloudFormation itself can delete. This adds a safety check when someone changes the template in a way that would remove a critical resource.
8. **Prevent manual deletions in the production account**: Work with the platform team to add a Service Control Policy (SCP) -- an organization-level rule that restricts who can call `rds:DeleteDBInstance` in the production account. Limit it to the CI/CD role only, so individuals cannot delete production databases from the web console.

## Key Concepts

### CloudFormation Keeps Its Own Record of What Exists

CloudFormation maintains an internal model of every resource it manages. It maps template-level names (called logical IDs, like `ProdDatabase`) to actual AWS resources (called physical IDs, like `threadline-prod-db`). This model is how CloudFormation knows what to update, what to roll back, and what to delete.

The critical point: CloudFormation only updates this model when you make changes through CloudFormation itself. If someone deletes or modifies a resource directly in the AWS console, CloudFormation has no idea. Its model still says the resource exists. The mismatch stays hidden until CloudFormation tries to act on that resource -- and then things break.

### What UPDATE_ROLLBACK_FAILED Means

When a stack update fails (for example, a Lambda function cannot be updated), CloudFormation tries to undo the change by rolling back to the previous state. If the rollback itself fails, the stack enters a stuck state called UPDATE_ROLLBACK_FAILED. Common causes:

- A resource was manually deleted outside CloudFormation, so there is nothing to roll back to
- A resource was manually changed to a state that conflicts with what CloudFormation expects
- The deploy role's permissions were changed, so CloudFormation cannot perform the rollback actions
- A resource dependency was removed

The stack is effectively frozen. It cannot accept new updates, and it cannot be deleted. The only way forward is the `continue-update-rollback` command (described below) or contacting AWS Support.

### How to Unstick a Stack with continue-update-rollback

The command `aws cloudformation continue-update-rollback` tells CloudFormation to retry the stuck rollback. The key parameter is `--resources-to-skip`, which accepts a list of resource names (logical IDs) from the template. CloudFormation will finish the rollback while treating those resources as if they rolled back successfully -- even though they did not.

After the rollback completes (the stack reaches UPDATE_ROLLBACK_COMPLETE), the skipped resources are no longer managed by the stack. You must re-add them through a new stack update.

### Drift Detection -- Catching Manual Changes Early

Drift detection is a CloudFormation feature that compares what the template says a resource should look like with what the resource actually looks like in AWS. It reports one of three statuses:

- **IN_SYNC** -- the resource matches the template
- **MODIFIED** -- the resource exists but someone changed its settings outside CloudFormation
- **DELETED** -- the resource no longer exists

Drift detection does not run automatically. You must trigger it yourself -- through the API, the web console, or a scheduled automation. Running it daily catches manual changes before they cause stuck rollbacks.

### Stack Policies -- Protecting Resources from Accidental Template Changes

A stack policy is a set of rules (a JSON document) attached to a stack that controls which resources CloudFormation is allowed to update or delete. For example, you can prevent CloudFormation from deleting the production database even if someone changes the template in a way that removes it.

Important limitation: stack policies only protect against changes made through CloudFormation. They do not prevent someone from deleting a resource directly in the AWS console. For that, you need Service Control Policies (SCPs) or IAM policies.

### Why Manual Changes to CloudFormation-Managed Resources Are Dangerous

CloudFormation assumes it is the sole owner of the resources it manages. When someone modifies a resource outside CloudFormation:

- The next stack update may fail because the real resource does not match what CloudFormation expects
- Rollbacks may fail because the state CloudFormation wants to restore no longer exists
- The mismatch accumulates silently until something breaks -- sometimes weeks later
- A single manual change can block the entire deployment pipeline for the team

## Other Ways This Could Break

### Someone changes a resource's settings through the console instead of deleting it

Instead of deleting the database, someone changes its size or settings directly in the AWS web console -- for example, switching it from a large instance type to a small one, or changing its configuration parameters. CloudFormation does not know this happened. The next stack update may succeed but produce unexpected behavior because the real resource no longer matches what the template describes. If the mismatch is severe enough to conflict with a rollback, the stack can still get stuck. Running drift detection regularly would catch this before it becomes a problem.

### The deploy role's permissions were changed between updates

The role that CloudFormation uses to make changes lost a permission it had during the last successful update. When a new update fails and CloudFormation tries to undo it, it cannot perform the required API calls because the role no longer has the right permissions. The stack gets stuck with AccessDenied errors instead of "resource not found" errors. The fix is to restore the role's permissions and then run continue-update-rollback.

### A stack-within-a-stack (nested stack) gets stuck independently

CloudFormation lets you organize resources into nested stacks -- a parent stack that contains child stacks. A child stack can get stuck in UPDATE_ROLLBACK_FAILED while the parent is still rolling back. You must find the failed resources in the child stack specifically and use a special naming format (`NestedStackName.ResourceLogicalID`) when telling CloudFormation which resources to skip. Using the wrong format produces an error.

### A Lambda function uses a programming language version that AWS no longer supports

A Lambda function in the stack uses a runtime (like Node.js 16) that AWS has retired. An unrelated stack update triggers a rollback, but CloudFormation cannot restore the Lambda function to its previous settings because the old runtime is no longer valid. This is actually what triggered the initial update failure in this sim. On its own, it can also cause the stack to get stuck if the deprecated runtime was the configuration CloudFormation is trying to roll back to.

## SOP Best Practices

- Never modify, delete, or create resources by hand if CloudFormation manages them. CloudFormation keeps its own record of what exists, and when someone changes a resource outside of CloudFormation, that record becomes wrong. The mismatch can stay hidden for weeks and then cause a stuck rollback that blocks the entire team.
- Run drift detection daily at minimum. Drift detection compares what CloudFormation thinks exists with what actually exists in AWS. Alert whenever a resource shows anything other than "in sync." Catching manual changes early prevents them from turning into stuck rollbacks later.
- Preview changes before applying them. CloudFormation has a feature called change sets that shows you exactly what will be created, modified, or deleted before you execute an update. Require peer review for change sets that touch critical resources like databases, encryption keys, or networking components.
- Protect critical resources at multiple levels. Use stack policies (rules attached to the stack) to prevent CloudFormation from accidentally deleting important resources. Use Service Control Policies (organization-level rules) to prevent individuals from deleting production resources through the web console. These two mechanisms cover different threat vectors and work best together.

## Learning Objectives

1. **CloudFormation state model**: Understand that CloudFormation maintains its own state and assumes sole ownership of managed resources. Manual modifications create dangerous state mismatches.
2. **UPDATE_ROLLBACK_FAILED recovery**: Know how to use `ContinueUpdateRollback` with `--resources-to-skip` to unblock a stuck stack.
3. **Drift detection**: Understand that drift detection must be explicitly triggered and can identify resources that have been modified or deleted outside CloudFormation.
4. **Preventive controls**: Know that stack policies protect against CloudFormation-initiated changes, while SCPs and IAM policies are needed to prevent manual console actions.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[catalog]] -- cloudformation, iam, cloudwatch service entries
