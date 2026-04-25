---
tags:
  - type/resolution
  - service/ecs
  - service/ec2
  - service/cloudwatch
  - service/vpc
  - difficulty/professional
  - category/reliability
---

# Resolution: One Thread Per Neighbor

## Root Cause

The `adagio-matcher-task-def` task definition runs on EC2 launch type and has no `ulimits` block. On EC2 launch type, ECS containers inherit the host operating system's default per-process file-descriptor limit, which on Amazon Linux 2023 is `nofile=1024` soft and `4096` hard. (Fargate is different: it sets `nofile=65535` by default. The Adagio cluster had been migrated from Fargate to EC2 launch type the previous quarter to reduce cost, and the task definition was carried over without adjustment.)

Each matcher process holds three categories of file descriptors:
1. Mesh peer connections: one persistent TCP socket to every other matcher (inbound + outbound)
2. Database connection pool: 64 sockets to RDS Aurora
3. Client websockets: ~120 long-lived connections per task

At N=40 tasks, per-task file-descriptor count was about 2*39 + 64 + 120 = 262, well under 1024. At N=100, it was 2*99 + 64 + 120 = 382 from the mesh alone, plus per-connection overhead (TLS session caches, half-closed sockets in TIME_WAIT, file handles for log rotation). Several tasks crossed 1024 within minutes of the scale-out, the kernel returned EMFILE on every new socket call, and the matcher started rejecting incoming peer joins and client websockets. Existing connections continued working until they were churned by load.

This pattern is the customer-side analogue of the 2020-11-25 Amazon Kinesis disruption in US-EAST-1: a routine capacity addition pushed the front-end fleet past the operating-system thread limit because each server opened a thread per peer; with thousands of servers the mesh was O(n) per node and adding capacity made the problem worse.

## Timeline

| Time (UTC) | Event |
|---|---|
| 16:42:00 | SRE updates adagio-matcher-service desiredCount from 40 to 100 |
| 16:43:11 | First new task RUNNING; mesh begins to grow |
| 16:46:30 | Mesh size crosses 70 tasks; first EMFILE error in container logs |
| 16:47:55 | PagerDuty INC-20260424-0948 fires (MatcherErrorRate > 1%) |
| 16:51:20 | Mesh at 100 tasks, ~22 of 100 tasks at >1024 file descriptors |
| 16:54:42 | SRE registers new task-definition revision with ulimits nofile=65536 |
| 16:55:08 | adagio-matcher-service updated to new revision; rolling deploy starts at 25% step |
| 17:00:11 | All tasks on new revision; EMFILE errors stop |
| 17:02:33 | MatcherErrorRate falls below 1%; incident closed |

## Correct Remediation

1. **Confirm file-descriptor exhaustion.** Container logs with `Too many open files` (Java surfaces this as `java.io.IOException`) point straight at EMFILE. To verify against the live process, run `aws ecs execute-command` to enter a running task and read `/proc/1/limits`. The `Max open files` row shows the kernel-enforced limit. If it reads `1024`, the task definition is not overriding the OS default.
2. **Inspect the task definition.** Pull the registered task definition with `aws ecs describe-task-definition --task-definition adagio-matcher-task-def`. Look at each `containerDefinitions[].ulimits` field. If the field is missing or does not include `{"name": "nofile", ...}`, the container is using the OS default.
3. **Calculate the required limit.** For a full mesh of N tasks: per-task FDs = 2 * (N-1) inbound + outbound peer connections + DB connection pool + client connections + 2x safety margin. For 100 tasks with a 64-entry pool and 200 client connections per task: 198 + 64 + 200 = 462; double to 924 minimum. The standard high-headroom value is 65536, which is also the Fargate default.
4. **Register a new task-definition revision with the ulimits block.** Add to each container definition: `"ulimits": [{"name": "nofile", "softLimit": 65536, "hardLimit": 65536}]`. Verify the EC2 host's system-wide `/proc/sys/fs/file-max` is at least the sum of all container limits times the number of containers per host. On AL2023 the default file-max is in the millions, so this is rarely the bottleneck.
5. **Update the service and roll.** `aws ecs update-service --service adagio-matcher-service --task-definition <new-revision-arn>`. Watch container logs for the absence of EMFILE and verify peer connections settle.
6. **Add a per-task FD-utilization metric.** Emit `open_file_descriptors / nofile_limit` to CloudWatch from the application or a sidecar. Alarm at 80%. This catches future drift before it becomes an incident.
7. **Long-term: introduce a sidecar proxy with connection pooling.** A sidecar like Envoy can hold a small fixed number of upstream sockets regardless of mesh size, breaking the O(n) growth pattern. The application talks to localhost, the sidecar talks to peers. Mesh size becomes orthogonal to per-task socket count.

## Key Concepts

### EC2 launch type vs Fargate: ulimit defaults

ECS supports two launch types: Fargate (AWS manages the host) and EC2 (you manage the host). They have different defaults for container ulimits, and this difference is responsible for many migration surprises.

- **Fargate**: AWS sets `nofile` to 65535 soft and hard for every container by default, regardless of what the task definition says. This is the value that AWS chose as a safe high-headroom default.
- **EC2 launch type**: the container runtime applies the host OS ulimits, which on Amazon Linux 2023 are `nofile=1024 soft / 4096 hard`. The task definition's `ulimits` block overrides this if present; otherwise the container is stuck with the OS default.

