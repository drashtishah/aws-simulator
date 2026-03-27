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

company: Arcline Logistics
industry: supply chain, growth-stage, 64 engineers
product: delivery route optimization service for regional carriers across the eastern seaboard
scale: 1,400 drivers, 12 carriers, each needing a route computed before leaving the depot
model: ML model on SageMaker real-time endpoint called arcline-route-optimizer, single ml.g4dn.xlarge instance, production variant optimized-v3
time: 6:14 AM Eastern
scene: morning rush window (6-9 AM), prediction requests climb from 200/min to 800/min
alert: first 503 at 6:14 AM, 80 by 6:30 AM, on-call pager fired at 6:22 AM
stakes: dispatch team already knows routes are not coming back, manual routing takes 12 extra minutes per driver (1,400 drivers, 12 carriers)
early_signals:
  - SageMaker returning 503 ModelError responses
  - Lambda function (arcline-route-handler) retries three times then gives up and sends manual routing notification to dispatch team
  - single instance handles baseline (200 req/min, 180ms p99 latency) but gets buried at morning rush -- latency climbs to 8 seconds
  - endpoint has not scaled in three weeks despite Application Auto Scaling policy configured (target tracking on InvocationsPerInstance, threshold 100, scale 1-6 instances)
recent_change: three weeks ago, ML team ran blue-green deployment -- replaced default AllTraffic variant with new production variant called optimized-v3. Model was faster, inference cost lower, deployment went smoothly. Nobody checked auto-scaling configuration or CloudWatch alarm afterward. Alarm still references old variant name in metric dimensions, has been in INSUFFICIENT_DATA state since deployment.
investigation_starting_point: the auto-scaling policy exists and thresholds are reasonable, but scaling has never fired. The endpoint has been running on one instance for three weeks through every morning spike.

## Resolution

root_cause: dimension mismatch in CloudWatch alarm arcline-sagemaker-high-invocations that drives the auto-scaling policy. Alarm monitors InvocationsPerInstance metric in AWS/SageMaker namespace dimensioned by EndpointName and VariantName. Alarm was created when variant was AllTraffic. After blue-green deployment, AllTraffic variant no longer exists -- no metric data published to that dimension combination. Alarm entered INSUFFICIENT_DATA state permanently.
mechanism: without the alarm firing, the Application Auto Scaling target tracking policy never triggers. Endpoint stays at one ml.g4dn.xlarge instance through every morning spike. At 800 req/min the instance is overwhelmed, model server queue fills, SageMaker returns 503 ModelError responses.
fix: immediate -- update CloudWatch alarm dimensions to reference VariantName: optimized-v3 instead of VariantName: AllTraffic. Once alarm receives metric data, it evaluates normally and triggers scale-out when InvocationsPerInstance exceeds threshold. Endpoint scales to additional instances during morning rush, 503 errors stop. Long-term -- update deployment pipeline so any blue-green deployment that changes production variant name also updates all dependent resources (CloudWatch alarms, scaling policies, dashboards, any configuration referencing variant name as dimension). Automate via CloudFormation, CDK, or post-deployment validation script checking alarm states and metric data availability.
