---
tags:
  - type/resolution
  - service/lambda
  - service/iam
  - service/sts
  - service/secrets-manager
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# Resolution: Yesterday's Token, Today's Traffic

## Root Cause

The `tidewater-payments-fn` Lambda constructs its DynamoDB client in a Java static field initializer. At class-load time the AWS SDK builds a credential provider chain and caches the STS credentials it fetches from the Lambda credentials endpoint (`AWS_CONTAINER_CREDENTIALS_FULL_URI`). The cached credentials carry an expiry timestamp. SnapStart takes the JVM snapshot after class loading completes, so those credentials and their expiry are frozen in the snapshot. Every cold-started invocation restores from the same snapshot and inherits the same cached credentials. By 06:11 the next morning, those credentials have expired (STS tokens from the Lambda endpoint live roughly six hours). Cold-started invocations call DynamoDB, the SDK sends the expired session token, and DynamoDB returns `ExpiredTokenException`. The provider's "check expiry before using" path is not hit because the SDK version in use refreshes on observed failure rather than on proactive expiry check.

## Timeline

| Time | Event |
|---|---|
| Day -6, 14:00 | SnapStart enabled on tidewater-payments-fn. First snapshot published. Cold start drops from 1.4s to 80ms. Team declares success. |
| Day -5, 06:02 | First ExpiredTokenException errors appear in logs (about 2% error rate during morning spike). Existing Errors alarm threshold is 10%, so no page. |
| Day -4 to Day -1 | Error rate grows each morning as more containers restore from snapshots that crossed the credential expiry. |
| Day 0, 06:11 | Error rate crosses 10%. On-call paged. |
| Day 0, 06:30 | Engineer reads logs, sees ExpiredTokenException. Correlates with SnapStart enablement. |
| Day 0, 06:52 | Fix: afterRestore hook added to invalidate the DynamoDB client. New version published. SnapStart takes a fresh snapshot. |
| Day 0, 06:58 | New version takes live traffic. Error rate drops to zero within five minutes. |

## Correct Remediation

1. **Confirm where the error comes from.** In the Lambda log group, filter for `ExpiredTokenException`. Read the full stack trace. It should originate in `software.amazon.awssdk.services.dynamodb` or `com.amazonaws.services.dynamodbv2`, not in Lambda runtime code. This tells you the token was accepted by Lambda (the invocation started) but rejected by DynamoDB.
2. **Check whether SnapStart is enabled.** Open the Lambda function's version or alias configuration. `SnapStart.ApplyOn` is either `None` or `PublishedVersions`. If it is the latter, cold starts use snapshots. Cross-reference the date SnapStart was enabled with the date the errors began.
3. **Read the handler's class-loading code.** Look for fields initialized with `DynamoDbClient.create()`, `SecretsManagerClient.create()`, `S3Client.create()`, or any other AWS SDK client constructed at static or field-initializer time. These clients' credential caches and connection pools are in the snapshot.
4. **Understand the credential cache behavior.** The SDK's credential provider caches the credentials it reads from the Lambda credentials endpoint. Depending on the SDK version, it refreshes either proactively (a few minutes before expiry by wall-clock) or reactively (on `ExpiredTokenException` from a downstream service). Either way, a snapshot taken before expiry and restored after expiry carries stale credentials.
5. **Pick a fix.** Two good options:
    - **Option A (simpler)**: move the SDK client out of the static initializer. Use a lazily-initialized field inside the handler class, or construct the client in the handler method. You give up a few milliseconds on the first invocation per container but the snapshot no longer holds credentials.
    - **Option B (faster)**: keep the static client and register a SnapStart Core.Runtime `afterRestore` hook that closes and rebuilds the client, forcing the credential provider to refetch. This preserves SnapStart's speed benefit and only adds work on restore.
6. **Implement the `afterRestore` hook (Option B).** Use `software.amazon.awssdk.crt.runtime.Core` or the Lambda SnapStart Java API (`Core.getGlobalContext().register(Resource)`). The hook body should `close()` the existing SDK client reference and reassign it to a freshly constructed one.
7. **Republish the function.** SnapStart takes a snapshot at publish time. Any code change only takes effect on a new published version, because the old version's snapshot is the one that has the bug. Update the alias to point at the new version.
8. **Add a CloudWatch metric filter on `ExpiredTokenException`.** Filter the function's log group for the exception string and publish a custom metric. Alarm when the count is greater than zero for five minutes. This catches the same bug class anywhere in any function, not just this one.
9. **Run a staging test that spans the credential expiry window.** Local and short-lived staging tests never cross the six-hour horizon. Run a staging environment under load for eight hours, force cold starts at the end, and confirm no expired-token errors.

