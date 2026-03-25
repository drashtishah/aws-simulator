---
tags:
  - type/resolution
  - service/sns
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/operations
---

# Resolution: A Notification for No One

## Root Cause

The CloudWatch alarm `clarabridge-ingest-error-rate` fired correctly at 10:07 AM UTC on 2026-03-26 when the Lambda function `clarabridge-ingest-processor` exceeded the 5% error rate threshold. The alarm action published to SNS topic `arn:aws:sns:us-east-1:111222333444:clarabridge-ops-alerts`. The publish succeeded. All three subscriptions on the topic failed to deliver:

1. **Email** (`ops-team@clarabridge.io`): Status PendingConfirmation. Created 2026-03-05 when the team migrated from the old individual email. The AWS confirmation email landed in the shared inbox's spam folder. SNS silently skips delivery to unconfirmed subscriptions.
2. **Lambda** (`clarabridge-slack-notifier`): Status Confirmed. SNS invoked the function successfully, but the function itself failed. The Slack webhook URL in the `SLACK_WEBHOOK_URL` environment variable was rotated by the Slack workspace admin on 2026-03-18. Every POST returns 403 Forbidden. No dead-letter queue was configured on the Lambda function.
3. **SMS** (`+1-512-555-0147`): Status Confirmed. SNS attempted delivery but the account SMS spending limit ($1.00 default) was already exhausted for the month after a noisy alarm on 2026-03-19. SMS delivery silently fails when the spending limit is reached.

Zero humans were notified. The team learned about the outage from a customer tweet at 10:52 AM, forty-five minutes after the alarm fired.

## Timeline

| Time | Event |
|---|---|
| 2026-03-05 09:14 UTC | Ops lead creates new email subscription for ops-team@clarabridge.io on SNS topic clarabridge-ops-alerts. Deletes old subscription for ops-lead@clarabridge.io. |
| 2026-03-05 09:14 UTC | AWS sends subscription confirmation email to ops-team@clarabridge.io. Email lands in spam folder. Never opened. |
| 2026-03-18 14:30 UTC | Slack workspace admin rotates all incoming webhook URLs as part of security audit. Does not notify engineering. |
| 2026-03-19 16:00 UTC | Noisy deployment alarm fires repeatedly, sending 23 SMS messages. Account SMS spending limit ($1.00 default) exhausted for March. |
| 2026-03-26 10:07 UTC | Lambda function clarabridge-ingest-processor begins failing due to DynamoDB ProvisionedThroughputExceededException. Error rate crosses 5%. CloudWatch alarm transitions to ALARM state. |
| 2026-03-26 10:07 UTC | CloudWatch publishes alarm notification to SNS topic. Publish succeeds. |
| 2026-03-26 10:07 UTC | SNS skips email delivery (PendingConfirmation). Invokes Slack Lambda (returns error, 403 from Slack). Attempts SMS (silently fails, spending limit reached). NumberOfNotificationsFailed: 3. NumberOfNotificationsDelivered: 0. |
| 2026-03-26 10:52 UTC | Customer tweets about stale dashboard data. Ops lead sees it on his phone during standup. |
| 2026-03-26 10:55 UTC | Team begins investigating. Discovers alarm has been in ALARM state for 48 minutes. |

## Correct Remediation

1. **Confirm the email subscription**: Find the original confirmation email in the spam folder of ops-team@clarabridge.io and click the confirmation link. If the link has expired, delete the subscription and create a new one:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:111222333444:clarabridge-ops-alerts \
  --protocol email \
  --notification-endpoint ops-team@clarabridge.io
```

Then immediately confirm by clicking the link in the new email.

2. **Update the Slack webhook URL**: Update the Lambda function environment variable with the new webhook URL:

```bash
aws lambda update-function-configuration \
  --function-name clarabridge-slack-notifier \
  --environment "Variables={SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX}"
