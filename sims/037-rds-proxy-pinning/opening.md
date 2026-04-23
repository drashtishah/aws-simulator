Finch Ledger, Monday 14:30 UTC. PagerDuty fires a P1: invoice-processor Lambda error rate just hit 100 percent across all 400 functions. Every invocation is timing out at 29 seconds.

The deploy log is clean. The last release was Friday afternoon, and the post-deploy smoke tests passed. Nothing has changed since then.

CloudWatch shows DatabaseConnections on finch-invoicing-cluster sitting at exactly 450, which is Aurora's connection ceiling for this instance class. The SQS invoice-creation-queue depth is climbing by roughly 200 messages per minute.

Two enterprise customers have already emailed support saying they cannot submit invoices. Finance teams in their accounts payable cycle are blocked.

Where do you start?
