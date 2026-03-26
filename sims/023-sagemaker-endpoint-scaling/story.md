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

# The Endpoint That Stopped Thinking

## Opening

The first 503 came at 6:14 AM Eastern. By 6:30 there were eighty. The on-call pager fired at 6:22 but by then the dispatch team already knew something was wrong. Routes were not coming back.

Arcline Logistics runs a delivery route optimization service for regional carriers across the eastern seaboard. Fourteen hundred drivers, twelve carriers, each one needing a route computed before leaving the depot. The ML model runs on a SageMaker real-time endpoint called `arcline-route-optimizer`. During the 6 to 9 AM window, prediction requests climb from 200 per minute to 800 per minute. The endpoint is supposed to scale horizontally when load increases. An Application Auto Scaling policy was configured for exactly this scenario. Target tracking on `InvocationsPerInstance`, threshold of 100. Reasonable numbers.

The endpoint has not scaled in three weeks. It runs on a single `ml.g4dn.xlarge` instance. That one instance handles the baseline load without issue. Two hundred requests per minute, model latency at 180 milliseconds p99. Then morning rush arrives and the instance gets buried. Latency climbs to eight seconds. The model starts dropping requests. SageMaker returns 503 `ModelError` responses. The Lambda function that calls the endpoint retries three times, then gives up and sends a notification to the dispatch team to route manually. Manual routing takes twelve extra minutes per driver.

Three weeks ago the ML team ran a blue-green deployment. They replaced the default `AllTraffic` variant with a new production variant called `optimized-v3`. The model was faster, the inference cost was lower, the deployment went smoothly. Nobody checked the auto-scaling configuration afterward. Nobody checked the CloudWatch alarm that drives the scaling decision. The alarm still references the old variant name in its metric dimensions. It has been in `INSUFFICIENT_DATA` state since the deployment. It will stay there until someone looks.

## Resolution

The root cause is a dimension mismatch in the CloudWatch alarm that drives the auto-scaling policy.

Three weeks before the incident, the ML team performed a blue-green deployment on the `arcline-route-optimizer` SageMaker endpoint. The deployment replaced the default production variant `AllTraffic` with a new variant named `optimized-v3`. The model, the instance type, and the endpoint configuration all updated correctly. The endpoint served traffic through the new variant without issue.

The Application Auto Scaling policy was configured with a target tracking scaling policy. The policy relies on a CloudWatch alarm named `arcline-sagemaker-high-invocations`. That alarm monitors the `InvocationsPerInstance` metric in the `AWS/SageMaker` namespace. CloudWatch metrics for SageMaker endpoints are dimensioned by both `EndpointName` and `VariantName`. The alarm was created when the variant was still `AllTraffic`. After the blue-green deployment, the `AllTraffic` variant no longer existed. No metric data points were published to that dimension combination. The alarm entered `INSUFFICIENT_DATA` state and remained there permanently.

The fix has two parts. The immediate remediation is to update the CloudWatch alarm dimensions to reference `VariantName: optimized-v3` instead of `VariantName: AllTraffic`. Once the alarm receives metric data, it evaluates normally and triggers scale-out when `InvocationsPerInstance` exceeds the threshold. The endpoint scales to additional instances during morning rush and the 503 errors stop.

The longer-term fix is to update the deployment pipeline. Any blue-green deployment that changes the production variant name must also update all dependent resources: CloudWatch alarms, scaling policies, dashboards, and any other configuration that references the variant name as a dimension. This can be automated through CloudFormation, CDK, or a post-deployment validation script that checks alarm states and metric data availability.
