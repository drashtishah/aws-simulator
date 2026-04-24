# Opening: Twenty Gigabytes Is Not Enough

It is Friday, 10:14am. You are the on-call SRE for Tern Vision, an
18-customer computer-vision inference SaaS. Your phone buzzes: the synthetic
health check for `tern-inference-service` has missed three consecutive polls.

You open the ECS console. `RunningTaskCount` for `tern-inference-service`
is dropping: it was 2 ten minutes ago, and is now 0. `PendingTaskCount` is
stuck at 2. No new tasks are reaching RUNNING state. The deployment was
triggered at 10:03am after the team merged the `tern-vision-inference:v2.3.1`
image, which bundles a larger set of model weights than the previous version.

What makes this puzzling is that any task that was already running before the
deployment is still healthy. The ECS service replacement cycle is what is
broken: every new task the service launches attempts to pull its images and
then stops before any container process starts.

The cluster has Container Insights enabled, so `EphemeralStorageUtilized` is
available in the `ECS/ContainerInsights` namespace once tasks are running.
Right now no tasks are running, so the metric has no current data points. The
CloudWatch metrics you can see show only `RunningTaskCount` falling and
`PendingTaskCount` rising, both starting at 10:03am.

Your job: find out why new tasks cannot start and identify the single change
that will bring the service back to a healthy `desiredCount` of 2.
