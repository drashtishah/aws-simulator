---
tags:
  - type/resolution
  - service/sqs
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# Resolution: The Queue Nobody Watched

## Root Cause

The SQS standard queue `canopy-order-queue` had a visibility timeout of 30 seconds (the default, never modified). The Lambda function `canopy-process-order` had a timeout of 90 seconds and required 60-90 seconds to process large orders (20+ items). When the Lambda execution exceeded 30 seconds, SQS assumed the message was not being processed and made it visible again. A second Lambda invocation received the same message and began processing the same order. Both invocations completed successfully, resulting in duplicate Stripe charges, duplicate delivery slot reservations, and inventory counts going negative. No dead-letter queue was configured, and the Lambda function had no idempotency check.

## Timeline

| Time | Event |
|---|---|
| 2026-03-25 (8 months prior) | `canopy-order-queue` created with default configuration. Visibility timeout: 30 seconds. No dead-letter queue. |
| 2026-03-25 (8 months prior) | `canopy-process-order` Lambda deployed with 90-second timeout. Event source mapping to SQS queue, batch size 1. |
| 2026-03-25 (ongoing) | Normal operation. Orders average 5-8 items. Lambda completes in 7-9 seconds. No duplicate processing observed. |
| 2026-03-24 | Marketing runs promotional campaign: 20% off orders over $50. Larger-than-usual baskets begin arriving. |
| 2026-03-26 06:30 UTC | First large orders from the campaign hit the queue. Lambda executions begin exceeding 30 seconds. SQS redelivers messages while Lambda is still processing them. |
| 2026-03-26 07:42 UTC | First customer support email: duplicate charge for order ORD-7901, $67.40 charged twice. |
| 2026-03-26 08:15 UTC | Eleven duplicate charge reports received. Co-founder observes Lambda concurrent execution spike in CloudWatch. |
| 2026-03-26 08:15 UTC | Investigation begins. Root cause identified: visibility timeout (30s) shorter than Lambda processing time for large orders (60-90s). |
| 2026-03-26 08:45 UTC | Visibility timeout increased to 540 seconds. Dead-letter queue configured. Idempotency check added to Lambda function. |
| 2026-03-26 09:00 UTC | Duplicate processing stops. Refund process begins for affected customers. |

## Correct Remediation

1. **Increase the visibility timeout so messages stay hidden long enough for the function to finish**. The visibility timeout controls how long a message is hidden from other consumers after being picked up. If the function has not finished processing before this timeout expires, SQS assumes the message was lost and makes it available again -- which is what caused the duplicate processing. AWS recommends setting the visibility timeout to at least 6 times the Lambda function timeout. With a 90-second Lambda timeout, the minimum is 540 seconds:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/canopy-order-queue \
  --attributes '{"VisibilityTimeout": "540"}'
```

2. **Create a dead-letter queue (DLQ) to catch messages that keep failing**. A dead-letter queue is a separate queue where messages land after failing processing a set number of times (controlled by maxReceiveCount). Instead of retrying forever and wasting resources, the failed message is moved aside for a human to investigate:

```bash
aws sqs create-queue \
  --queue-name canopy-order-queue-dlq

aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/canopy-order-queue \
  --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:123456789012:canopy-order-queue-dlq\",\"maxReceiveCount\":\"3\"}"}'
```

With this configuration, a message that fails 3 times moves to the DLQ instead of retrying forever.

3. **Add duplicate-detection logic (idempotency) to the Lambda function**. Before charging the customer or updating inventory, query DynamoDB for the order ID. If the order has already been processed (status is `COMPLETED`), log a duplicate detection event and return success without doing anything. This makes the function safe to run multiple times on the same message, regardless of whether SQS delivers it once or twice.

4. **Set up an alert for the dead-letter queue**. Any message landing in the DLQ means something went wrong. Create a CloudWatch alarm that fires when the DLQ has any messages waiting:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name canopy-dlq-messages \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --dimensions Name=QueueName,Value=canopy-order-queue-dlq \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:canopy-alerts
```

5. **Refund affected customers**. Find all duplicate charges by querying Stripe for orders with two successful charges on the same order ID. Issue refunds for the duplicate transactions.

## Key Concepts

### The visibility timeout: how SQS decides when to redeliver a message

When a worker picks up a message from an SQS queue, SQS hides that message from all other workers for a period called the visibility timeout. This gives the worker time to finish processing and delete the message. If the worker does not delete the message before the timeout expires, SQS assumes something went wrong and makes the message visible again so another worker can try. The default visibility timeout is 30 seconds.

When using Lambda as the worker (connected via an event source mapping), AWS recommends setting the visibility timeout to at least 6 times the Lambda function timeout. This provides a wide margin to account for the function execution, any internal retries by the Lambda service, and processing variability.

### Dead-letter queues: a safety net for messages that keep failing

A dead-letter queue (DLQ) is a separate queue that catches messages which fail processing too many times. You configure a redrive policy on the main queue with a `maxReceiveCount` -- say, 3 -- meaning that after a message has been picked up and not successfully processed 3 times, SQS automatically moves it to the DLQ. Without a DLQ, failed messages stay in the main queue forever, getting retried endlessly, consuming Lambda capacity, and potentially causing the same error over and over. The DLQ gives engineers a place to inspect failures, figure out what went wrong, and either replay the messages after fixing the issue or discard them.

