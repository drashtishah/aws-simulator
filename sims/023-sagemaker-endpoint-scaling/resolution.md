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

Update the CloudWatch alarm dimensions:

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

Alternatively, delete the existing scaling policy and recreate it using `register-scalable-target` and `put-scaling-policy` with the correct resource ID that includes the new variant name:

```
Resource ID: endpoint/arcline-route-optimizer/variant/optimized-v3
```

### Process Improvement

Add a post-deployment validation step to the blue-green deployment pipeline:

1. After variant switch, enumerate all CloudWatch alarms that reference the endpoint name.
2. Verify each alarm's `VariantName` dimension matches the active production variant.
3. Check that no alarms are in `INSUFFICIENT_DATA` state.
4. Fail the deployment validation if any alarm references a retired variant.

## Key Concepts

### SageMaker Endpoint Variants

SageMaker endpoints can host multiple production variants, each with its own model, instance type, and instance count. When a blue-green deployment creates a new variant and retires the old one, the variant name changes. All CloudWatch metrics for the endpoint are published with the variant name as a dimension. Any monitoring or scaling configuration that references the old variant name becomes orphaned.

### CloudWatch Metric Dimensions

CloudWatch metrics are uniquely identified by namespace, metric name, and dimensions. For `AWS/SageMaker`, the `InvocationsPerInstance` metric uses `EndpointName` and `VariantName` as dimensions. An alarm configured with `VariantName=AllTraffic` is a completely different metric from one with `VariantName=optimized-v3`. When the variant is retired, the old dimension combination stops receiving data. The alarm does not automatically follow the new variant.

### Application Auto Scaling

Application Auto Scaling for SageMaker endpoints uses the resource ID format `endpoint/{endpoint-name}/variant/{variant-name}`. Target tracking policies create and manage CloudWatch alarms automatically. However, if a scaling policy was created with a custom alarm or if the variant name in the resource ID no longer matches the active variant, the scaling mechanism breaks silently. The scaling policy remains configured but never activates.

## Other Ways This Could Break

### Scaling Policy Resource ID References a Retired Variant

The CloudWatch alarm dimensions could be correct, but the Application Auto Scaling scalable target and policy still reference the old variant name in their ResourceId (`endpoint/arcline-route-optimizer/variant/AllTraffic`). The alarm fires correctly, but the scaling action targets a variant that no longer exists, so no instances are added. The `describe-scaling-activities` output would show failed activities rather than an empty list.

**Prevention:** After any blue-green deployment, verify the scalable target resource ID matches the active variant by running `describe-scalable-targets`. Automate this check as a post-deployment step in the pipeline.

### Service Quota Blocks Scale-Out Despite Alarm Firing

The alarm and scaling policy are configured correctly. The alarm transitions to ALARM state and triggers a scaling action. However, the account has reached its service quota for the `ml.g4dn.xlarge` instance type. The scaling activity fails with a "resource limit exceeded" error. The endpoint stays at one instance. The symptoms look similar -- 503 errors during peak -- but `describe-scaling-activities` shows a failed activity with a quota error message.

**Prevention:** Before deploying to production, check your service quotas for the endpoint's instance type using the Service Quotas console. Request quota increases proactively when planning for expected traffic growth. Set up a CloudWatch alarm on failed scaling activities.

### Cooldown Period Prevents Repeated Scale-Out

The scaling policy and alarm are correct. The first scale-out triggers successfully. But traffic continues to climb and a second scale-out is needed. The `ScaleOutCooldown` period prevents additional scaling actions during the cooldown window. If the cooldown is set too high, the endpoint remains under-provisioned during rapid traffic ramps. The alarm stays in ALARM state but no new scaling actions occur until the cooldown expires.

**Prevention:** Set `ScaleOutCooldown` to a value that balances responsiveness against thrashing. For traffic patterns with sharp ramps like morning rush, keep cooldown at 60-120 seconds. Monitor scaling activities during peak windows to confirm multiple scale-out steps complete.

## SOP Best Practices

- After any blue-green or rolling deployment that changes a SageMaker endpoint variant name, verify that all CloudWatch alarm dimensions and Application Auto Scaling resource IDs reference the new variant name.
- Add a post-deployment validation step that checks the state of all CloudWatch alarms associated with the endpoint -- any alarm in INSUFFICIENT_DATA state immediately after deployment is a sign of a dimension mismatch.
- Use Infrastructure as Code (CloudFormation, CDK, or Terraform) to define the endpoint, scaling policy, and alarms together so that variant name changes propagate automatically to all dependent resources.
- Set up a CloudWatch alarm on describe-scaling-activities failures and on INSUFFICIENT_DATA state transitions so that broken scaling configurations are detected within minutes, not weeks.

## Learning Objectives

- SageMaker endpoint variant names are embedded in CloudWatch metric dimensions. Changing a variant name orphans any alarm or dashboard referencing the old name.
- Application Auto Scaling depends on CloudWatch alarms to trigger scaling actions. An alarm in `INSUFFICIENT_DATA` state will never trigger scaling, regardless of actual load.
- Blue-green deployments that change resource identifiers must propagate those changes to all dependent configurations: alarms, scaling policies, dashboards, and downstream references.
- The `INSUFFICIENT_DATA` alarm state is a diagnostic signal. It means CloudWatch is not receiving the metric data the alarm expects. This is distinct from `OK` (metric below threshold) and `ALARM` (metric above threshold).

## Related

- [[023-sagemaker-endpoint-scaling/story|The Endpoint That Stopped Thinking -- Story]]
