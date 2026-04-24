---
tags:
  - incident
  - ecs
  - fargate
  - reliability
  - ephemeral-storage
---

# Twenty Gigabytes Is Not Enough

Tern Vision runs a computer-vision inference API. On Friday morning the on-call
engineer notices health checks degrading and ECS showing zero running tasks.
Every new Fargate task starts, attempts to pull its images, and stops with a
`CannotPullContainerError`. Tasks that were already running before the deployment
are unaffected. The error trace points to disk exhaustion inside the container
runtime.

See [[041-fargate-ephemeral-exhaust/opening|opening]] for the full incident
context.

## Resolution

The task definition `tern-inference-task-def` omits the `ephemeralStorage`
block. Fargate platform 1.4.0 tasks default to 20 GiB of ephemeral storage,
shared by image-layer extraction, the container writable layer, and `/tmp`.
The `tern-vision-inference:v2.3.1` image (6.2 GiB compressed, ~14.2 GiB
extracted) combined with the `datadog-agent:7` sidecar (~2.2 GiB extracted)
exceeds that default. Adding `"ephemeralStorage": { "sizeInGiB": 40 }` to the
task definition and deploying a new revision restores the service.

See [[041-fargate-ephemeral-exhaust/resolution|resolution]] for the fix walkthrough.
