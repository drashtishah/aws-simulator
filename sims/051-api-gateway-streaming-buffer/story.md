---
tags:
  - type/simulation
  - service/api-gateway
  - service/lambda
  - service/bedrock
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# The Answer That Arrived All at Once

## Opening

- company: Latticelens
- industry: AI productivity tools
- product: AI workspace assistant for knowledge work; chat-style UI with token-by-token streaming
- scale: 22 engineers, 84,000 paid users on Pro tiers, peak 1,800 concurrent chat sessions
- time: Wednesday 09:42 ET
- scene: On-call backend engineer, customer-success has paged on streaming-broken tickets
- alert: "latticelens-api: 5xxError on chat-completions integration spiked from 0.02% to 1.6% at 22:00 UTC yesterday"
- stakes: 184 customer tickets in 6 hours; founders talk about the typing animation in podcasts; product brand depends on the streaming UX
- early_signals:
  - Customer reports describe answers arriving all at once after a long pause, or 504 errors after about 30 seconds
  - chat-completions Lambda success rate dropped from 99.97% to 98.4% at exactly 22:00 UTC yesterday
  - Lambda durations climbed 3.8x at the same minute
  - Bedrock metrics are stable; invocations up 4%, errors flat
  - The platform team migrated from ALB to API Gateway REST API yesterday at 22:00 UTC
- investigation_starting_point: chat-completions Lambda is invoked by API Gateway REST API on POST /v1/messages. The Lambda calls Bedrock InvokeModelWithResponseStream against claude-sonnet-4-6, drains the streaming response into a single string, and returns it. This was done because "the gateway dropped the streaming chunks anyway." Yesterday's migration switched the front-end from chat-alb.latticelens.example to a new chat-api.latticelens.example custom domain attached to an API Gateway REST API.

## Resolution

- root_cause: The new API Gateway REST API integration for POST /v1/messages has responseTransferMode = BUFFERED (the default). API Gateway waits for the full Lambda response before sending any bytes to the client. The integration timeout is the REST API default of 29,000 milliseconds. Long Bedrock responses take 18 to 45 seconds to fully generate; the ones that take longer than 29 seconds hit the timeout and return 504, even though the Lambda eventually completes successfully.
- mechanism: Yesterday's migration replaced the ALB (which streams natively) with an API Gateway REST API (which buffers by default). The chat-completions Lambda was already drained-and-return because that is how it had to be written when the gateway buffers. After migration: short responses (under 29 seconds) succeed but feel like a "frozen UI then a wall of text" since the gateway sends nothing until the Lambda finishes. Long responses hit 29 seconds first and the gateway returns 504 to the client. From the client's perspective, the typing animation is gone, replaced by a frozen cursor and either a sudden answer or a 504.
- fix: Set responseTransferMode = STREAM on the integration (`aws apigateway update-integration ... --patch-operations op=replace,path=/responseTransferMode,value=STREAM`). Update the Lambda to use awslambda.streamifyResponse and write Bedrock chunks directly to the response stream. Redeploy the API stage. Streaming integrations support up to 15 minutes; client gets bytes within ~200 ms; typing animation returns. Long-term, evaluate moving to a Lambda Function URL with RESPONSE_STREAM invoke mode (less gateway overhead) or back to the ALB.
- contributing_factors:
  - The migration plan focused on auth and throttling, not on response streaming
  - The chat-completions Lambda was already written to drain-and-return, so it appeared to work in dev where prompts were short
  - Load testing during the migration used 200-token responses, which complete well under 29 seconds; the long-prompt scenarios were not tested
  - The default responseTransferMode was not flagged in the API Gateway documentation summary the team relied on
  - The integration timeout 504 looks identical to a Lambda 504, masking the actual cause
