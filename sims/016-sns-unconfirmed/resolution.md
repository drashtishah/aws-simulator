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

1. **Fix the email path -- confirm the subscription**: When you create an email subscription on an SNS topic, AWS sends a confirmation email to that address. Until someone clicks the link in that email, the subscription stays in PendingConfirmation status, and SNS silently skips it for every message. Find the confirmation email in the spam folder of ops-team@clarabridge.io and click the link. If the link has expired, delete the old subscription and create a new one:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:111222333444:clarabridge-ops-alerts \
  --protocol email \
  --notification-endpoint ops-team@clarabridge.io
```

Then immediately click the link in the new confirmation email.

2. **Fix the Slack path -- update the webhook URL**: The Lambda function that posts to Slack stores the webhook URL (the address it sends messages to) in an environment variable -- a configuration value the function reads at runtime. The old URL was rotated and no longer works. Update it with the current URL:

```bash
aws lambda update-function-configuration \
  --function-name clarabridge-slack-notifier \
  --environment "Variables={SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX}"
```

3. **Fix the SMS path -- raise the text message spending cap**: AWS accounts have a monthly spending limit for text messages sent through SNS. The default cap is just $1.00 per month. Once that cap is hit, SNS silently stops sending all texts for the rest of the month -- no warning, no error. Raise the cap to a value that can handle your normal alert volume:

```bash
aws sns set-sms-attributes \
  --attributes '{"MonthlySpendLimit": "50"}'
```

4. **Add a safety net to the Slack Lambda -- configure a dead-letter queue**: A dead-letter queue (DLQ) is a queue that captures messages or function runs that failed. Without one, failed Lambda invocations are retried a few times and then silently discarded. Adding a DLQ means failures are saved so you can investigate them:

```bash
aws lambda update-function-configuration \
  --function-name clarabridge-slack-notifier \
  --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:111222333444:slack-notifier-dlq
