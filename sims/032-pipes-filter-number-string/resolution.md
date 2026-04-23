---
tags:
  - type/resolution
  - service/eventbridge-pipes
  - service/sqs
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# Resolution: The Pipe That Said No to Everything

## Root Cause

The EventBridge Pipes filter pattern on `saltmarsh-fulfillment-pipe` uses a numeric comparison on a field that the producer emits as a string. The filter reads:

```json
{
  "body": {
    "status": ["paid"],
    "amount": [{ "numeric": [">", 0] }]
  }
}
```

The Checkout service emits OrderPlaced events with `"amount": "49.99"`, a JSON string (a legacy decision baked into the checkout schema several years ago). EventBridge content filters are strictly typed. A `numeric` operator matches only against JSON numbers. A string value, even one that happens to represent a number, fails the match.

Every event is therefore rejected by the filter and silently dropped. Filter rejection is a normal outcome for a pipe, not a failure, so no DLQ entry is created, no target Lambda is invoked, and no error metric increments. The only visible signal is the `AWS/Pipes` metric `FilteredEvents`, which matches the incoming rate, and the target Lambda's `Invocations` metric, which is flat at zero.

## Timeline

| Time | Event |
|---|---|
| Tue 18:30 | CloudFormation deploy cuts saltmarsh-fulfillment-pipe over from the legacy Lambda-polls-SQS pipeline to EventBridge Pipes |
| Tue 18:34 | Cutover validation: engineer sends one test event through via aws pipes start-pipe, sees the Lambda invoked, declares success. (The test event uses `"amount": 10` because that is what the engineer happened to type.) |
| Tue 19:02 | First real OrderPlaced event arrives; Pipes rejects it silently |
| Wed 09:12 | 3PL warehouse starts shift, notices no pick tickets queued |
| Wed 11:42 | 3PL warehouse manager calls Platform oncall |
| Wed 11:57 | FilteredEvents metric examined, reveals 640 events filtered since Tuesday evening |
| Wed 12:03 | Sample message pulled from SQS, reveals amount as a string |
| Wed 12:09 | Pipes filter updated via CloudFormation to expect string amount |
| Wed 12:12 | First post-fix event matches filter; fulfill-order Lambda runs |
| Wed 12:40 | Backfill Lambda emits replacement events for the 640 lost orders; all processed |
| Wed 13:55 | 3PL confirms all 640 pick tickets in hand before the 14:00 cutoff |

## Correct Remediation

1. **Trace backward from the missing side effect.** The business symptom is "no pick tickets at the 3PL". The last thing that writes a pick ticket is the fulfill-order Lambda. Start there.
2. **Confirm the target is not firing.** Check the fulfill-order Lambda's Invocations metric in CloudWatch. If it is zero while upstream activity is nonzero, the target is not being reached. This narrows the investigation to the pipe or its source.
3. **Confirm the source has messages.** Look at the saltmarsh-new-orders queue's ApproximateNumberOfMessages and ApproximateAgeOfOldestMessage. Messages arriving and not being consumed indicates the pipe is not delivering. Messages arriving and being consumed (but queue emptying) combined with zero target invocations indicates the pipe is filtering.
4. **Check the pipe metrics.** Look at `AWS/Pipes` metrics for the pipe: `EventsProcessed`, `FilteredEvents`, `TargetInvoked`, `TargetInvocationsFailed`. A pattern of high FilteredEvents and zero EventsProcessed is the diagnosis for this sim.
5. **Compare the filter pattern to a real message.** Pull one message out of the SQS queue (use `aws sqs receive-message` with a long visibility timeout). Open the Pipes filter config. Read them side by side. Pay attention to JSON types: `numeric` requires a JSON number, `prefix`/`suffix` require strings, `exists` ignores type.
6. **Fix the filter.** Two options:
   - Change the filter to match the string form: `{"body": {"status": ["paid"], "amount": [{"anything-but": [""]}]}}`. This is the right move if the producer cannot easily change schema.
   - Change the producer to emit the amount as a number. This is the cleaner long-term fix, but is a broader schema change that affects every consumer of the event.
   In this sim, fix the filter first (to stop the bleeding), then schedule the producer schema cleanup as follow-up work.
7. **Drain the lost backlog.** Pipes has already deleted the filter-rejected messages from the SQS queue. To replay, run a one-time backfill Lambda that queries Stripe for the missing window's captures and emits a replacement OrderPlaced event per missing order into the queue.
8. **Add alarms.** Create a CloudWatch alarm on the ratio `FilteredEvents / (FilteredEvents + EventsProcessed)` that fires when the ratio exceeds 50 percent for 3 consecutive data points. Add a second alarm on the target Lambda's `Invocations` metric using anomaly detection, so a sudden drop to zero when the function historically runs regularly is caught quickly.
9. **Add contract tests.** Write an integration test that replays a captured production OrderPlaced event through the pipe and asserts the filter decision (match). Run it in CI on every change to either the producer schema or the pipe filter.