A team migrating from Fargate to EC2 launch type for cost reasons can carry over a task definition that worked fine on Fargate (because Fargate's default was high enough) and discover that on EC2 it inherits a much lower limit. The application is the same; the kernel limit is different.

### Mesh topology and O(n) growth

A full-mesh service topology means every node holds a persistent connection to every other node. With N nodes, each node has (N-1) inbound and (N-1) outbound connections, so total connections per node is 2*(N-1) and total connections in the cluster is N*(N-1). This grows quadratically across the cluster but linearly per node.

A mesh that works fine at 40 nodes (78 connections per node) can break at 100 nodes (198 per node) for two reasons: per-node file-descriptor count crosses a kernel limit, OR the constant overhead per connection (memory, TLS state, heartbeat traffic) becomes significant.

The fix is a topology change. Instead of every node connecting to every other node:
- **Sidecar proxy**: each application talks to a local proxy, the proxies form a smaller pool that handles upstream connections; per-task FD count is bounded.
- **Sharded mesh**: nodes only connect to a subset of peers determined by a hash; per-node FD count grows logarithmically.
- **Hub-and-spoke**: nodes connect to a central router, not to each other; per-node FD count is constant.

### EMFILE and how the kernel signals exhaustion

Linux enforces per-process file-descriptor limits via the `RLIMIT_NOFILE` resource limit. When a process tries to `open()`, `socket()`, `accept()`, or `epoll_create()` a new descriptor and is already at its limit, the syscall fails with `errno = EMFILE` (24).

In Java, this surfaces as `java.io.IOException: Too many open files`. In Python, as `OSError: [Errno 24] Too many open files`. In Go, as `accept tcp ...: too many open files`. The error is always at the syscall layer, so it appears in any language as the same kernel signal.

Because sockets count as file descriptors, this is the same limit that bounds open files, open pipes, open epoll handles, and open Unix domain sockets. A service that uses many TCP connections and many open log files (rotating per request, for example) shares one budget across both.

## Other Ways This Could Break

### VPC subnet IP exhaustion in awsvpc mode
ECS tasks in awsvpc network mode get their own ENI with its own subnet IP. When the subnet runs out of IPs, new tasks fail to start with `RESOURCE:ENI` or `No subnet available` in the service event log. Existing tasks continue running normally; the failure is at task placement, not at runtime.
**Prevention:** Right-size subnets for peak task count. Use larger CIDR ranges (a /22 supports ~1000 IPs versus a /24's ~250). For very dense clusters, use ENI prefix delegation to assign multiple IPs per ENI.

### ECS ServiceConnect or Cloud Map namespace quota
Tasks register and run, but mesh peer discovery is incomplete. Some tasks see only a subset of peers. Logs show DNS resolution failures or empty Cloud Map query results, not EMFILE.
**Prevention:** Check the AWS service quota for Cloud Map namespaces and registered instances per namespace. Request increases ahead of large scale-out events.

### Application thread pool limit hit before nofile
The kernel limit is fine, but the JVM or application's thread executor is too small. Logs show `OutOfMemoryError: unable to create new native thread`, `RejectedExecutionException`, or thread-pool exhaustion. The fix is at the application layer, not the kernel layer.
**Prevention:** Tune executor pool sizes for the expected concurrent connection count. In Java, also check `nproc` (the kernel limit on processes per user), which can also surface as a thread-creation failure.

## SOP Best Practices

- **Always set ulimits explicitly in EC2-launch-type ECS task definitions.** Do not rely on the OS default, which is 1024 on most Linux distributions and is far too low for any process that holds many network connections. The Fargate default of 65535 is a safe starting value.
- **Monitor file-descriptor usage as a first-class metric.** Emit `/proc/self/fd` count from the application or a sidecar to CloudWatch. Alarm at 80% of the configured limit. This catches drift well before EMFILE.
- **Avoid full-mesh topologies past ~50 nodes.** Use a sidecar proxy with connection pooling so per-node connection count is bounded, regardless of mesh size. The 2020 Kinesis incident is the canonical lesson on what happens when an O(n) connection pattern scales past its tested limit.
- **Test scale-out at the actual target size before production.** A load test that only validates the architecture at 40 nodes will not catch a problem that appears at 100. The Kinesis post-mortem made this lesson explicit.

## Learning Objectives

1. **EC2 vs Fargate ulimit defaults**: Know that EC2-launch-type containers inherit the host OS limit (1024 soft on AL2023), while Fargate sets 65535 by default.
2. **Mesh growth math**: Compute per-node connection count in a full mesh and recognize the O(n) growth pattern.
3. **EMFILE diagnosis**: Match `Too many open files` log lines to the kernel `RLIMIT_NOFILE` limit and verify with `/proc/<pid>/limits`.
4. **Counter-intuitive scaling**: Recognize that adding capacity to a connection-exhaustion problem makes it worse, because each new node is a new peer for every existing node.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design Solutions for New Solutions
- [[exam-topics#DOP-C02 -- DevOps Engineer Professional]] -- Domain 3: Resilience
- [Summary of the Amazon Kinesis Event in US-EAST-1 (Nov 2020)](https://aws.amazon.com/message/11201/) -- the post-mortem this scenario mirrors
