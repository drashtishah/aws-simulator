# Resolution: The Proxy That Stopped Sharing

## What happened

For eight months, finch-proxy (RDS Proxy) multiplexed up to 400 concurrent Lambda
invoice-processor sessions into roughly 20 real database connections. The proxy was
doing its job: when one Lambda finished its transaction, the proxy reassigned that
connection to the next waiting Lambda. Aurora finch-invoicing-cluster hummed along
at well under its 450-connection ceiling.

On Friday 2026-04-17, a migration added one line to the Lambda invoice-creation path:

    SELECT nextval('invoice_number_seq')

That line, called inside a transaction routed through the proxy, is a pinning trigger.
AWS RDS Proxy pins a database connection to a specific client session whenever the
client calls a PostgreSQL sequence function. Once pinned, that connection is no longer
available for multiplexing. It stays locked to that Lambda invocation for the duration
of the execution.

Post-migration testing ran Friday evening at low traffic. Only a handful of Lambdas
were concurrent. A handful of pinned connections out of 450 is invisible.

## Monday morning

North American accounts payable teams opened their laptops and started approving
invoices. Lambda concurrency climbed toward 400. At 14:22 UTC, 400 connections were
pinned simultaneously. Aurora refused connection 451 with:

    FATAL: remaining connection slots are reserved for non-replication superuser
    connections

Every Lambda invocation waiting for a connection timed out at 29 seconds. The SQS
queue grew. The proxy's DatabaseConnectionsCurrentlySessionPinned metric, had anyone
been watching it, showed a clean ramp from 0 to 400 in the minutes before failure.

## Root cause

The Friday migration added `SELECT nextval('invoice_number_seq')` inside the
invoice-creation transaction. RDS Proxy pins a connection on any sequence function
call. With 400 concurrent Lambda invocations, 400 connections were pinned, exhausting
Aurora max_connections=450 (db.t4g.medium, 4 GiB: 4294967296 / 9531392 = 450).

## Immediate fix

1. Disable the SQS event source mapping on invoice-processor Lambda to stop new
   pinned connections from accumulating.
2. Deploy a rollback migration that removes the `SELECT nextval('invoice_number_seq')`
   call from the Lambda transaction path.
3. Re-enable the event source mapping. Verify DatabaseConnectionsCurrentlySessionPinned
   returns to zero and the multiplex ratio recovers.

## Long-term fix

Move the sequence call server-side. Change the invoice_number column definition to:

    invoice_number BIGINT DEFAULT nextval('invoice_number_seq')

Remove the explicit `SELECT nextval()` from the Lambda code. The sequence is now called
during the INSERT on the Aurora server, never through the proxy client session. No pin
is ever triggered.

Alternatively, if application-layer sequence control is required, route the `nextval()`
call through a direct Aurora writer endpoint (not through finch-proxy). Direct endpoints
have no proxy multiplexing semantics and no pin behavior.

## Why the usual signals were silent

- No deployment on Monday: the change was four days old. No one connected the outage to
  the Friday migration because the symptom did not appear until Monday peak traffic.
- Lambda errors showed connection timeouts, not a SQL error. The actual FATAL message
  was buried in Lambda CloudWatch Logs, not surfaced in the proxy metrics dashboard.
- DatabaseConnectionsCurrentlySessionPinned was not alarmed. The metric existed, the
  data was there, but no threshold alert was configured.

## Guardrails to prevent recurrence

- Add a CloudWatch alarm: DatabaseConnectionsCurrentlySessionPinned /
  DatabaseConnections > 0.5 for 3 consecutive minutes pages on-call.
- Add a CI lint rule that fails on `nextval(`, `currval(`, `SET `, `PREPARE `,
  `DECLARE CURSOR` in files that touch the proxy connection path.
- Review all existing Lambda SQL paths for pinning triggers before the next
  database migration window.
