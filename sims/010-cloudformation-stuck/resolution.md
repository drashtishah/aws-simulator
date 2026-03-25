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

1. **Identify the stuck resource**: Review stack events to find which resource caused the rollback failure. The `ProdDatabase` (RDS instance) shows `UPDATE_ROLLBACK_FAILED` with status reason "DBInstance threadline-prod-db not found."
2. **Check CloudTrail**: Confirm the RDS instance was manually deleted by reviewing the `DeleteDBInstance` API call in CloudTrail. The call was made by IAM user `mchen` on Friday at 4:47 PM.
3. **Continue the rollback**: Run `aws cloudformation continue-update-rollback --stack-name threadline-prod-stack --resources-to-skip ProdDatabase` to complete the stuck rollback by skipping the missing resource.
4. **Verify stack state**: Confirm the stack returns to `UPDATE_ROLLBACK_COMPLETE`. Deployments are now unblocked.
5. **Recreate the RDS instance**: Update the CloudFormation template and run a stack update to recreate the RDS instance. Restore data from the most recent automated snapshot (Friday 3:00 AM).
6. **Enable drift detection**: Schedule daily drift detection using `aws cloudformation detect-stack-drift` via EventBridge + Lambda to catch future manual modifications.
7. **Add stack policy**: Apply a stack policy that prevents CloudFormation from deleting the RDS resource without explicit override, adding a layer of protection for critical resources.
8. **Request SCP**: Work with the platform team to add a Service Control Policy restricting `rds:DeleteDBInstance` in the production account to specific roles (CI/CD role only).

## Key Concepts

### CloudFormation State Model

CloudFormation maintains an internal model of every resource it manages. It tracks logical IDs (template-level names like `ProdDatabase`) mapped to physical IDs (actual AWS resource identifiers like `threadline-prod-db`). When you modify or delete a resource outside CloudFormation, the internal model becomes stale. CloudFormation does not know the resource is gone until it tries to act on it.

### UPDATE_ROLLBACK_FAILED

This state occurs when CloudFormation starts a rollback after a failed update but cannot complete the rollback. Common causes:

- A resource was manually deleted outside CloudFormation
- A resource was manually modified to a state that conflicts with the rollback target
- IAM permissions changed since the last successful update
- A resource dependency was removed

The stack is effectively frozen in this state. No updates, no deletions. The only way forward is `ContinueUpdateRollback` or contacting AWS Support.

### ContinueUpdateRollback

The `aws cloudformation continue-update-rollback` API tells CloudFormation to retry the rollback. The critical parameter is `--resources-to-skip`, which accepts a list of logical resource IDs. CloudFormation will complete the rollback while treating those resources as if they successfully rolled back, regardless of their actual state.

After the rollback completes (stack enters `UPDATE_ROLLBACK_COMPLETE`), the skipped resources are no longer managed by the stack. You must re-add them through a subsequent stack update.

### Drift Detection

CloudFormation drift detection compares the expected resource configuration (from the last successful stack operation) with the actual configuration in AWS. It reports:

- **IN_SYNC** -- resource matches the template
- **MODIFIED** -- resource exists but properties differ
- **DELETED** -- resource no longer exists

Drift detection does not run automatically. You must trigger it via the API, the console, or a scheduled automation (EventBridge rule + Lambda).

### Stack Policies

Stack policies are JSON documents attached to a stack that control which resources can be updated or deleted through CloudFormation. They protect against accidental template changes but do not prevent manual console actions. A stack policy denying `Update:Delete` on the RDS resource would prevent a CloudFormation update from deleting it, but would not have prevented Marcus from deleting it through the console.

### Why Manual Changes Are Dangerous

CloudFormation assumes it is the sole owner of the resources it manages. When a human modifies a resource outside CloudFormation:

- The next stack update may fail because actual state does not match expected state
- Rollbacks may fail because the rollback target state no longer exists
- Drift accumulates silently until something breaks
- The blast radius is unpredictable -- a single manual change can block the entire deployment pipeline

## AWS Documentation Links

- [Troubleshooting CloudFormation -- Update Rollback Failed](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html#troubleshooting-errors-update-rollback-failed)
- [ContinueUpdateRollback API Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ContinueUpdateRollback.html)
- [Detecting Unmanaged Configuration Changes with Drift Detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
- [Prevent Updates to Stack Resources with Stack Policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html)
- [CloudFormation Stack Statuses](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-view-stack-data-resources.html)
- [Service Control Policies (SCPs)](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)

## Learning Objectives

1. **CloudFormation state model**: Understand that CloudFormation maintains its own state and assumes sole ownership of managed resources. Manual modifications create dangerous state mismatches.
2. **UPDATE_ROLLBACK_FAILED recovery**: Know how to use `ContinueUpdateRollback` with `--resources-to-skip` to unblock a stuck stack.
3. **Drift detection**: Understand that drift detection must be explicitly triggered and can identify resources that have been modified or deleted outside CloudFormation.
4. **Preventive controls**: Know that stack policies protect against CloudFormation-initiated changes, while SCPs and IAM policies are needed to prevent manual console actions.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[catalog]] -- cloudformation, iam, cloudwatch service entries
