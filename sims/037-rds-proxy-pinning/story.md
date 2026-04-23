---
tags:
  - type/simulation
  - service/rds-proxy
  - service/lambda
  - service/rds
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# The Proxy That Stopped Sharing

## Opening

- company: Finch Ledger
- industry: B2B financial technology (accounts payable automation)
- product: SaaS platform that automates invoice ingestion, approval routing, and payment for mid-market accounts payable teams; processes 15,000 invoices per day at peak
- scale: Series B startup, 55 engineers, 3 product teams, 400 Lambda functions handling invoice creation
- time: Monday 14:30 UTC, during peak North American business hours
- scene: PagerDuty fires a P1 for invoice-processor Lambda: error rate 100 percent, all invocations timing out at 29 seconds. No deployment has run since Friday afternoon.
- alert: every Lambda invocation across the 400-function invoice-processor pool is returning a database connection error. The SQS queue is growing. Finance customers cannot create invoices.
- stakes: Finch Ledger's SLA guarantees invoice ingestion within 60 seconds. The queue has been growing for 8 minutes. Two enterprise customers have already emailed support.
- early_signals: Lambda duration spikes from ~120ms to 29000ms (timeout); CloudWatch Lambda errors at 100 percent; RDS Proxy CloudWatch shows DatabaseConnections at 450 (max); no recent deployment in the deploy log
- investigation_starting_point: You have access to the RDS Proxy console, CloudWatch metrics for finch-proxy and finch-invoicing-cluster, Lambda configuration and logs, and the Aurora parameter group. The last healthy metric baseline is Monday 14:21 UTC.

## Resolution

- root_cause: migration_20260417_invoice_sequence.sql added SELECT nextval('invoice_number_seq') inside the invoice-creation transaction that runs through finch-proxy. RDS Proxy pins a connection to the client session whenever a PostgreSQL sequence function is called. With 400 concurrent Lambda invocations each holding a pinned connection, Aurora max_connections=450 (db.t4g.medium, 4 GiB RAM) was exhausted. No new connection could be established.
- mechanism: Before Friday, Lambda invoice-processor ran a single INSERT per invocation through finch-proxy. The proxy multiplexed ~400 Lambda sessions into roughly 20 database connections, well within Aurora's 450-connection limit. The Friday migration added SELECT nextval('invoice_number_seq') before the INSERT inside the same transaction. On Monday, as concurrent Lambda invocations ramped to 400, each invocation called nextval() and triggered a proxy pin. By 14:22 UTC, 400 connections were pinned simultaneously. Aurora refused all new connections with FATAL: remaining connection slots are reserved for non-replication superuser connections. Lambda invocations began timing out at 29 seconds waiting for a connection that never became available.
- fix: Immediate mitigation is to disable the SQS event source mapping on invoice-processor Lambda to stop new pinned connections accumulating, then deploy a rollback migration removing the nextval() call. Long-term fix is to move the sequence call server-side: set the invoice_number column DEFAULT to nextval('invoice_number_seq') in the table DDL so the sequence is called during INSERT on the Aurora server, never through the proxy client session. Alternatively, route the nextval() call through a direct Aurora writer endpoint that bypasses the proxy.
- contributing_factors: The migration was reviewed and merged on Friday with no proxy-compatibility check. The team was unaware that nextval() triggers RDS Proxy pinning. No CloudWatch alarm existed on DatabaseConnectionsCurrentlySessionPinned. The load that triggered the exhaustion only occurs during Monday morning peak, explaining why Friday post-migration testing (low traffic, few concurrent Lambdas) did not reproduce the problem. The db.t4g.medium instance class was chosen to minimize cost; its max_connections=450 provided almost no headroom above the 400-function Lambda pool size.