```

3. **Increase the SMS spending limit**: Request an increase from the default $1.00 limit via the SNS console or AWS Support. Set it to a value that accommodates normal alert volume with headroom:

```bash
aws sns set-sms-attributes \
  --attributes '{"MonthlySpendLimit": "50"}'
```

4. **Add a dead-letter queue to the Slack Lambda**: Configure a DLQ so failed invocations are captured:

```bash
aws lambda update-function-configuration \
  --function-name clarabridge-slack-notifier \
  --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:111222333444:slack-notifier-dlq
```

5. **Monitor the notification pipeline itself**: Create a CloudWatch alarm on the SNS metric `NumberOfNotificationsFailed` for the topic. Route this alarm to a different, verified notification path (e.g., a PagerDuty integration or a separate confirmed email):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name clarabridge-sns-delivery-failures \
  --namespace AWS/SNS \
  --metric-name NumberOfNotificationsFailed \
  --dimensions Name=TopicName,Value=clarabridge-ops-alerts \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:111222333444:clarabridge-ops-escalation
```

6. **Verify all subscription statuses**: Run a periodic check (weekly cron or Config rule) that lists all subscriptions on critical topics and alerts if any are in PendingConfirmation status.

## Key Concepts

### SNS Subscription Lifecycle

When you create an SNS subscription for the email or SMS protocol, SNS sends a confirmation message to the endpoint. The subscription remains in `PendingConfirmation` status until the recipient clicks the confirmation link or replies to the SMS. Unconfirmed subscriptions remain on the topic for three days, then are automatically deleted. However, if the subscription was created via the AWS console or API (not via CloudFormation), it persists in PendingConfirmation status indefinitely in some cases. Messages published to the topic are silently not delivered to pending subscriptions. There is no error, no metric increment, and no log entry for the skipped delivery.

### SNS SMS Spending Limits

Every AWS account has a default SMS spending limit of $1.00 per month for SNS. Once the spending limit is reached, SNS stops sending SMS messages for the remainder of the month. There is no notification when the limit is reached. Delivery simply stops. The `NumberOfNotificationsFailed` metric increments, but only if you are monitoring it. The spending limit can be increased by setting the `MonthlySpendLimit` account attribute or by requesting a limit increase through AWS Support for amounts above the self-service threshold.

### Notification Pipeline Observability

A notification pipeline that is not itself monitored is a single point of failure. SNS publishes delivery metrics to CloudWatch: `NumberOfMessagesPublished`, `NumberOfNotificationsDelivered`, `NumberOfNotificationsFailed`, and `NumberOfNotificationsFilteredOut`. An alarm on `NumberOfNotificationsFailed` routed to a separate, verified path (different topic, different protocol, different team) creates a feedback loop that detects delivery failures. Without this, a broken notification pipeline fails silently -- which is precisely what happened here.

## AWS Documentation Links

- [SNS Subscription Confirmation](https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.confirm.html)
- [SNS SMS Preferences and Spending Limits](https://docs.aws.amazon.com/sns/latest/dg/sms_preferences.html)
- [SNS Delivery Status Logging](https://docs.aws.amazon.com/sns/latest/dg/sns-topic-attributes.html)
- [SNS CloudWatch Metrics](https://docs.aws.amazon.com/sns/latest/dg/sns-monitoring-using-cloudwatch.html)
- [Lambda Dead-Letter Queues](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html#invocation-dlq)

## Learning Objectives

1. **Subscription lifecycle awareness**: Understand that SNS email subscriptions require explicit confirmation and that PendingConfirmation subscriptions silently drop all messages with no error feedback
2. **SMS spending limit**: Recognize that the default $1.00/month SNS SMS spending limit silently stops delivery when exhausted, with no built-in notification
3. **Notification pipeline observability**: Learn to monitor the notification pipeline itself using SNS delivery metrics (NumberOfNotificationsFailed) routed to a separate, verified alert path
4. **Defense in depth for alerting**: Understand that multiple notification paths can all fail independently, and that each path needs its own health monitoring

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[catalog]] -- sns, cloudwatch, lambda service entries