```

5. **Monitor the notification pipeline itself**: The biggest lesson here is that alerting systems need their own monitoring. Create a CloudWatch alarm on the SNS metric NumberOfNotificationsFailed, which counts how many delivery attempts failed for a topic. Route this alarm to a separate, already-confirmed notification path (like a PagerDuty integration) so that if your main alerts break, you still find out:

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

6. **Automate subscription health checks**: Set up a periodic check (a weekly scheduled job or an AWS Config rule) that lists all subscriptions on critical topics and alerts if any are still in PendingConfirmation status. This catches the problem before it matters.

## Key Concepts

### How SNS email subscriptions work -- and how they silently break

When you add an email address to an SNS topic, AWS sends a confirmation email to that address with a link to click. Until someone clicks that link, the subscription stays in a state called PendingConfirmation. Here is the dangerous part: SNS silently skips delivery to any subscription in this state. There is no error, no metric, and no log entry -- it just does not send the message. If the confirmation email lands in spam (as it did here), the subscription looks like it exists but never actually delivers anything. Unconfirmed subscriptions may be automatically cleaned up after three days, but in some cases (especially when created through the console or API), they persist indefinitely in PendingConfirmation.

### The hidden text message spending cap -- SNS SMS spending limits

Every AWS account has a monthly cap on how much it can spend on text messages sent through SNS. The default cap is $1.00 per month -- enough for only a handful of messages. Once you hit the cap, SNS stops sending all text messages for the rest of the month. There is no warning or notification when this happens. Delivery just stops. The NumberOfNotificationsFailed metric goes up, but only if someone is watching it. You can raise this cap by setting the MonthlySpendLimit account attribute or by requesting an increase through AWS Support.

### Why your alerting system needs its own alerts -- notification pipeline observability

An alerting pipeline that nobody monitors is a hidden single point of failure. If the pipeline itself breaks, you will not find out until a customer tells you. SNS publishes delivery metrics to CloudWatch: NumberOfMessagesPublished (how many messages were sent to the topic), NumberOfNotificationsDelivered (how many reached their destination), NumberOfNotificationsFailed (how many delivery attempts failed), and NumberOfNotificationsFilteredOut (how many were intentionally skipped by filter rules). Setting up a CloudWatch alarm on NumberOfNotificationsFailed and routing it to a completely separate, already-confirmed notification path (a different topic, a different protocol, ideally a different team) creates a safety net. That is what was missing here.

## Other Ways This Could Break

### A subscription filter quietly drops messages before delivery
The subscription is confirmed and the endpoint works fine, but a filter rule attached to the subscription does not match the tags on the incoming message. Filter policies let you route only certain messages to certain subscribers -- but if the filter does not match, SNS skips delivery entirely. It counts this as "filtered out" (tracked by the NumberOfNotificationsFilteredOut metric), not "failed," so the NumberOfNotificationsFailed metric stays at zero. The message was intentionally skipped, but the effect is the same: nobody got notified.
**Prevention:** Whenever you change the structure of message tags (called message attributes), review the filter rules on every subscription to make sure they still match. Monitor NumberOfNotificationsFilteredOut alongside NumberOfNotificationsFailed to catch unexpected filtering.

### The SNS topic's access policy blocks the service trying to publish to it
This is a problem earlier in the chain -- the message never reaches the topic at all. Every SNS topic has an access policy (a JSON document) that controls which services are allowed to publish messages to it. If that policy does not grant the CloudWatch service permission to publish, the alarm action fails with an AccessDenied error. The alarm's ActionsExecutionState field shows FAILED, and no subscription receives anything.
**Prevention:** Make sure the topic's access policy allows cloudwatch.amazonaws.com to call sns:Publish. Test alarm actions in a staging environment by manually triggering the alarm with the set-alarm-state API.

### A Lambda function fails internally, but without a dead-letter queue the failures vanish
SNS successfully calls the Lambda function (the subscription is confirmed and working), but the function's own code crashes. Without a dead-letter queue (a place to save failed messages) or an on-failure destination, the failed run is retried a few times and then silently thrown away. The only evidence is buried in the function's CloudWatch Logs, which nobody is watching.
**Prevention:** Always set up a dead-letter queue or an on-failure destination on Lambda functions triggered by SNS. Create a CloudWatch alarm on the dead-letter queue's message count (ApproximateNumberOfMessagesVisible) so you know when failures are piling up.

### SNS gives up retrying an HTTPS endpoint and discards the message
An HTTPS subscription endpoint (a web server that receives notifications) is temporarily down. SNS retries delivery according to its retry rules (by default, 3 retries over 20 seconds for HTTP). If every retry fails, the message is thrown away -- unless you have set up a dead-letter queue on the subscription itself. Unlike Lambda functions, SNS subscriptions can have their own dead-letter queue configuration, called a redrive policy.
**Prevention:** Set up a subscription-level redrive policy that sends failed messages to an SQS dead-letter queue. Monitor both the NumberOfNotificationsFailed metric and the dead-letter queue depth.

## SOP Best Practices

- After creating any email subscription on an SNS topic, immediately check that it reaches Confirmed status. Do not assume the confirmation email arrived -- look in spam folders and set a calendar reminder to verify within 24 hours. Until confirmed, SNS silently drops every message meant for that address.
- Raise the monthly text message spending cap (the MonthlySpendLimit setting) to a value that can handle your peak alert volume with room to spare. The default is only $1.00 per month. Also create a CloudWatch alarm on the SMSMonthToDateSpentUSD metric that fires at 80% of your cap, so you know before texts stop sending.
- Set up a dead-letter queue on every Lambda function that SNS triggers, and on every HTTPS subscription. A dead-letter queue catches messages that failed to deliver, so failures are saved for investigation instead of silently thrown away.
- Monitor the notification pipeline itself. Create a CloudWatch alarm on NumberOfNotificationsFailed for every important SNS topic, and send that alarm to a separate, already-verified notification path. This way, if your main alerts break, the alert-about-alerts still works.

## Learning Objectives

1. **Subscription lifecycle awareness**: Understand that SNS email subscriptions require explicit confirmation and that PendingConfirmation subscriptions silently drop all messages with no error feedback
2. **SMS spending limit**: Recognize that the default $1.00/month SNS SMS spending limit silently stops delivery when exhausted, with no built-in notification
3. **Notification pipeline observability**: Learn to monitor the notification pipeline itself using SNS delivery metrics (NumberOfNotificationsFailed) routed to a separate, verified alert path
4. **Defense in depth for alerting**: Understand that multiple notification paths can all fail independently, and that each path needs its own health monitoring

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 4: Troubleshooting and Optimization
- [[catalog]] -- sns, cloudwatch, lambda service entries