## Key Concepts

### What SnapStart actually snapshots

SnapStart takes a snapshot of the function's initialized runtime after all class loading and static initialization have run. For Java this includes the JVM heap, the thread stacks, and every field of every initialized class. Anything cached at init time, including AWS SDK credential caches, HTTP connection pools, DNS resolutions, randomness state, and in-memory secrets, is in the snapshot. SnapStart reuses the snapshot for cold starts across the life of the function version. A bad value in the snapshot is a bug that affects every cold start, not a transient one-off.

### AWS SDK credential provider behavior

The default credential provider chain in the AWS SDK builds a priority-ordered list of sources: environment variables, the ECS/EKS container provider, the Lambda-specific provider, the instance profile. Inside Lambda, the Lambda-specific provider wins: it reads credentials from a local HTTP endpoint whose URL is in `AWS_CONTAINER_CREDENTIALS_FULL_URI`. The provider caches the response and its expiry. Different SDK versions refresh differently: newer ones refresh proactively several minutes before expiry; older ones refresh reactively when a downstream call returns `ExpiredTokenException` and the SDK retries. If the retry path is not triggered, the first call after expiry fails outright.

### SnapStart Core.Runtime hooks

Lambda SnapStart exposes two hooks in the Java runtime: `beforeCheckpoint` (called once, just before the snapshot is taken) and `afterRestore` (called every time the snapshot is restored). Register hooks via `Core.getGlobalContext().register(Resource)`. `beforeCheckpoint` is the place to flush and close any resource whose state should not be frozen (open HTTP connections, open file handles, authenticated sockets). `afterRestore` is the place to refresh anything time-bound: credentials, secrets, random seeds, DNS-resolved targets. For SDK clients specifically, the simplest pattern is to close-and-rebuild the client in `afterRestore` so the credential provider refetches on first use.

## Other Ways This Could Break

### HTTP connection pool frozen in the snapshot
An Apache or Netty-based HTTP client in the static initializer has its connection pool snapshotted. On restore, the pool holds connections that no longer exist (the TCP sockets cannot be in the snapshot). First calls through the pool fail or hang. The symptom is `ConnectionClosedException` or long timeouts, not `ExpiredTokenException`.
**Prevention:** Close the HTTP client's connection pool in `beforeCheckpoint` and rebuild it in `afterRestore`, or move client construction out of static init.

### Cached secret in memory became stale because the underlying secret was rotated
The function fetches a signing key from Secrets Manager at init time and caches it in a field. Between snapshot and restore, the secret was rotated. The function keeps using the old key; downstream signature verification fails, and the partner rejects every payment. The function itself sees success locally; the breakage is partner-side.
**Prevention:** Do not cache secrets across restores. Either refetch in the handler, cache with a short wall-clock TTL, or refresh in `afterRestore`.

### Cached DNS resolution targets a decommissioned host
The JDBC URL or any hostname was resolved at init time and cached as an IP. Between snapshot and restore, the target's DNS was rotated. Every call to the cached IP fails with `UnknownHostException` or `ConnectionRefused`.
**Prevention:** Do DNS resolution in the handler or in `afterRestore`. Use RDS Proxy or a similar managed front end to absorb DNS churn.

## SOP Best Practices

- Assume everything initialized before the checkpoint is suspect. Credentials, connections, secrets, DNS, randomness. For each, decide: avoid the snapshot (initialize in handler) or refresh on restore (Core.Runtime hook).
- Register Core.Runtime hooks as a standard pattern for every SnapStart-enabled function. Pre-checkpoint flushes; post-restore refreshes. Treat this as the default template, not as a bug-specific workaround.
- Run staging load tests that cross the credential-expiry horizon. Short tests never exercise the bug this sim covers.
- Alarm on `ExpiredTokenException`, `ProvisionedThroughputExceededException`, and `AccessDenied` in every Lambda log group. These are systemic errors, not transient ones; a zero-threshold alarm is worth the noise.

## Learning Objectives

1. **SnapStart internals**: Understand what SnapStart snapshots, when the snapshot is taken, and that the same snapshot is reused across many restores.
2. **Credential caching**: Know how the AWS SDK credential provider chain caches STS credentials and how version-to-version refresh behavior varies.
3. **Core.Runtime hooks**: Use `beforeCheckpoint` and `afterRestore` to cleanly invalidate time-bound state across a SnapStart boundary.
4. **Test design for snapshot reuse**: Build staging tests that cross the credential-expiry horizon so snapshot reuse bugs manifest before production.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[learning/catalog.csv]] -- Player service catalog and progress
