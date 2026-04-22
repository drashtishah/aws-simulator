---
tags:
  - type/resolution
  - service/bedrock-agentcore
  - service/lambda
  - service/api-gateway
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# Resolution: Five Minutes Is Not Enough

## Root Cause

The reorder MCP tool is hosted on Amazon Bedrock AgentCore Gateway. Gateway invocations are capped at 300 seconds. The tool takes 6 to 8 minutes because it refreshes the partner's slow catalog before placing an order. Every call is cut off by Gateway at the 5-minute mark; the Gateway returns `504 Gateway Timeout` to the agent, but the downstream Lambda and the partner Fulfillment API do not know the upstream gave up and they finish their work, placing a real order. The agent framework's default retry policy treats `504` as transient and retries. The retry often succeeds (the catalog is warm now) and places a second order. Because the reorder Lambda never sends an `Idempotency-Key` header, the Fulfillment API accepts both calls as independent and ships both.

## Timeline

| Time | Event |
|---|---|
| T-6 weeks | Agent ships with the reorder MCP tool on AgentCore Gateway. Shadow-mode testing used a pre-warmed catalog; tool latency was under 30 seconds. |
| Day -7 to Day 0 | Every morning's first reorder exceeds 5:00 because the partner catalog cache is cold. The agent retries. Duplicates accumulate. |
| Day 0, 09:14 | The partner Fulfillment team notices the duplicates during reconciliation. |
| Day 0, 14:22 | Partner's account manager emails. On-call sees the agent tool-call log for the first time. |
| Day 0, 14:48 | Tool migrated to AgentCore Runtime. |
| Day 0, 15:11 | Idempotency key added to the reorder Lambda. |
| Day 0, 15:30 | Retry behavior disabled for side-effect tools in the agent framework. |
| Day 0, 16:00 | CloudWatch alarm on Gateway 504 rate added. |
| Day +1 | Reconciliation script identifies 43 total duplicates over the past week. Customer refunds processed. |

## Correct Remediation

1. **Read the tool-call log.** Look at every recent call to the failing tool. If every failure happens at almost exactly 300 seconds, the 5-minute AgentCore Gateway invocation timeout is the cut-off, not the downstream.
2. **Compare the tool's latency to the platform's timeout.** Pull CloudWatch metrics for the tool's p50 and p95 latency over the last two weeks. AgentCore Gateway's invocation timeout is 300 seconds. If your tool's p95 is near or above that, Gateway will cut a significant number of calls.
3. **Know the targets.** AgentCore Gateway is built for short, stateless tool calls; its 5-minute timeout is intentional. AgentCore Runtime is built for long-running tools and stateful sessions; synchronous requests can run for 15 minutes and asynchronous sessions up to 8 hours. A tool whose normal latency exceeds 5 minutes belongs on Runtime.
4. **Look at what the tool does downstream.** Read the Lambda and any APIs it calls. If the tool places orders, processes payments, sends notifications, or does anything with a real-world side effect, it is not safe to retry blindly.
5. **Move the tool to AgentCore Runtime.** Publish a Runtime with the tool's container image. Set `idleRuntimeSessionTimeout` and `maxLifetime` appropriate to the tool's duration. Update the agent's tool binding to point at the Runtime endpoint instead of the Gateway endpoint.
6. **Add idempotency keys.** For every call from the reorder Lambda to the Fulfillment API, send an `Idempotency-Key` header whose value is a deterministic hash of the user's request (user ID + SKU + requested date). The Fulfillment API rejects duplicates whose key matches a recent successful call.
7. **Disable transparent retries for side-effect tools.** In the agent framework configuration, mark the reorder tool as non-idempotent. On any error, the framework surfaces the error to the agent instead of retrying. The agent can then ask the user how to proceed rather than double-charging them.
8. **Alarm on Gateway 504s.** Add a CloudWatch metric filter on the Gateway log group for `504` and alarm when the rate exceeds a threshold. This catches future tools that grow past the 300-second cut-off before customers do.
9. **Reconcile and refund.** Pull the last week of reorder tool calls, compare against the Fulfillment API's orders table, identify duplicates, cancel shipments where possible, and refund customers where not. Prepare a customer notification.

## Key Concepts

### AgentCore Gateway vs AgentCore Runtime

