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

1. **Immediate**: Fix the health check port mismatch. Update the target group's health check port back to `traffic-port`. The `traffic-port` setting tells the load balancer to check the same port the application is registered on (port 3000), so the health check always matches the application automatically.
2. **Verification**: Confirm that all servers show "healthy" in the target group's Targets tab and that the load balancer stops returning 502 errors. Servers should transition from unhealthy to healthy within 10-30 seconds.
3. **Prevention**: Add a check to your infrastructure-as-code (IaC) deployment pipeline that verifies the health check port matches the port the application listens on. This catches misconfigurations before they reach production.
4. **Improvement**: Create a dedicated `/health` endpoint in the application. A good health endpoint does not just confirm the app is running -- it checks whether downstream services (like the database and cache) are reachable too, so the load balancer knows the server is truly ready to serve traffic.
5. **Detection**: Set up a CloudWatch alarm on `HTTPCode_ELB_502_Count` (the metric that counts how many 502 errors the load balancer returns) with a threshold of 10 per minute and a 1-minute evaluation period. This alerts your team within a minute if the load balancer starts returning errors to users.

## Key Concepts

### ALB Health Checks -- How the Load Balancer Decides Who Gets Traffic

The Application Load Balancer (ALB) periodically sends a test request to each registered server to see if it is working. This is called a health check. Only servers that pass the health check receive real user traffic. The health check has several settings:

- **Port**: Which port to send the test request to. Setting this to `traffic-port` (recommended) automatically uses the same port the server is registered on. Setting an explicit port number overrides this -- and if that port does not match what the application is listening on, every check will fail.
- **Path**: The URL path the load balancer requests (for example, `/health`). The server must return a 200 OK response.
- **Interval**: How often the load balancer checks each server (default: every 30 seconds).
- **Unhealthy threshold**: How many failed checks in a row before the server is marked unhealthy and removed from rotation (default: 3).
- **Healthy threshold**: How many successful checks in a row before the server is marked healthy again and starts receiving traffic (default: 3).

If the health check port does not match any port the application listens on, the check hits a dead port, times out every time, and the server gets removed from the load balancer.

### 502 Bad Gateway -- What This Error Means

When the ALB returns a 502 error to users, it means one of three things:
- There are no healthy servers in the target group (the most common cause -- usually from failed health checks)
- A server closed the connection before sending a response
- A server returned an invalid or malformed response

In this scenario, the cause was no healthy servers -- the health check was configured for the wrong port, so every server was marked unhealthy and removed.

### Auto Scaling and Health Checks -- How They Interact

Auto Scaling automatically launches new servers to replace ones that fail. It can use two kinds of health checks to decide if a server is healthy: EC2 status checks (is the machine running?) or ELB health checks (can the load balancer reach the application?). When configured to use ELB health checks:

- If the load balancer marks a server unhealthy, Auto Scaling terminates it and launches a replacement.
- If the health check itself is misconfigured (like checking the wrong port), every replacement server also fails the same broken health check. This creates an endless cycle of launching and terminating servers that wastes resources without fixing anything.
- The cycle continues until someone fixes the health check configuration or Auto Scaling hits its retry limit.

## Other Ways This Could Break

### Health check path returns non-200 status

The port is correct, but the URL path the load balancer checks (for example, `/health`) returns an error response (like 500 or 404) because the health endpoint is broken or does not exist at that path. The load balancer reports a different failure reason -- `Target.ResponseCodeMismatch` (meaning the response code was not the expected 200 OK) instead of `Target.Timeout` (meaning no response at all). To prevent this, always deploy your health check endpoint before telling the target group to use it, and manually test the endpoint after deployment to confirm it returns 200 OK.

### Security group blocks health check traffic

The health check port and path are correct, but the server's firewall (security group) does not allow incoming traffic from the load balancer on the health check port. The symptom looks identical to a port mismatch -- checks time out -- but the fix is different. Instead of changing the health check settings, you need to add a firewall rule that lets the load balancer talk to the server. Make sure the server's security group allows inbound traffic from the load balancer's security group on both the application port and the health check port.

### Health check timeout shorter than application startup time

The port and path are correct, but the application takes a long time to start up (loading data, warming caches, etc.). The load balancer checks too soon and marks the server as unhealthy before the application has finished starting. Unlike a port mismatch, the servers would eventually pass health checks if given enough time. Set the Auto Scaling health check grace period (a waiting period before health checks start counting) to be longer than the worst-case startup time for your application. You can also increase the unhealthy threshold -- the number of failed checks required before marking a server unhealthy -- to give slow starters more chances.

### Target group registered on wrong port

The health check uses `traffic-port` (which automatically matches the registered port), but the servers were registered on the wrong port in the first place (for example, 8080 instead of 3000). Both real user traffic and health checks go to the wrong port, so everything fails. The symptom looks similar to this scenario, but the fix is re-registering the servers on the correct port rather than changing the health check configuration. Check your launch template or infrastructure-as-code configuration for the registration port.

## SOP Best Practices

- Always set the health check port to `traffic-port` (which automatically matches the port the server is registered on) unless you have a dedicated health check endpoint on a separate port that you have confirmed is working. Hard-coding a port number is fragile and easy to get wrong.
- Treat any change to health check settings as a high-risk deployment. Test in a staging environment first, deploy gradually using a canary (a small test group that gets the change before everyone else), and immediately watch the HealthyHostCount metric after rollout to catch problems before all servers are affected.
- Set up a CloudWatch alarm that fires when HealthyHostCount (the number of servers the load balancer considers healthy) drops below your minimum acceptable number. This catches health check problems before they cause 502 errors for users -- it is an earlier warning signal than monitoring 502 counts alone.
- When using Auto Scaling with load balancer health checks, set the health check grace period (the waiting time before health checks start counting) long enough for your application to fully start up. If the grace period is too short, Auto Scaling will keep terminating servers before they finish booting, creating an endless launch-and-terminate cycle.

## Learning Objectives

1. **ALB health checks**: Understand that health check port, path, and thresholds must match the application's actual configuration
2. **502 errors**: Know that ALB 502 responses typically mean there are no healthy targets to forward requests to
3. **Auto Scaling interaction**: When ELB health checks are misconfigured, Auto Scaling creates a launch-terminate cycle that makes the outage worse, not better

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[catalog]] -- elb, auto-scaling, ec2, cloudwatch service entries
