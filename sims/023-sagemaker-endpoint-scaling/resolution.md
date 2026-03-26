---
tags:
  - type/simulation
  - service/sagemaker
  - service/cloudwatch
  - service/auto-scaling
  - service/lambda
  - difficulty/professional
  - category/performance
---

# Resolution -- The Endpoint That Stopped Thinking

## Root Cause

The Application Auto Scaling policy for the SageMaker endpoint `arcline-route-optimizer` depends on a CloudWatch alarm that monitors `InvocationsPerInstance`. That alarm specifies two dimensions: `EndpointName=arcline-route-optimizer` and `VariantName=AllTraffic`. After a blue-green deployment three weeks prior, the production variant was renamed from `AllTraffic` to `optimized-v3`. The `AllTraffic` variant no longer exists. CloudWatch receives no data points for that dimension combination. The alarm entered `INSUFFICIENT_DATA` state immediately after the deployment and never recovered. Without the alarm firing, the scaling policy never triggered, and the endpoint remained at one instance through every morning traffic spike.

## Timeline

| Time | Event |
|------|-------|
| 2026-03-04 14:22 UTC | Blue-green deployment completes. Variant `optimized-v3` replaces `AllTraffic`. |
| 2026-03-04 14:22 UTC | CloudWatch alarm `arcline-sagemaker-high-invocations` stops receiving data. State transitions to `INSUFFICIENT_DATA`. |
| 2026-03-05 06:15 UTC | First morning spike post-deployment. Endpoint does not scale. 503 errors begin. |
| 2026-03-05 through 2026-03-24 | Pattern repeats every weekday morning. Dispatch team routes manually during 6-9 AM. |
| 2026-03-25 06:14 UTC | Current incident. 503 errors detected. Investigation begins. |
| 2026-03-25 06:45 UTC | Alarm dimension mismatch identified. |
| 2026-03-25 06:52 UTC | Alarm updated to reference `VariantName=optimized-v3`. |
| 2026-03-25 06:55 UTC | Alarm evaluates, transitions to `ALARM`. Scaling action triggers. |
| 2026-03-25 07:03 UTC | Second instance reaches `InService`. 503 errors stop. |

## Correct Remediation

### Immediate Fix

The alarm is watching a variant that no longer exists. Fix it by updating the alarm's dimensions -- the name-value pairs that tell the alarm exactly which resource to watch. The key change: replace VariantName=AllTraffic with VariantName=optimized-v3.

Use the `put-metric-alarm` command to update the alarm. This command replaces the alarm's configuration entirely, so you need to include all the existing settings along with the corrected dimension:

```
aws cloudwatch put-metric-alarm \
  --alarm-name arcline-sagemaker-high-invocations \
  --namespace AWS/SageMaker \
  --metric-name InvocationsPerInstance \
  --dimensions Name=EndpointName,Value=arcline-route-optimizer Name=VariantName,Value=optimized-v3 \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:autoscaling:us-east-1:891377106058:scalingPolicy:...
```

You also need to fix the auto-scaling target. Application Auto Scaling uses a resource ID to know which resource to scale. Delete the old scalable target (which still points to variant/AllTraffic) and register a new one using `register-scalable-target` and `put-scaling-policy` with the corrected resource ID:

```
Resource ID: endpoint/arcline-route-optimizer/variant/optimized-v3
```

### Process Improvement

To prevent this from happening again, add an automated validation step that runs right after every blue-green deployment:

1. After the variant switch completes, list all CloudWatch alarms that reference the endpoint name.
2. For each alarm, verify that the `VariantName` dimension matches the name of the variant that is actually serving traffic.
3. Check that no alarms are in `INSUFFICIENT_DATA` state (which means they are not receiving data -- a strong sign of a dimension mismatch).
4. If any alarm references a retired variant, fail the deployment validation so the team is forced to fix it before moving on.

## Key Concepts

### SageMaker Endpoint Variants

A SageMaker endpoint is a hosted URL where your trained ML model runs and accepts prediction requests. An endpoint can host multiple production variants -- think of these as different versions of your model, each with its own instance type and instance count. When you do a blue-green deployment (replacing the old version with a new one), the variant name changes. Here is the critical detail: all CloudWatch metrics for the endpoint include the variant name as a label (called a dimension). If the variant name changes and you do not update all the alarms and scaling configs that reference it, those configurations become orphaned -- they are watching a variant that no longer exists and will never receive new data.

### CloudWatch Metric Dimensions

CloudWatch metrics are identified by three things: a namespace (like AWS/SageMaker), a metric name (like InvocationsPerInstance), and dimensions -- name-value pairs that specify exactly which resource the metric comes from. For SageMaker, the dimensions are EndpointName and VariantName. This means an alarm watching VariantName=AllTraffic and an alarm watching VariantName=optimized-v3 are tracking two completely separate data streams. When a variant is retired, its dimension combination stops receiving new data points. The alarm does not automatically switch to watching the new variant -- it just goes blind, entering a state called INSUFFICIENT_DATA.

