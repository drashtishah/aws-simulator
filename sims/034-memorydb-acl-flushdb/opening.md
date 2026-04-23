Drifter Analytics, Monday 10:14. Customer support has 22 open tickets this morning, most variations of the same complaint: "I keep getting logged out of the dashboard, it says invalid session". Two studio accounts have already escalated because their QA engineers cannot stay signed in long enough to submit a test run.

The session-state MemoryDB cluster is healthy: no failovers, no nodes replaced, no latency spikes. Memory usage, though, has been climbing for six days straight and now sits at 94 percent. Evictions started yesterday.

The ECS schedule for the nightly cleanup-scratch task shows it ran at 02:00 every night. The task's exit code was non-zero every night. Nobody had an alarm on that field.

The cluster was migrated from Amazon ElastiCache for Redis to Amazon MemoryDB for Redis seven days ago, over the weekend.

Where do you start?
