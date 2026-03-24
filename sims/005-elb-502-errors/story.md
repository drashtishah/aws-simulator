---
tags:
  - type/simulation
  - service/elb
  - service/auto-scaling
  - service/ec2
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# UrbanFleet Rush Hour Meltdown: The 502 Storm

## Opening

It is 4:48 PM on a Friday -- peak delivery hour. The UrbanFleet dispatch dashboard goes blank and is replaced by a white page with three digits: 502. Customer-facing APIs are returning the same error. The mobile app that 1,200 delivery drivers depend on for route assignments, delivery confirmations, and real-time navigation is completely unresponsive.

UrbanFleet is a Series B logistics startup that provides last-mile delivery routing and dispatch for 45 retail and grocery partners across six metro areas. On a typical Friday afternoon, the platform manages 8,400 active deliveries simultaneously, routing 1,200 drivers in real time. The dispatch engine recalculates optimal routes every 90 seconds based on traffic, delivery windows, and driver locations. When the platform goes down, drivers are stranded mid-route with no instructions, and packages pile up at distribution centers.

The infrastructure team pulls up the ALB dashboard. The Application Load Balancer is online and receiving requests, but every request is getting a 502 response. The target group shows zero healthy instances. All four EC2 instances are registered but marked as "unhealthy" by the load balancer. Auto Scaling senses the unhealthy targets and launches replacement instances, but within two minutes, the new instances are also marked unhealthy and deregistered.

You SSH into one of the instances directly. The application is running on port 3000, responding to requests normally, memory and CPU look fine. The instance passes both EC2 status checks. From the inside, everything looks perfect. But the load balancer disagrees -- it insists every instance is unhealthy. Something is wrong with how the ALB is checking instance health.

## Resolution

The investigation traced the 502 errors to a health check misconfiguration in the ALB target group. Two hours before the outage, a DevOps engineer pushed an infrastructure-as-code update that was intended to standardize health check configurations across all target groups. The change updated the health check port from `traffic-port` (which defaults to the target's registered port, 3000) to an explicit port 8080, which the engineering team planned to use as a dedicated health check endpoint.

The problem: the application had not been updated to listen on port 8080. Nothing responded on that port. Every health check from the ALB to port 8080 timed out, the ALB marked each target as unhealthy after the configured 3 consecutive failures (30 seconds), and deregistered them from the target group. With no healthy targets, the ALB returned 502 Bad Gateway for every incoming request.

Auto Scaling made things worse, not better: it detected unhealthy instances via the ALB health check, terminated them, and launched replacements. The new instances also failed the port 8080 health check within 30 seconds of starting, creating a launch-terminate cycle that churned through instances without ever restoring service.

The fix was to update the target group health check port back to `traffic-port` (port 3000) where the application was actually listening. Within 10 seconds of the change, the ALB registered all running instances as healthy and the 502 errors stopped. The team then created a proper health check endpoint on the application (`/health` on port 3000) and updated the health check path to use it.
