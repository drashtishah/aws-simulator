---
tags:
  - type/resolution
  - service/api-gateway
  - service/lambda
  - service/bedrock
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# Resolution: The Answer That Arrived All at Once

## Root Cause

The migration from ALB to API Gateway REST API switched the public entry point from a layer that streams responses natively to one that buffers them by default. The integration on POST /v1/messages has `responseTransferMode = BUFFERED`, which means API Gateway waits for the entire Lambda response before forwarding any bytes to the client. The REST API integration timeout is 29 seconds in BUFFERED mode. Bedrock streaming responses for long prompts can take 30 to 45 seconds to fully generate. Anything that runs past 29 seconds hits the gateway's integration timeout and returns 504, even though the Lambda eventually finishes successfully.

The chat-completions Lambda had been written to drain Bedrock's streaming response into a single string before returning, because that is the only thing that worked when API Gateway was buffering anyway. The "buffer plus drain plus return" pattern is correct for buffered integrations; it just means the user experience is "wait, then receive everything at once," and any response that takes longer than the integration timeout fails entirely.

## Timeline

| Time (UTC) | Event |
|---|---|
| Yesterday 22:00 | Platform team migrates chat.latticelens.example DNS from ALB to API Gateway REST API custom domain |
| Yesterday 22:00 | API Gateway integration on POST /v1/messages provisioned with responseTransferMode = BUFFERED (default) |
| Yesterday 22:00 - 23:00 | First wave of customer reports about "frozen typing animation" |
| Yesterday 23:14 | First 504 errors logged for prompts that take more than 29 seconds |
| Today 03:00 - 09:30 | 184 tickets accumulate; reports include both blob-of-text symptom and 504 symptom |
| Today 09:42 | On-call paged |
| Today 09:48 | Engineer correlates 22:00 deploy with metric inflection; pulls API Gateway integration config |
| Today 09:51 | responseTransferMode = BUFFERED identified |
| Today 09:55 | Engineer updates integration to STREAM mode and patches Lambda to use awslambda.streamifyResponse |
| Today 10:08 | Stage redeployed; first streaming response confirmed via curl with --no-buffer |
| Today 10:14 | Customer reports stop arriving; Lambda durations and gateway 5xx return to baseline |

## Correct Remediation

1. **Trace one failing request**: Pull a request ID from the gateway access logs that returned 504. Find the matching Lambda log entry. The Lambda likely succeeded (no error). The gap between the Lambda finishing and the client getting 504 is the buffering layer.
2. **Inspect the integration**: `aws apigateway get-integration --rest-api-id <id> --resource-id <id> --http-method POST`. Look for `responseTransferMode`. If it is `BUFFERED` or absent (BUFFERED is the default), the gateway is waiting for the full Lambda response.
3. **Confirm the timeout**: REST API integration timeout is 29,000 ms in BUFFERED mode. If your Lambda regularly takes longer than that, you will hit 504 before the Lambda completes.
4. **Switch to STREAM mode**: Update the integration:
   ```
   aws apigateway update-integration \
     --rest-api-id <id> \
     --resource-id <id> \
     --http-method POST \
     --patch-operations op=replace,path=/responseTransferMode,value=STREAM
   ```
   Redeploy the stage. STREAM mode supports integration durations up to 15 minutes.
5. **Update the Lambda to actually stream**: STREAM mode requires the Lambda to return chunks via `awslambda.streamifyResponse` (Node.js) or to write a delimited metadata-then-payload format. Replace the drain-and-return code with a streaming handler that pipes Bedrock chunks straight to the response stream.
6. **Verify with curl**: `curl --no-buffer -N https://chat.latticelens.example/v1/messages -d '{...}'`. You should see bytes arriving incrementally rather than after a long pause. Check headers for `Transfer-Encoding: chunked`.
7. **Update load tests**: Add long-prompt scenarios that produce 30+ second responses. The pre-migration tests used short prompts and never exercised the buffering boundary.
8. **Consider the right product**: STREAM mode makes REST API workable, but Lambda Function URLs with `RESPONSE_STREAM` invoke mode have less ceremony. ALB streams natively. For new streaming workloads, evaluate Function URL first, then HTTP API, then REST API.

## Key Concepts

### API Gateway response modes

API Gateway REST API has two response transfer modes for proxy integrations:

- **BUFFERED** (default): the gateway waits for the integration to return its full response before forwarding any bytes to the client. Integration timeout is 29 seconds.
- **STREAM**: the gateway forwards bytes from the integration to the client as they arrive. Integration can last up to 15 minutes.

