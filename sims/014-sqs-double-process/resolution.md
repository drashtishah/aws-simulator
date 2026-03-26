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

1. **Increase SQS visibility timeout**:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/canopy-order-queue \
  --attributes '{"VisibilityTimeout": "540"}'
```

AWS recommends setting the visibility timeout to at least 6 times the Lambda function timeout. With a 90-second Lambda timeout, the minimum recommended visibility timeout is 540 seconds.

2. **Create a dead-letter queue and configure redrive policy**:

```bash
aws sqs create-queue \
  --queue-name canopy-order-queue-dlq

aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/canopy-order-queue \
  --attributes '{"RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:123456789012:canopy-order-queue-dlq\",\"maxReceiveCount\":\"3\"}"}'
```

Messages that fail processing after 3 attempts are moved to the DLQ instead of retrying indefinitely.

3. **Add idempotency check to Lambda function**: Before processing, query DynamoDB for the order ID. If the order has already been charged (status is `COMPLETED`), log a duplicate detection event and return success without reprocessing. This makes the consumer idempotent regardless of SQS delivery guarantees.

4. **Configure CloudWatch alarms**:

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

5. **Process refunds**: Identify all duplicate charges by querying Stripe for orders with two successful charges on the same order ID. Issue refunds for the duplicate transactions.

## Key Concepts

### SQS Visibility Timeout

When a consumer receives a message from an SQS queue, the message becomes invisible to other consumers for the duration of the visibility timeout. If the consumer does not delete the message before the timeout expires, the message becomes visible again and can be received by another consumer. The default visibility timeout is 30 seconds. For Lambda event source mappings, AWS recommends setting the visibility timeout to at least 6 times the function timeout. This accounts for the function execution time plus potential retries by the Lambda service.

### Dead-Letter Queues

A dead-letter queue (DLQ) receives messages that could not be processed successfully after a specified number of attempts (`maxReceiveCount`). Without a DLQ, failed messages remain in the source queue and are retried indefinitely, consuming Lambda concurrency and potentially causing the same errors repeatedly. The DLQ acts as a holding area where engineers can inspect failed messages, diagnose the failure, and either fix the issue and replay the messages or discard them.

### Idempotency in Distributed Systems

SQS standard queues guarantee at-least-once delivery. This means a message may be delivered more than once even when the visibility timeout is configured correctly. Any consumer of an SQS standard queue must be idempotent -- processing the same message twice must produce the same result as processing it once. Common idempotency strategies include: using a unique identifier (order ID) to check for prior processing before executing side effects, storing processing state in a database with conditional writes, or using an idempotency library that tracks request IDs.

## Other Ways This Could Break

### Lambda timeout shorter than processing time

If the Lambda timeout were set below the actual processing duration (say, 30 seconds instead of 90), the function would be killed mid-execution before completing the Stripe charge or inventory update. The message would return to the queue and eventually land in a DLQ (if one existed). The symptom would be failed orders and growing DLQ depth, not duplicate charges. The distinction matters: in this sim, the Lambda had enough time to finish, but SQS did not know that.

### FIFO queue throttling from message group ID contention

A FIFO queue guarantees exactly-once processing and strict ordering within a message group. If Canopy had used a FIFO queue, the double-charge problem would not have occurred. However, if every order shared a single message group ID, throughput would be capped at 300 transactions per second per group. The symptom would be rising queue depth and delivery latency during high-traffic periods like the promotional campaign. The fix is to assign distinct group IDs per customer or per region to allow parallel processing across groups.

### Poison-pill messages without a dead-letter queue

A poison-pill message is one that always fails processing -- for example, an order with a malformed payload that causes the Lambda to throw an unhandled exception. Without a DLQ, SQS retries the message indefinitely. Each retry consumes a Lambda invocation and the message never leaves the queue. Over time, ApproximateAgeOfOldestMessage climbs, Lambda concurrency is wasted on repeated failures, and legitimate messages back up behind the poison pill. In this sim, messages were not failing -- they were succeeding twice. But the absence of a DLQ meant there was no safety net for either scenario.

### Lambda reserved concurrency too low for queue throughput

If the Lambda function had a reserved concurrency of 5 but the queue contained 50 pending messages during the promotional campaign, the Lambda service would throttle invocations. SQS would back off polling and messages would sit in the queue longer, but each message would still be processed only once (assuming the visibility timeout was correct). The symptom would be increased order processing latency and spikes in the Lambda Throttles metric, not duplicate charges.

## SOP Best Practices

- Always set the SQS visibility timeout to at least 6 times the consumer function timeout when using Lambda event source mappings. This is the ratio AWS recommends in its documentation. For a 90-second Lambda timeout, the minimum visibility timeout is 540 seconds.
- Configure a dead-letter queue on every production SQS queue. Set maxReceiveCount between 3 and 5. Set the DLQ retention period longer than the source queue retention period so messages are not lost before inspection.
- Add a CloudWatch alarm on the DLQ ApproximateNumberOfMessagesVisible metric with a threshold of 1. Any message landing in the DLQ indicates a processing failure that requires investigation.
- Design every SQS consumer to be idempotent. Use a unique identifier from the message (order ID, transaction ID) to check whether the operation has already been performed before executing side effects like charges, inventory decrements, or slot reservations. SQS standard queues guarantee at-least-once delivery, meaning duplicates can occur even with a correctly configured visibility timeout.
- Monitor the ratio of NumberOfMessagesReceived to NumberOfMessagesSent in CloudWatch. Under normal operation the ratio is approximately 1:1. A sustained ratio above 1 indicates message redelivery, which signals either a visibility timeout problem or repeated processing failures.

## Learning Objectives

1. **Visibility timeout sizing**: Understand that SQS visibility timeout must be at least 6 times the consumer's processing time to prevent duplicate delivery, and that the default 30-second timeout is rarely appropriate for Lambda consumers with non-trivial workloads
2. **Dead-letter queue necessity**: Recognize that without a DLQ, failed messages retry indefinitely in the source queue, consuming resources and generating repeated errors with no visibility into the failure
3. **Idempotency as a requirement**: Learn that SQS standard queues provide at-least-once delivery, making consumer idempotency a design requirement rather than an optimization -- especially for side effects like payment processing

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
- [[catalog]] -- sqs, lambda, cloudwatch service entries
