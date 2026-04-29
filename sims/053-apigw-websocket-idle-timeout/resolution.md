---
tags:
  - type/resolution
  - service/api-gateway
  - service/lambda
  - service/dynamodb
  - service/cloudwatch
  - difficulty/associate
  - category/networking
---

# Resolution: Ten Minutes of Silence

## Root Cause

API Gateway WebSocket has a fixed 10-minute idle timeout. The timeout cannot be raised by configuration or by service quota request. Vaultlinen's clients (web, iOS, Android) do not send any application-layer heartbeat. Users who are reading without typing produce no traffic on the WebSocket; API Gateway closes the connection at the 10-minute mark with status 1001 ("client inactivity or connection lifetime exceeded"); the client's reconnect logic re-establishes the connection silently; messages that arrived during the brief gap are not refetched.

The bug had been gradually getting worse for three months as user behavior shifted toward idle "watching" of threads. It became severe enough to surface in customer-care tickets when the mean connection lifetime fell into single-digit minutes.

## Timeline

| Time | Event |
|---|---|
| Three months ago | "Watch threads silently" feature launches; encourages keeping idle tabs open |
| Three months ago | Mean WebSocket connection duration is 78 minutes |
| Two months ago | Mean duration drops to 38 minutes |
| One month ago | Mean duration drops to 14 minutes |
| Today (gradually since launch) | Customer-care tickets accumulate around "missed messages" and "disconnects every 10 minutes" |
| Today 09:00 - 16:00 | 318 tickets routed to engineering |
| Today 16:22 | On-call paged |
| Today 16:35 | Engineer correlates 9-minute-48-second mean lifetime with disconnect timing in CloudWatch |
| Today 16:42 | Engineer looks up API Gateway WebSocket idle timeout (10 min, fixed) |
| Today 16:50 | Heartbeat patch drafted for web client; iOS/Android queued for next release |
| Tomorrow 09:00 | Web client heartbeat ships; mean connection lifetime climbs back to 50+ minutes |
| Next week | iOS and Android client releases ship with heartbeat |

## Correct Remediation

1. **Confirm the timing pattern**: Pull a sample of disconnect events from the $disconnect Lambda's CloudWatch logs. Compute `disconnected_at - connected_at` for each. If the mode is around 600 seconds (10 minutes), you are hitting the API Gateway WebSocket idle timeout.
2. **Distinguish active vs idle**: Look at message counts per connectionId. Active users (any message in the 10 minutes prior to disconnect) are not affected. Idle users (zero messages) are the affected set.
3. **Look up the limit**: API Gateway WebSocket has a 10-minute idle timeout (no incoming or outgoing data on the connection) and a 2-hour maximum connection duration. The idle timeout is fixed by the service.
4. **Pick a fix path**:
   - Cheapest: add an application-layer heartbeat. Client sends `{"action":"ping"}` every 5 minutes; server `ping` route returns immediately. Works on the existing API Gateway product.
   - Medium: migrate to AppSync subscriptions. Managed long-lived WebSockets with built-in lifecycle management. Requires GraphQL on the client.
   - Heaviest: ALB + ECS or EC2 WebSocket termination. Idle timeout configurable up to 4,000 seconds. You own the WebSocket server. Best for very long-lived connections (hours).
5. **Implement the heartbeat**:
   - On the client: `setInterval(() => ws.send(JSON.stringify({action: 'ping'})), 5 * 60 * 1000)`.
   - On the server: add a `ping` route in the WebSocket API that integrates to a Lambda returning `200 pong`. Or use a mock integration that returns directly.
   - Confirm with a load test: open 100 idle connections, watch them stay alive past 30 minutes.
6. **Improve reconnect UX**:
   - On WebSocket close, set a small banner: "Reconnecting...".
   - On reconnect open, fetch messages with `timestamp > last_seen_timestamp` from the message API.
   - Only clear the banner once the catch-up fetch completes.
7. **Add monitoring**:
   - CloudWatch metric on $disconnect rate.
   - Custom metric on connection lifetime (compute in $disconnect Lambda from connected_at - now). Alarm if mean drops below, say, 30 minutes.
   - Alarm on count of disconnects with duration in [580, 620] seconds (the 10-minute bucket).

## Key Concepts

### API Gateway WebSocket lifecycle

API Gateway WebSocket terminates connections and routes incoming messages to integrations. Three predefined routes:

- `$connect`: invoked when a client opens a connection. Returning non-2xx rejects the connection.
- `$disconnect`: invoked when the connection ends, regardless of whether the client closed it, the server closed it, or it was reaped.
- `$default`: catches any incoming message that does not match a route selection expression.

