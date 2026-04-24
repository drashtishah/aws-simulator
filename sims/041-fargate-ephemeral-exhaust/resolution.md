# Resolution: Twenty Gigabytes Is Not Enough

## Root Cause

Every new Fargate task stopped at image-pull time with `CannotPullContainerError`
and "no space left on device". The cause is a missing field in the task
definition.

On Fargate platform 1.4.0+, each task receives 20 GiB of ephemeral storage by
default. This storage is shared by all containers in the task: image layers are
extracted onto it during pull, each container's writable layer lives on it, and
`/tmp` consumes from it.

`tern-vision-inference:v2.3.1` is 6.2 GiB compressed in ECR. When containerd
decompresses the OCI layers onto ephemeral storage, the extracted size is
~14.2 GiB (a ~2.3x ratio). The `datadog-agent:7` sidecar adds another ~2.2 GiB
extracted. Combined extracted size is ~16.4 GiB, plus the container writable
layers and any `/tmp` writes. The 20 GiB default is exhausted before both
images finish pulling.

## The Broken Task Definition

The current revision of `tern-inference-task-def` has no `ephemeralStorage`
block at the task level:

```json
{
  "family": "tern-inference-task-def",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "4096",
  "memory": "8192",
  "executionRoleArn": "arn:aws:iam::123456789012:role/tern-inference-execution-role",
  "containerDefinitions": [...]
}
```

Without the block, Fargate assigns the 20 GiB default. The default value of
20 GiB is not a settable value: the API minimum for `sizeInGiB` is 21. Setting
`sizeInGiB: 20` would return a validation error.

## The Fix

Register a new task definition revision with `ephemeralStorage` at the task
level (not inside `containerDefinitions`):

```json
{
  "family": "tern-inference-task-def",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "4096",
  "memory": "8192",
  "executionRoleArn": "arn:aws:iam::123456789012:role/tern-inference-execution-role",
  "ephemeralStorage": {
    "sizeInGiB": 40
  },
  "containerDefinitions": [...]
}
```

40 GiB is well above the 21 GiB minimum and provides headroom for the next
model weight increment. Sizing rationale: 6.2 GiB + 0.9 GiB compressed = 7.1 GiB
compressed, multiplied by 2.5 extraction factor = ~17.75 GiB, plus 2 GiB for
writable layers and `/tmp` = ~19.75 GiB needed; 40 GiB gives ~2x headroom for
future model growth.

After deploying the new revision to `tern-inference-service`, `PendingTaskCount`
drops to 0 and `RunningTaskCount` recovers to 2 within a few minutes. With
Container Insights enabled on the `tern-vision-prod` cluster,
`EphemeralStorageUtilized` (namespace `ECS/ContainerInsights`) becomes
observable once tasks are running. Set a CloudWatch alarm at 80% of
`sizeInGiB` (32 GiB) to catch future growth before it becomes an outage.
