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

## AWS Docs Links

- [[Amazon SageMaker -- Production Variants|https://docs.aws.amazon.com/sagemaker/latest/dg/endpoint-scaling.html]]
- [[Application Auto Scaling -- SageMaker|https://docs.aws.amazon.com/autoscaling/application/userguide/services-that-can-integrate-sagemaker.html]]
- [[CloudWatch Metrics for SageMaker|https://docs.aws.amazon.com/sagemaker/latest/dg/monitoring-cloudwatch.html]]
- [[CloudWatch Alarm States|https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-states]]

## Learning Objectives

- SageMaker endpoint variant names are embedded in CloudWatch metric dimensions. Changing a variant name orphans any alarm or dashboard referencing the old name.
- Application Auto Scaling depends on CloudWatch alarms to trigger scaling actions. An alarm in `INSUFFICIENT_DATA` state will never trigger scaling, regardless of actual load.
- Blue-green deployments that change resource identifiers must propagate those changes to all dependent configurations: alarms, scaling policies, dashboards, and downstream references.
- The `INSUFFICIENT_DATA` alarm state is a diagnostic signal. It means CloudWatch is not receiving the metric data the alarm expects. This is distinct from `OK` (metric below threshold) and `ALARM` (metric above threshold).

## Related

- [[023-sagemaker-endpoint-scaling/story|The Endpoint That Stopped Thinking -- Story]]