STREAM mode requires `HTTP_PROXY` or `AWS_PROXY` integration types. Cannot be combined with endpoint caching, response transformation via VTL, or content encoding.

### Lambda response streaming

Lambda has a special invocation mode for streaming responses. In Node.js, you wrap the handler:

```javascript
exports.handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    responseStream.write('chunk1');
    responseStream.write('chunk2');
    responseStream.end();
  }
);
```

The function gets a writable stream instead of returning a value. Bytes flushed to the stream go to the caller as they arrive. There are three ways to invoke a streaming Lambda:

- **InvokeWithResponseStream API**: direct SDK call, returns a stream of `PayloadChunk` events.
- **Lambda Function URL with `RESPONSE_STREAM` invoke mode**: HTTPS endpoint attached directly to the Lambda. Up to 200 MB response.
- **API Gateway integration with `responseTransferMode = STREAM`**: gateway calls the Lambda via InvokeWithResponseStream and forwards chunks.

### Why ALB worked without configuration

ALB is a Layer 7 proxy that natively supports HTTP/2 and chunked transfer encoding. When the Lambda target writes chunks, ALB forwards them. There is no buffering layer to configure. Migration plans that switch from ALB to API Gateway often miss this because both are "load balancers" in casual conversation but they have different defaults.

### The 29-second timeout signature

A 504 at exactly 29 seconds is the canonical signature of API Gateway REST API hitting its BUFFERED integration timeout. If you see 504s clustered at this duration, suspect the gateway and integration mode rather than the Lambda or downstream services.

## Other Ways This Could Break

### CloudFront in front of API Gateway buffers responses

API Gateway is set to STREAM, but a CloudFront distribution sits in front and buffers everything. Looks like a gateway problem; actual culprit is CloudFront. Common when CloudFront was added for static asset caching and the chat path was inadvertently routed through it.
**Prevention:** Use a separate CloudFront cache behavior for the streaming path (or bypass CloudFront for streaming endpoints). CloudFront does not have a streaming-passthrough mode for arbitrary chunked responses.

### WAF body inspection rule causes buffering

Streaming response works for some users and fails for others. Investigation reveals AWS WAF is inspecting full bodies via a managed rule. Inspection happens after the response is generated, which forces buffering.
**Prevention:** Bound WAF body inspection by size (8 KB default). For streaming endpoints, exempt the path from body inspection or use a streaming-aware WAF mode.

### Lambda timeout shorter than the answer length

The Lambda hits its own timeout (set in function config) before generating the full response. The function dies mid-stream. Different from gateway buffering: here the gateway never receives a complete response.
**Prevention:** Set the Lambda timeout to at least 60 seconds for chat workloads (up to the maximum 15 minutes). Match it to the integration timeout.

### Client library buffers the response

API Gateway is streaming correctly (Transfer-Encoding: chunked in response headers), but the iOS client uses URLSession in a default mode that buffers responses. Same symptom on the client side; root cause is client-side.
**Prevention:** On iOS, use URLSessionDataDelegate to receive bytes as they arrive. On the web, use the Fetch API's ReadableStream. Test the client end of the pipeline as deliberately as the server end.

## SOP Best Practices

- When choosing the public entry point for a streaming workload, walk the option matrix: Lambda Function URL with RESPONSE_STREAM is the simplest; API Gateway HTTP API has limited streaming support; API Gateway REST API requires explicit STREAM mode; ALB streams natively. Pick the simplest option that meets auth and throttling needs.
- Treat responseTransferMode as a load-bearing config. The default BUFFERED is wrong for streaming workloads, and the signal it produces (504 at exactly 29 seconds) is easy to misread as a Lambda timeout.
- Match the integration timeout to the workload. For LLM streaming, set the integration timeout to at least 60 seconds. STREAM mode supports up to 15 minutes. Always pair this with a matching Lambda timeout.
- Test streaming end to end including the client library. Browser EventSource, Fetch ReadableStream, iOS URLSession, Android OkHttp all have buffering modes that can hide a working server-side stream behind a client-side blob.

## Learning Objectives

1. **API Gateway response modes**: Articulate the BUFFERED-vs-STREAM tradeoff and when each applies.
2. **Lambda response streaming**: Know awslambda.streamifyResponse, InvokeWithResponseStream, and the three invocation paths (direct SDK, Function URL, API Gateway).
3. **Migration awareness**: Recognize that a load balancer and an API gateway are not interchangeable for streaming workloads, even though they look similar at the route level.
4. **The 29-second signal**: Read 504 at exactly 29 seconds as a buffering signal, not a Lambda problem.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
