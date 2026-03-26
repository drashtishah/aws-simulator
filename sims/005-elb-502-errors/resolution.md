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

## Other Ways This Could Break

### Health check path returns non-200 status

The port is correct but the health check path (e.g., `/health`) returns a 500 or 404 because the application's health endpoint is broken or does not exist at that path. The ALB marks targets unhealthy for a different reason code (`Target.ResponseCodeMismatch` instead of `Target.Timeout`). To prevent this, always deploy the health check endpoint before updating the target group to reference it, and test the endpoint manually after deployment.

### Security group blocks health check traffic

The health check port and path are correct, but the instance security group does not allow inbound traffic from the ALB's security group on the health check port. Checks fail with a timeout, identical to a port mismatch, but the fix is a security group rule change rather than a target group setting change. Ensure the instance security group allows inbound traffic from the ALB security group on both the application port and the health check port.

### Health check timeout shorter than application startup time

The port and path are correct, but the application takes longer to start than the health check grace period allows. New instances are marked unhealthy before they finish booting. Unlike a port mismatch, the instances eventually become healthy if the thresholds are adjusted. Set the Auto Scaling health check grace period longer than the application's worst-case startup time, and increase the unhealthy threshold count to tolerate slow starts.

### Target group registered on wrong port

The health check is configured to use `traffic-port`, but the instances were registered on the wrong port (e.g., 8080 instead of 3000). Both traffic forwarding and health checks fail. The symptom is similar to this sim's scenario, but the fix is re-registering targets on the correct port rather than changing the health check configuration.

## SOP Best Practices

- Always use `traffic-port` for health checks unless you have a dedicated health check endpoint on a separate port that is confirmed to be listening.
- Treat health check configuration changes as high-risk deployments: validate in staging, deploy with a canary, and monitor HealthyHostCount immediately after rollout.
- Set a CloudWatch alarm on HealthyHostCount dropping below your minimum acceptable threshold, not just on 502 error counts, so you catch health check regressions before they cause user-facing errors.
- When using Auto Scaling with ELB health checks, set the health check grace period long enough for the application to fully start and pass its first health check, or the ASG will terminate instances before they have a chance to become healthy.

## Learning Objectives

1. **ALB health checks**: Understand that health check port, path, and thresholds must match the application's actual configuration
2. **502 errors**: Know that ALB 502 responses typically mean there are no healthy targets to forward requests to
3. **Auto Scaling interaction**: When ELB health checks are misconfigured, Auto Scaling creates a launch-terminate cycle that makes the outage worse, not better

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- elb, auto-scaling, ec2, cloudwatch service entries