Amazon Bedrock AgentCore has two primary hosting targets for agents and tools, and the choice determines how long a single invocation can run. **AgentCore Gateway** is optimized for short, stateless tool calls, like a lookup against a database or a call to a quick partner API. Every invocation is capped at 300 seconds. **AgentCore Runtime** is built for long-running agents and tools. A synchronous request can run up to 15 minutes, and an asynchronous session can live up to 8 hours. Runtime also supports a ping mechanism (the tool periodically responds with HEALTHY_BUSY) for work that legitimately runs longer than the synchronous request timeout. The right choice depends on the tool's expected latency distribution. A tool with p95 latency of 90 seconds belongs on Gateway; a tool with p95 of 7 minutes belongs on Runtime.

### Why 504 from Gateway is deceptively dangerous

A `504 Gateway Timeout` from any proxy (AgentCore Gateway, API Gateway, a load balancer) means the proxy gave up waiting for the upstream. It does not mean the upstream stopped. The upstream's own timeout is usually longer, so the upstream keeps doing whatever it was doing and produces real side effects (orders, writes, messages). The caller sees `504` and often retries. If the upstream is not idempotent, the retry becomes a duplicate of work the first call already did. The right defaults for tools with side effects are: do not auto-retry on `504`, send idempotency keys, and alarm on `504` as a signal that the platform is cutting off the tool.

### Idempotency keys

An idempotency key is a token sent with a request so the receiver can recognize retries. The sender derives the key from the logical request (for example `sha256(user_id + sku + order_date)` for a reorder). The receiver stores successful keys for a window (hours to days) and, on a second request with the same key, returns the cached result without redoing the work. For agent-driven workflows the sender is usually the tool Lambda; the agent can pass a key down as part of the tool call parameters so the whole chain is deterministic. Idempotency keys are the standard way to make external API calls safe to retry in the presence of network failures, timeouts, and proxy cut-offs.

## Other Ways This Could Break

### The tool is moved to Runtime but still dies at 15 minutes because it does not send pings
Runtime fixed the 5-minute cut-off, but Runtime's synchronous request timeout is 15 minutes. For tools that can take longer, Runtime supports a ping mechanism. Without pings, a tool that truly needs 20 minutes still gets interrupted.
**Prevention:** Implement the ping/HEALTHY_BUSY pattern per AgentCore docs. Or split the tool into an async pattern: the tool enqueues a job and returns a handle immediately; the agent polls for completion.

### The idempotency key is wrong (timestamp-based, new on every retry)
Idempotency keys are in place, so on the surface the problem looks solved. But the key generation uses `System.currentTimeMillis()`, so every retry produces a new key. The Fulfillment API sees two distinct requests and ships both.
**Prevention:** Generate keys deterministically from the request inputs. A hash of user ID plus SKU plus target date yields the same key on retry. If the inputs are identical, the key must be identical.

### Retry logic lives at the AgentCore SDK layer and ignores agent-framework configuration
You mark the reorder tool as non-idempotent in the agent framework's tool metadata. Retries still happen because the SDK layer retries before the agent framework sees the error.
**Prevention:** Configure retry behavior on the Gateway target or Runtime SDK client, not just in the agent framework. For side-effect tools, disable client-side retries entirely so a single `504` bubbles up instead of being silently swallowed.

## SOP Best Practices

- Pick the AgentCore hosting target based on expected tool duration. Gateway for under 5 minutes, Runtime for longer. Document the rationale and revisit when the tool's latency distribution changes.
- Every tool with side effects carries an idempotency key end-to-end. The agent passes it, the tool forwards it, the downstream API uses it.
- Categorize tools by idempotency and configure retry behavior accordingly. Read-only tools can retry transparently; side-effect tools surface errors instead.
- Alarm on Gateway 504 rate and Runtime timeout interruptions. These are the earliest signals that a tool's latency has outgrown its host.

## Learning Objectives

1. **AgentCore hosting targets**: Choose between Gateway (5-minute cut-off, short stateless tools) and Runtime (15-minute sync, 8-hour async) based on tool latency.
2. **Interpreting 504**: Recognize that `504 Gateway Timeout` means the proxy gave up, not the upstream, and that the upstream's side effects keep happening.
3. **Idempotency keys**: Implement deterministic keys on side-effect tools so retries are safe by construction.
4. **Agent retry configuration**: Disable transparent retries for non-idempotent tools so the agent (and the user) can decide what to do on failure.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[learning/catalog.csv]] -- Player service catalog and progress