### Why your message consumer must handle duplicates (idempotency)

SQS standard queues guarantee "at-least-once delivery." This means every message will be delivered at least once, but the same message might be delivered more than once -- even when the visibility timeout is configured correctly. This is a fundamental property of the queue, not a bug. Because of this, every consumer of an SQS standard queue must be idempotent, meaning that processing the same message twice produces the same result as processing it once.

For example, before charging a customer, you check whether the order has already been charged. Common strategies include: looking up the order ID in a database before executing side effects, using conditional writes that only succeed if the record does not already exist, or using an idempotency library that tracks which requests have already been handled.

## Other Ways This Could Break

### Lambda times out before finishing, causing failed orders

In this sim, the Lambda function had enough time to finish its work (90-second timeout). The problem was that the queue's visibility timeout (30 seconds) expired first, making the message available to a second function copy. A different failure happens if the Lambda timeout is set too short -- say, 30 seconds when the function needs 60. In that case, AWS kills the function mid-execution before it finishes charging the customer or updating inventory. The message returns to the queue and eventually lands in a dead-letter queue (if one exists). The symptom is failed orders and a growing DLQ, not duplicate charges. The key distinction: in this sim, the function completed its work fine -- SQS just did not know it was still working.

### Using a FIFO queue causes a throughput bottleneck

A FIFO (first-in, first-out) queue guarantees each message is processed exactly once and in order. If Canopy had used a FIFO queue, the double-charge problem would not have happened. However, FIFO queues process messages in groups. If every order shared the same group ID, throughput would be capped at 300 messages per second for that group. During a promotional campaign with high order volume, this would cause orders to pile up in the queue and processing would fall behind. The fix is to use different group IDs (for example, per customer or per region) so orders in different groups can be processed in parallel.

### A broken message retries forever because there is no dead-letter queue

A "poison-pill" message is one with bad data that always causes the function to crash -- for example, an order with a malformed payload. Without a dead-letter queue, SQS retries this message indefinitely. Each retry wastes a Lambda invocation, the message never leaves the queue, and other legitimate orders get stuck waiting behind it. Over time, the oldest message in the queue gets older and older (shown by the ApproximateAgeOfOldestMessage metric). In this sim, messages were not failing -- they were succeeding twice. But the absence of a DLQ meant there was no safety net for either scenario.

### Lambda concurrency limit causes orders to wait in the queue

If the Lambda function is limited to, say, 5 simultaneous copies (a setting called reserved concurrency) but the queue has 50 messages waiting during a promotional campaign, AWS throttles the function and SQS slows down its polling. Messages sit in the queue longer, but each one is still processed only once (assuming the visibility timeout is correct). The symptom is slow order processing and spikes in the Lambda Throttles metric, not duplicate charges. The fix is to set reserved concurrency proportional to expected order volume and monitor the Throttles metric.

## SOP Best Practices

- Always set the SQS visibility timeout to at least 6 times the Lambda function timeout when they are connected via an event source mapping. This ratio is what AWS recommends. For a 90-second Lambda timeout, the minimum visibility timeout is 540 seconds. This ensures the message stays hidden long enough for the function to finish, even if it runs slowly or retries internally.
- Set up a dead-letter queue on every production SQS queue. Set maxReceiveCount (the number of failed attempts before moving the message aside) between 3 and 5. Make the DLQ retention period longer than the main queue's retention period so messages are not deleted before an engineer can inspect them.
- Add a CloudWatch alarm on the DLQ's ApproximateNumberOfMessagesVisible metric with a threshold of 1. Any message in the DLQ means something went wrong with processing and needs investigation.
- Design every message consumer to be idempotent -- meaning processing the same message twice produces the same result as processing it once. Before performing side effects like charging a customer, updating inventory, or reserving a delivery slot, check whether the operation was already completed using a unique identifier like the order ID. SQS standard queues guarantee at-least-once delivery, so duplicates can occur even with a correctly configured visibility timeout.
- Monitor the ratio of messages received to messages sent in CloudWatch. Under normal operation, each message should be picked up approximately once (a 1:1 ratio). A sustained ratio above 1 means messages are being redelivered, which signals either a visibility timeout that is too short or repeated processing failures.

## Learning Objectives

1. **Visibility timeout sizing**: Understand that SQS visibility timeout must be at least 6 times the consumer's processing time to prevent duplicate delivery, and that the default 30-second timeout is rarely appropriate for Lambda consumers with non-trivial workloads
2. **Dead-letter queue necessity**: Recognize that without a DLQ, failed messages retry indefinitely in the source queue, consuming resources and generating repeated errors with no visibility into the failure
3. **Idempotency as a requirement**: Learn that SQS standard queues provide at-least-once delivery, making consumer idempotency a design requirement rather than an optimization -- especially for side effects like payment processing

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
- [[catalog]] -- sqs, lambda, cloudwatch service entries
