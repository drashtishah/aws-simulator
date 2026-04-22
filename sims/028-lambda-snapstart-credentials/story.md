---
tags:
  - type/simulation
  - service/lambda
  - service/iam
  - service/sts
  - service/secrets-manager
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# Yesterday's Token, Today's Traffic

## Opening

- company: Tidewater Pay
- industry: B2B vertical SaaS for marinas and boat dealers
- product: payment processing and reconciliation APIs used by about 2,400 marinas and 900 boat dealers
- scale: Series B, 65 engineers, roughly 11,000 payment webhooks per minute at West Coast peak, 99.9% availability SLO
- time: Wednesday 06:11 AM Pacific, the start of the West Coast peak
- scene: the overnight on-call engineer is finishing a coffee when the first burst of 500s hits
- alert: "tidewater-payments-fn Errors > 50 over 5 minutes. Error rate: 11%."
- stakes: every failed webhook either gets retried by the partner (duplicating work) or dropped (missing a payment record). Ten-minute outages show up in the monthly reconciliation as write discrepancies that have to be investigated one row at a time. Continuous error bursts at peak could breach the availability SLO for the quarter.
- early_signals:
  - Stack trace shows ExpiredTokenException from DynamoDB PutItem
  - Lambda's own Errors metric is high, Duration and Throttles are normal
  - DynamoDB metrics are green on all tables
  - SnapStart was enabled six days ago; the error started appearing four days ago and has gotten worse each morning
  - Overnight low-traffic period has no errors; the spike correlates with cold starts at traffic pickup
- investigation_starting_point: on-call has the Lambda logs open. Every error is the same: ExpiredTokenException on a DynamoDB call from the payments function. The function's execution role is fine. The issue is in the credentials the function is trying to use.

## Resolution

- root_cause: the DynamoDB client in tidewater-payments-fn is constructed in a Java static field: private static final DynamoDbClient dynamo = DynamoDbClient.create(). When the class is loaded, the SDK builds its credential provider chain and caches the STS credentials fetched from the Lambda credentials endpoint (AWS_CONTAINER_CREDENTIALS_FULL_URI). SnapStart takes the JVM snapshot after class loading, so the cached credentials and their expiry timestamp live inside the snapshot. SnapStart reuses the same snapshot for every cold start, so every cold start inherits the same cached credentials. The credentials have roughly a six-hour lifetime at issue time. By the next morning's traffic pickup, the credentials in the snapshot have expired. Cold-started invocations that restore from the snapshot get the expired credentials and fail on the first DynamoDB call. Warm containers, which had refreshed their credentials in-flight, keep working.
- mechanism: at 06:11 each morning, Lambda scales up to meet incoming webhook traffic. New containers restore from the SnapStart snapshot. Each restored container's DynamoDB client holds a credentials object with expiry 02:14 local (the snapshot's cached value), which is hours in the past. The first DynamoDB request throws ExpiredTokenException. The credential provider, had it been contacted, would have refetched from the Lambda credentials endpoint, but the provider's internal logic is "fetch on next cache miss," and there is no cache miss yet: the cache has a value, just an expired one. Some provider implementations do check the expiry and refetch, but the version pinned in this function does not refresh until the cached value is observed to be invalid. Between the expiry check and the DynamoDB call there is no retry in this code path, so the call fails hard.
- fix: the backend lead picks the simpler of two options: register a SnapStart afterRestore hook that calls a method on the DynamoDB client to close and rebuild it, which forces the credential provider to refetch. The hook is about twelve lines of Java. The function is redeployed and a new version is published (SnapStart snapshots are taken at publish time; the old version's snapshot is the broken one). Errors drop to zero within five minutes of the new version taking live traffic. Follow-up work includes moving the client out of the static initializer into a lazy holder, adding a CloudWatch alarm on ExpiredTokenException, and adding a load-representative staging test that runs for eight hours with SnapStart enabled.
- contributing_factors:
  - The static initializer pattern is the textbook way to set up SDK clients in Lambda for fast cold starts. The pattern predates SnapStart and was never updated.
  - The AWS SDK version pinned in this project is old enough that DefaultCredentialsProvider does not proactively refresh before the cached expiry.
  - SnapStart documentation covers the credential-refresh issue but is new enough that the team had not read that page when they enabled the feature.
  - Staging tests ran for fifteen minutes against a freshly-published snapshot. The snapshot in staging never crossed the credentials-expiry horizon, so the bug could not manifest.
  - There was no CloudWatch alarm on ExpiredTokenException, so the first two mornings of errors (about 2% error rate) went unnoticed; only the rise above 10% triggered the existing Errors-per-5-minutes alarm.
