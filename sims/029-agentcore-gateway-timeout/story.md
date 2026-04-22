---
tags:
  - type/simulation
  - service/bedrock-agentcore
  - service/lambda
  - service/api-gateway
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# Five Minutes Is Not Enough

## Opening

- company: Quillstone Support
- industry: B2B customer support SaaS
- product: an AI-augmented support platform where human agents triage customer tickets with help from an AI assistant that can take actions (place orders, process returns, update subscriptions) on a customer's behalf
- scale: Series A, 48 engineers, about 230 customer companies, the AI assistant completes roughly 4,800 reorders per week across all customers
- time: Friday 14:22 local
- scene: the on-call engineer is a few days into their first rotation. The head of platform is two hours away at a conference.
- alert: the partner Fulfillment team's account manager emails: "you placed 14 duplicate reorders on your customers this morning. Two have already shipped. Please confirm if this is intentional."
- stakes: customers are being double-charged. A handful of shipments have already left the partner's warehouses. The platform's core value proposition is that the AI assistant takes safe, precise actions; double-charging is the opposite of safe. Every duplicated order is a refund plus an apology call.
- early_signals:
  - Agent tool-call log shows reorder-from-catalog invocations returning 504 Gateway Timeout at almost exactly 5:00.04 every time
  - The agent framework transparently retries on 504; some reorders show two retries, some show three
  - CloudWatch shows the quillstone-reorder-fn Lambda completing successfully at ~6:30 minutes every time
  - CloudWatch also shows the partner Fulfillment API returning 201 Created for every call, including the duplicates
  - No alarm fired on any of this. The 504 from Gateway is not wired to a metric, and the Lambda success metric looked fine.
- investigation_starting_point: the on-call engineer has the agent's tool-call log open. Every single call to the reorder tool ends in a 504 followed by a retry. The 504 timestamp is exactly 300 seconds after the call started. That number is too precise to be a coincidence.

## Resolution

- root_cause: the reorder-from-catalog MCP tool is hosted on Amazon Bedrock AgentCore Gateway. Gateway has a 300-second (5 minute) invocation timeout. The tool's work (fetch partner catalog, match SKU, place order on Fulfillment API) takes 6 to 8 minutes because the partner's catalog endpoint is slow and the reorder flow refreshes it before placing the order. Every call exceeds the Gateway timeout. Gateway returns 504 to the agent. The agent framework's default retry policy treats 504 as transient and retries. The downstream Lambda and the Fulfillment API do not know the Gateway cut off the upstream, so the original call continues to completion and places the order. The retry starts a second flow, which also places an order (the catalog is now warm, so the retry completes in a bit over two minutes and does not time out). The reorder Lambda does not send an Idempotency-Key to the Fulfillment API, so the vendor accepts both requests as distinct and ships both.
- mechanism: on a Monday morning, the shared partner catalog cache is cold and the first reorder of the day takes 7:04. At 5:00.04, Gateway returns 504. The agent retries at 5:00.05 while the original Lambda invocation is still running inside API Gateway's timeout window. The second Lambda invocation benefits from the cache the first one warmed up and completes at 2:12. The second call's 201 Created is what the retry sees. The first call also completes at 7:04 and places its own 201 Created. Two orders. Same customer, same SKU, same date.
- fix: the platform engineer migrates the reorder MCP tool from AgentCore Gateway to AgentCore Runtime. Runtime's synchronous request timeout is 15 minutes, which accommodates the tool's 6 to 8 minute latency comfortably. The agent's tool binding is updated to point at the Runtime endpoint. In parallel, the reorder Lambda is updated to send a deterministic Idempotency-Key header derived from the user ID, SKU, and requested date. The Fulfillment API uses that header to reject duplicates on its side even if Runtime ever gets interrupted and Quillstone retries. The agent framework's retry behavior is changed for side-effect tools: on any error, the tool returns to the agent instead of being transparently retried. A CloudWatch metric filter on Gateway 504s fires any time a Gateway-hosted tool is cut off.
- contributing_factors:
  - The team chose Gateway for the MCP tool because Gateway was the first option in the AgentCore setup wizard. Nobody compared Gateway's timeout to the tool's expected latency before shipping.
  - The reorder Lambda's 10-minute client timeout is longer than the Gateway's 5-minute cut-off, so the Lambda had no reason to know anything was wrong.
  - The agent framework retries on 504 by default. Side-effect tools should be marked non-idempotent to opt out, but no such annotation was present.
  - The Fulfillment API accepts idempotency keys if provided but did not require them. Quillstone never sent one.
  - There was no CloudWatch alarm on Gateway 504s. The signal was in the agent tool-call log, which no human read until the partner Fulfillment team emailed.