### Application Auto Scaling

Application Auto Scaling is the AWS service that automatically adds or removes instances behind your endpoint based on demand. For SageMaker, it uses a resource ID in the format `endpoint/{endpoint-name}/variant/{variant-name}` to know which resource to scale. A target tracking policy watches a metric (typically InvocationsPerInstance, which counts how many requests each instance handles per minute) and adds instances when the value exceeds a target. The catch: if the variant name in the resource ID no longer matches the active variant, the entire scaling mechanism breaks silently. The policy still exists and looks configured, but it never activates because it is pointing at a resource that is gone.

## Other Ways This Could Break

### Scaling Policy Resource ID References a Retired Variant

In this variation, the CloudWatch alarm is fixed and watching the right variant, but the auto-scaling configuration itself still points to the old variant name in its resource ID (`endpoint/arcline-route-optimizer/variant/AllTraffic`). The alarm fires correctly, but when auto-scaling tries to add instances, it targets a variant that no longer exists. Instead of seeing no scaling activity at all (like in this sim), the `describe-scaling-activities` output would show failed activities -- the system tried to scale but could not find the resource.

**Prevention:** After every blue-green deployment, verify that the scalable target resource ID matches the active variant by running `describe-scalable-targets`. Automate this check as a post-deployment step so it cannot be forgotten.

### Service Quota Blocks Scale-Out Despite Alarm Firing

Everything is configured correctly -- the alarm fires, the scaling policy triggers. But AWS enforces limits (called service quotas) on how many instances of each type your account can run. If you have hit the quota for `ml.g4dn.xlarge` instances, the scaling action fails with a "resource limit exceeded" error. The endpoint stays stuck at one instance. The symptoms look the same -- 503 errors during peak traffic -- but `describe-scaling-activities` reveals a failed activity with a quota error message.

**Prevention:** Before deploying to production, check your service quotas (account-level limits on each instance type) using the Service Quotas console. Request increases ahead of time when you expect traffic growth. Set up a CloudWatch alarm on failed scaling activities so you find out immediately when a scale-out attempt is rejected.

### Cooldown Period Prevents Repeated Scale-Out

The alarm and scaling policy are both correct. The first scale-out triggers successfully and adds an instance. But traffic keeps climbing and you need another instance. The `ScaleOutCooldown` setting -- a waiting period designed to prevent the system from adding and removing instances too rapidly (called thrashing) -- blocks the next scale-out until the timer expires. If the cooldown is set too high (say, 10 minutes instead of 60 seconds), the endpoint stays under-provisioned during a rapid traffic ramp. The alarm remains in ALARM state but no new scaling actions happen until the cooldown runs out.

**Prevention:** Set `ScaleOutCooldown` to a value that balances responsiveness against thrashing. For traffic patterns with sharp ramps like a morning rush, keep cooldown at 60-120 seconds. Monitor scaling activities during peak windows to confirm that multiple scale-out steps complete when needed.

## SOP Best Practices

- Whenever a deployment changes the name of a SageMaker endpoint variant (which happens in blue-green deployments, where a new version replaces the old one), check every CloudWatch alarm and auto-scaling resource ID that references the endpoint. They all need to be updated to the new variant name, or they will silently stop working.
- Add an automated check that runs right after every deployment. It should look at every CloudWatch alarm connected to the endpoint and verify none are in INSUFFICIENT_DATA state. That state means the alarm is not receiving any metric data -- a strong signal that its dimensions (the name-value pairs specifying which resource to watch) point to a variant that no longer exists.
- Define your endpoint, scaling policy, and alarms together using Infrastructure as Code tools like CloudFormation, CDK, or Terraform. When all these resources are defined in the same template, changing the variant name in one place automatically updates it everywhere else. This eliminates the manual step that was missed in this incident.
- Set up a CloudWatch alarm that watches for two warning signs: failed scaling activities (meaning auto-scaling tried to add instances but could not) and alarms that transition to INSUFFICIENT_DATA state (meaning they lost their data source). Catching these signals within minutes prevents problems from running silently for weeks.

## Learning Objectives

- SageMaker endpoint variant names are embedded in CloudWatch metric dimensions. Changing a variant name orphans any alarm or dashboard referencing the old name.
- Application Auto Scaling depends on CloudWatch alarms to trigger scaling actions. An alarm in `INSUFFICIENT_DATA` state will never trigger scaling, regardless of actual load.
- Blue-green deployments that change resource identifiers must propagate those changes to all dependent configurations: alarms, scaling policies, dashboards, and downstream references.
- The `INSUFFICIENT_DATA` alarm state is a diagnostic signal. It means CloudWatch is not receiving the metric data the alarm expects. This is distinct from `OK` (metric below threshold) and `ALARM` (metric above threshold).

## Related

- [[023-sagemaker-endpoint-scaling/story|The Endpoint That Stopped Thinking -- Story]]