Custom routes match on a route selection expression, typically `$request.body.action`, so `{"action":"sendMessage"}` invokes the `sendMessage` route Lambda.

### Idle timeout vs maximum duration

API Gateway WebSocket has two timeouts:

- **Idle timeout: 10 minutes.** No incoming or outgoing data on the connection. Cannot be raised.
- **Maximum connection duration: 2 hours.** Even active connections are terminated at this point. Cannot be raised. The client must reconnect.

For chat workloads with possible long idle reads, the 10-minute idle timeout is the binding limit. Heartbeats every 5 minutes (or anything below the 10-minute mark) keep idle connections alive.

For workloads that require connections longer than 2 hours, you must either build proactive reconnect into the client or move to a different platform (ALB+ECS WebSocket has up to 4,000 seconds idle timeout and no maximum duration).

### Heartbeat patterns

Three flavors:

- **Client-driven application heartbeat**: client sends a JSON message periodically. Simplest. Works with API Gateway as-is.
- **Protocol-level WebSocket ping/pong frames**: client or server sends a ping frame at the WebSocket protocol level. API Gateway WebSocket does not surface protocol-level pings to your Lambdas, so it counts as activity for the idle timer. Requires client library support.
- **Server-driven push**: server periodically sends a no-op message to the client. Requires the server to track all connections and push to each. Higher load on the server.

Client-driven application-layer ping is the standard for chat-style apps. Pick an interval between 1/2 and 1/3 of the idle timeout to allow for jitter.

### When to migrate off API Gateway WebSocket

- Idle reads beyond 10 minutes are common: stay with API Gateway and add heartbeat.
- Connections need to last more than 2 hours: migrate to ALB+ECS or AppSync.
- High connection count (over 100k concurrent): consider GameLift Realtime, AppSync, or self-hosted on ALB+ECS for cost.
- GraphQL-based product: AppSync subscriptions are the natural fit.

## Other Ways This Could Break

### Connections hit the 2-hour maximum duration

Even with a heartbeat, API Gateway WebSocket terminates connections at 2 hours. Customers in a long-running session see disconnects at 2 hours.
**Prevention:** Have the client reconnect proactively at 1h55m. The reconnect handshake should include a resume token so the conversation continues seamlessly without missed messages.

### PostToConnection on a closed connection crashes the fan-out Lambda

The fan-out Lambda treats GoneException as an unhandled error. SQS message goes to DLQ; other recipients also do not receive the message.
**Prevention:** Catch GoneException explicitly. Delete the connectionId from DynamoDB and continue with the other recipients in the batch.

### $connect Lambda timeout drops the handshake

$connect has a 5-second timeout and does heavy auth work that occasionally exceeds it. Some users cannot connect at all. Different from the idle disconnect; presents as failed handshake.
**Prevention:** Keep $connect lean. Validate JWT with a public-key check (no DB lookup), write the connectionId to DynamoDB, return. Defer richer profile loads to a follow-up message.

### DynamoDB writes in $connect throttle, connections accepted but not tracked

API Gateway accepts the connection because $connect returned 200, but the DynamoDB write failed. The connection exists but cannot receive fan-out messages. Looks like a delivery problem, not a disconnect problem.
**Prevention:** Treat DynamoDB write failure in $connect as a hard error; reject the connection so the client retries. Or use DAX-fronted DynamoDB to absorb bursts.

## SOP Best Practices

- For chat-style WebSocket workloads where users may be idle, build a heartbeat into the client from day one. A 5-minute ping is sufficient for API Gateway's 10-minute idle timeout; pick something below half the timeout to allow for jitter.
- Pick the right WebSocket platform for the workload. API Gateway WebSocket is simplest and cheapest for short-lived turn-taking traffic; AppSync subscriptions are best for GraphQL chat with built-in lifecycle; ALB+ECS gives the most control and the longest idle timeouts.
- Build robust client reconnect from day one. Detect closed states, surface them visually, refetch missed messages after reconnect. Even with heartbeats, network blips happen, and a silent reconnect that loses messages is a bug.
- Treat GoneException in PostToConnection as a normal cleanup signal, not an error. Delete the connectionId and continue. Errors here cascade because the SQS message gets retried.

## Learning Objectives

1. **WebSocket lifecycle**: Articulate $connect, $disconnect, $default, and custom routes.
2. **API Gateway WebSocket limits**: Know the 10-minute idle timeout and 2-hour maximum duration; know they are fixed.
3. **Heartbeat patterns**: Choose between client-driven application ping, protocol-level frames, and server-driven push for the workload.
4. **Platform selection**: Match WebSocket termination layer to traffic shape (turn-taking vs idle-reading vs hours-long sessions).

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