## Key Concepts

### EventBridge Pipes and Its Stages

EventBridge Pipes is a point-to-point integration service: one source connects to one target, with optional stages in between. The stages, in order, are:

- **Source**: SQS, Kinesis, DynamoDB streams, Kafka (MSK, self-managed, MSK Serverless), or Amazon MQ.
- **Filter**: a JSON pattern that matches events. Non-matching events are dropped silently.
- **Enrichment**: an optional Lambda, Step Functions express workflow, API Destination, or API Gateway call that augments the event payload before it reaches the target.
- **Target**: a Lambda function, Step Functions workflow, SQS queue, SNS topic, EventBridge bus, or an API Destination.

Pipes replaces a common pattern: writing a Lambda whose only job is to poll a queue and forward to something else. The downside is that the filter stage has subtle behaviors that are easy to miss.

### Content Filtering and Strict Typing

EventBridge filter patterns look like a superset of the event itself. Each leaf in the pattern is an array of matchers, and an event matches only if every leaf matches. The matchers include exact values, `prefix`, `suffix`, `anything-but`, `numeric`, `exists`, `cidr`, and others.

The critical property for this sim is that `numeric` matchers require the event's value to be a JSON number. If the value is a string (`"49.99"`), the match is false, even though a human would read the string as a number. This is a deliberate design decision: content filtering is meant to be predictable and cheap, so the filter engine does not coerce types.

If you need to match a stringly-typed numeric field:

- Change the producer to emit a JSON number (best).
- Use a string-based matcher, such as `{"anything-but": [""]}` combined with an application-layer business-rule check inside the target.
- Pre-transform with a Pipes source transformer to parse the string into a number before the filter runs.

### Silent Drop Semantics

Pipes treats a filter-rejected event as a successful outcome. The message is deleted from the source (for SQS), the `FilteredEvents` metric is incremented, and no other action is taken. There is no log line, no DLQ entry, and no error metric. This is consistent behavior: filtering is the point, and filter-matches do not retry.

The consequence is that a broken filter is invisible unless you are watching the FilteredEvents metric. A broken target, by contrast, is loudly visible: retries, DLQ entries, and target error metrics all fire. The lesson is that every pipe needs an alarm on filter behavior, not just target behavior.

## Other Ways This Could Break

### A source transformer removes or renames fields before the filter
The filter and the message look consistent, but a transformer runs first and reshapes the event. The filter sees a different object. You have to read the source transformer alongside the filter.
**Prevention:** Avoid unnecessary source transformers. When you use one, add a CI test that feeds a known event through the transformer and asserts the shape matches the filter pattern.

### The Pipe IAM role cannot invoke the target
FilteredEvents is low, EventsProcessed is low, TargetInvocationsFailed is high. The target Lambda shows zero invocations because it is never reached. Pipes retries and, if a DLQ is configured, lands the event there.
**Prevention:** Generate the Pipes execution role from the AWS-managed template when you create the pipe. If you author a custom role, grant exactly `lambda:InvokeFunction` on the target ARN.

### Target Lambda reserved concurrency set to zero
The filter matches and the pipe invokes the target, but every invocation is throttled. Invocations metric is high, Throttles metric is high, DLQ accumulates after retries. The customer impact looks similar but the signal path is completely different.
**Prevention:** Alarm on Lambda ThrottledInvocations as well as Pipes TargetInvocationsFailed. Treat setting reserved concurrency to zero with the same rollout discipline as a production deploy.

## SOP Best Practices

- Always configure a Pipes DLQ. It does not catch filter rejections, but it does catch target invocation failures, which is still the largest class of problem in most pipes.
- Alarm on the ratio of FilteredEvents to EventsProcessed. Cover both directions if your filter encodes a business rule, because too little filtering can be as dangerous as too much.
- Treat a Pipes filter and its producer schema as a contract. Test the contract in CI by replaying captured production events through the filter and asserting the decision.
- Prefer strict schema validation at the producer over clever filtering at the pipe. A filter that pattern-matches around producer sloppiness will fail silently the first time the producer sends something unexpected.

## Learning Objectives

1. **EventBridge Pipes architecture:** Understand the source-filter-enrichment-target model and where failures surface at each stage.
2. **Filter type strictness:** Know that numeric patterns require JSON numbers and will silently reject strings.
3. **Silent-drop semantics:** Recognize that filter rejection is a successful pipe outcome with no DLQ, no error, and only a CloudWatch metric signal.
4. **Observability discipline:** Set alarms on the FilteredEvents/EventsProcessed ratio and on target invocation count dropping to zero.
5. **Contract-first integration:** Treat filter patterns as part of the producer-consumer schema contract and test them in CI.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[learning/catalog.csv]] -- Player service catalog and progress
