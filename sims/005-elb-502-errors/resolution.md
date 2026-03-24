---
tags:
  - type/resolution
  - service/elb
  - service/auto-scaling
  - service/ec2
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# Resolution: UrbanFleet Rush Hour Meltdown -- The 502 Storm

## Root Cause

The ALB target group `urbanfleet-dispatch-tg` was configured with a health check on port 8080, but the application listens on port 3000. An infrastructure-as-code change two hours before the outage updated the health check port from `traffic-port` to `8080` in anticipation of a dedicated health check endpoint that had not yet been deployed. Every health check timed out, causing the ALB to deregister all targets as unhealthy and return 502 Bad Gateway for all requests.

## Timeline

| Time | Event |
|---|---|
| Day 0, 14:42 UTC | DevOps engineer pushes IaC update: health check port changed from traffic-port to 8080 |
| Day 0, 14:43 UTC | ALB begins health checking port 8080; all checks time out |
| Day 0, 14:44 UTC | First instance marked unhealthy after 3 consecutive failures (30s) |
| Day 0, 14:45 UTC | All 4 instances marked unhealthy; ALB returns 502 for all requests |
| Day 0, 14:48 UTC | Auto Scaling terminates unhealthy instances, launches replacements |
| Day 0, 14:50 UTC | New instances fail health check on port 8080; launch-terminate cycle begins |
| Day 0, 16:48 UTC | CloudWatch alarm fires: 502 error rate > 25% for 5 minutes |
| Day 0, 16:52 UTC | On-call engineer identifies health check port mismatch |
| Day 0, 16:54 UTC | Target group health check updated to port 3000 (traffic-port) |
| Day 0, 16:55 UTC | All running instances pass health check; 502 errors stop |

## Correct Remediation

1. **Immediate**: Update the target group health check port back to `traffic-port` (3000) to match the application
2. **Verification**: Confirm all instances show "healthy" in the target group and the ALB stops returning 502
3. **Prevention**: Add a pre-deployment check to the IaC pipeline that validates the health check port matches the application's listening port
4. **Improvement**: Create a dedicated `/health` endpoint in the application that checks downstream dependencies (database, cache)
5. **Detection**: Create a CloudWatch alarm on `HTTPCode_ELB_502_Count` with a threshold of 10 per minute and 1-minute evaluation

## Key Concepts

### ALB Health Checks

The Application Load Balancer performs periodic health checks on registered targets to determine which instances should receive traffic:

- **Port**: The port to check. `traffic-port` uses the port the target is registered on. An explicit port overrides this.
- **Path**: The HTTP path to request (e.g., `/health`). The target must return a 200 OK.
- **Interval**: Time between checks (default 30 seconds).
- **Unhealthy threshold**: Number of consecutive failures before marking unhealthy (default 3).
- **Healthy threshold**: Number of consecutive successes before marking healthy (default 3).

If the health check port does not match any port the application listens on, every check times out and the target is deregistered.

### 502 Bad Gateway

When an ALB returns 502, it means one of:
- No healthy targets in the target group
- The target closed the connection before sending a response
- The target returned a malformed response

The most common cause is no healthy targets -- which happens when health checks fail for all registered instances.

### Auto Scaling and Health Checks

Auto Scaling can use EC2 status checks or ELB health checks to determine instance health. When configured to use ELB health checks:

- If the ALB marks an instance unhealthy, Auto Scaling will terminate it and launch a replacement
- If the health check itself is misconfigured, this creates a launch-terminate cycle that wastes resources without restoring service
- The cycle continues until the health check is fixed or Auto Scaling reaches its maximum retry limit

## AWS Documentation Links

- [ALB Health Checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [ALB Troubleshooting 502 Errors](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-troubleshooting.html#http-502-issues)
- [Auto Scaling Health Checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)
- [Target Groups for ALBs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [CloudWatch Metrics for ALB](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html)

## Learning Objectives

1. **ALB health checks**: Understand that health check port, path, and thresholds must match the application's actual configuration
2. **502 errors**: Know that ALB 502 responses typically mean there are no healthy targets to forward requests to
3. **Auto Scaling interaction**: When ELB health checks are misconfigured, Auto Scaling creates a launch-terminate cycle that makes the outage worse, not better

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- elb, auto-scaling, ec2, cloudwatch service entries
