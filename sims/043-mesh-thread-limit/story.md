---
tags:
  - type/simulation
  - service/ecs
  - service/ec2
  - service/cloudwatch
  - service/vpc
  - difficulty/professional
  - category/reliability
---

# One Thread Per Neighbor

## Opening

- company: Adagio Trading
- industry: low-latency electronic market-making, equity options on three US exchanges
- product: order-matching engine (adagio-matcher) with a peer-to-peer mesh for cross-instrument hedging
- scale: 40 ECS tasks pre-scale, target 100 ahead of a new options product launch; ~12,000 client websocket connections at peak
- time: Friday, 09:48 PT, six minutes after the product launch announcement
- scene: an SRE has just kicked off a desiredCount change from 40 to 100 in adagio-matcher-service ahead of the 10:00 PT launch
- alert: PagerDuty INC-20260424-0948 fires at 09:48: `MatcherErrorRate = 12% on adagio-matcher-service, threshold 1%`
- stakes: launch is in 12 minutes; if the mesh degrades any further, three exchanges will see Adagio's quotes vanish and the firm will be removed from the market-maker rotation
- early_signals:
  - ECS console says all 100 tasks are RUNNING and reporting healthy
  - container logs are full of `java.io.IOException: Too many open files`
  - the mesh peer registry (Cloud Map) reports 100 healthy instances
  - the original 40 tasks were healthy at 40-task scale, started failing only after the new 60 came online
  - VPC subnets have plenty of free IPs (74% available)
- investigation_starting_point: ECS console open, can run aws ecs execute-command to exec into a task, container log group accessible, EC2 host SSM available

## Resolution

- root_cause: the adagio-matcher-task-def has no `ulimits` block, so the container inherits the host OS default of `nofile=1024 soft`; on Fargate this would be 65535, but Adagio runs the cluster on EC2 launch type
- mechanism: each matcher holds (N-1) outbound + (N-1) inbound peer connections + a 64-entry database connection pool + ~120 client websockets per task; at N=40 that is roughly 78 + 64 + 120 = 262 file descriptors per process, well under 1024; at N=100 it is 198 + 64 + 120 = 382 from the mesh alone, plus accumulated half-closed sockets and small per-connection overhead, pushed several tasks past 1024 and triggered EMFILE on every new connection attempt
- fix: SRE registered a new task-definition revision with `"ulimits": [{"name": "nofile", "softLimit": 65536, "hardLimit": 65536}]` and called update-service with the new revision; the ECS deployment rolled the fleet at 25% step and the EMFILE errors stopped within four minutes
- contributing_factors:
  - the load test that validated the new architecture only ran at 40-task scale and never crossed 1024 file descriptors per task
  - default container ulimits behavior is different between Fargate (high) and EC2 launch type (OS default) and the team had migrated from Fargate the previous quarter
  - no CloudWatch metric was emitted for per-process file-descriptor count, so there was no early-warning signal
  - adding more capacity (the SRE's first instinct) made the problem worse: each new task is a new peer every existing task must connect to
