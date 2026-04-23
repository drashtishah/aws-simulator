---
tags:
  - type/simulation
  - service/eventbridge-pipes
  - service/sqs
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# The Pipe That Said No to Everything

## Opening

- company: Saltmarsh Supply
- industry: B2B wholesale grocery
- product: wholesale ordering platform for independent grocers; customers place restock orders overnight, a 3PL fulfills them by noon the next day
- scale: Series A, 38 engineers, ~2,100 orders per business day, 90 percent originating between 6 PM and 2 AM
- time: Wednesday 11:42, mid-morning after the first full day on the new EventBridge Pipes pipeline
- scene: Platform on-call Slack channel. The 3PL warehouse manager has just called asking why there are no pick tickets for today. Checkout team reports Stripe is accepting payments normally.
- alert: no PagerDuty alert has fired. CloudWatch shows the fulfill-order Lambda healthy with zero invocations and zero errors. The SQS queue has no backlog alarm configured.
- stakes: 640 paid orders are stuck with no downstream action since 09:12 AM. The 3PL's daily cutoff for same-day dispatch is 14:00. If the queue is not drained by then, every one of those orders ships a day late, triggering SLA credits worth approximately $14,000 and a wave of customer communications.
- early_signals: 3PL warehouse reports no pick tickets since the morning; SQS ApproximateNumberOfMessages at 640; fulfill-order Lambda invocation count flat at zero; no target errors anywhere
- investigation_starting_point: The migration from a Lambda-polls-SQS pattern to a new EventBridge Pipe was deployed Tuesday evening. You have full access to the pipe config, SQS queue, Lambda console, CloudWatch metrics, and a sample of the messages currently in the queue.

## Resolution

- root_cause: The EventBridge Pipes filter on saltmarsh-fulfillment-pipe uses a numeric comparison against the amount field: {"body":{"status":["paid"],"amount":[{"numeric":[">",0]}]}}. The checkout service emits the amount as a JSON string, not a number ("amount": "49.99"). EventBridge content filters are strictly typed. A numeric operator requires a JSON number. Every event fails the filter, and Pipes drops filtered-out events silently. There is no DLQ entry, no Lambda invocation, and no error anywhere to catch.
- mechanism: Checkout succeeds and writes the full OrderPlaced event to the SQS queue. Pipes polls the queue, fetches a batch of up to 10 messages, applies the filter pattern to each. The numeric comparison on the string value "49.99" evaluates to false. The status check for "paid" succeeds independently, but both conditions must match so the overall pattern is false. Pipes increments the FilteredEvents CloudWatch metric and deletes the message from the queue because it has been successfully filtered (which is considered a successful outcome for the pipe). The target Lambda is never invoked. No DLQ entry is created because filter rejections are not target failures. The only observable symptom is the business-level one: 3PL gets no pick tickets.
- fix: The Pipes filter is updated to expect a string amount: {"body":{"status":["paid"],"amount":[{"anything-but":[""]}]}}. Deployed via CloudFormation. Within 30 seconds of the update, messages arriving in the queue begin matching the filter. The existing backlog was already deleted by Pipes, so a one-time backfill Lambda is run against the orders Stripe captured that morning to emit replacement events into the same queue. The 3PL receives the full 640 backlog's worth of pick tickets by 12:40, in time for the 14:00 cutoff.
- contributing_factors: The Pipes filter was authored against a proposed target schema (amount as number) rather than the actual producer schema (amount as string) that was documented in the checkout service's code. There was no end-to-end integration test that replayed a real production message against the new pipe before cutover. Pipes deleted filtered messages from the queue rather than leaving them as a visible backlog, which made the problem invisible on the SQS console. There was no CloudWatch alarm on FilteredEvents rate or on the target Lambda's Invocations metric dropping to zero. The Lambda dashboard showed a healthy zero-error green state, which is misleading when invocation count is also zero.
