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

company: UrbanFleet
industry: logistics, Series B startup, 52 engineers
product: last-mile delivery routing and dispatch for retail and grocery partners
scale: 45 retail and grocery partners across six metro areas, 8,400 active deliveries simultaneously on typical Friday afternoon, 1,200 drivers routed in real time, dispatch engine recalculates routes every 90 seconds based on traffic, delivery windows, and driver locations
time: 4:48 PM, Friday -- peak delivery hour
scene: dispatch dashboard goes blank, replaced by white page with "502"
alert: customer-facing APIs returning 502, mobile app (route assignments, delivery confirmations, real-time navigation) completely unresponsive
stakes: 1,200 delivery drivers stranded mid-route with no instructions, packages piling up at distribution centers
early_signals:
  - ALB online and receiving requests, but every request gets 502 response
  - target group shows zero healthy instances
  - all four EC2 instances registered but marked "unhealthy" by load balancer
  - Auto Scaling launching replacement instances, but new instances also marked unhealthy and deregistered within two minutes
  - SSH into instance directly: application running on port 3000, responding normally, memory and CPU fine, passes both EC2 status checks
investigation_starting_point: from inside the instance, everything looks perfect -- application running, metrics normal, status checks passing. But the load balancer insists every instance is unhealthy. Something is wrong with how the ALB checks instance health.

## Resolution

root_cause: DevOps engineer pushed infrastructure-as-code update two hours before outage to standardize health check configurations across all target groups, changed health check port from `traffic-port` (defaults to registered port 3000) to explicit port 8080, intended as a dedicated health check endpoint
mechanism: application had not been updated to listen on port 8080 -- nothing responded on that port. Every health check timed out, ALB marked each target unhealthy after 3 consecutive failures (30 seconds), deregistered them. With zero healthy targets, ALB returned 502 Bad Gateway for every request. Auto Scaling made things worse: detected unhealthy instances via ALB health check, terminated them, launched replacements that also failed the port 8080 check within 30 seconds, creating a continuous launch-terminate churn cycle.
fix: update target group health check port back to `traffic-port` (port 3000). Within 10 seconds, ALB registered all running instances as healthy and 502 errors stopped. Team then created proper health check endpoint (`/health` on port 3000) and updated health check path to use it.
contributing_factors:
  - IaC change to health check port deployed without verifying application listens on the new port
  - no staging test of health check configuration change before production rollout
  - Auto Scaling with ELB health check type amplified the problem by churning instances
