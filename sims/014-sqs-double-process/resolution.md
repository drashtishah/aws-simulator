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

## AWS Documentation Links

- [Amazon SQS Visibility Timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Amazon SQS Dead-Letter Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Lambda Function Configuration - Timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html)
- [Idempotency in Serverless Architectures](https://docs.aws.amazon.com/prescriptive-guidance/latest/lambda-event-filtering-partial-batch-responses-for-sqs/idempotency.html)

## Learning Objectives

1. **Visibility timeout sizing**: Understand that SQS visibility timeout must be at least 6 times the consumer's processing time to prevent duplicate delivery, and that the default 30-second timeout is rarely appropriate for Lambda consumers with non-trivial workloads
2. **Dead-letter queue necessity**: Recognize that without a DLQ, failed messages retry indefinitely in the source queue, consuming resources and generating repeated errors with no visibility into the failure
3. **Idempotency as a requirement**: Learn that SQS standard queues provide at-least-once delivery, making consumer idempotency a design requirement rather than an optimization -- especially for side effects like payment processing

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development with AWS Services
- [[catalog]] -- sqs, lambda, cloudwatch service entries
