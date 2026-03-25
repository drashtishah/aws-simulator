---
tags:
  - type/simulation
  - service/sns
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/operations
---

# A Notification for No One

## Opening

The tweet said "anyone else seeing stale data on @clarabridge dashboards? Our revenue numbers haven't updated in an hour." It was 10:52 AM on a Wednesday. The ops lead saw it because he was scrolling Twitter on his phone during a standup. Not because any alerting system told him something was wrong.

Clarabridge Analytics builds real-time business intelligence dashboards. Eight hundred and ninety business customers. $4.8M ARR. The data ingestion pipeline processes fourteen million events per day through a Lambda function called `clarabridge-ingest-processor`, which writes to DynamoDB tables that feed the dashboard frontend. The product promise is real-time. When the data stops flowing, customers see stale numbers and start asking questions.

The ops lead opened the CloudWatch console. The alarm for the ingest processor Lambda had been in ALARM state since 10:07 AM. Forty-five minutes. The alarm had fired correctly. It detected that the Lambda error rate exceeded five percent and transitioned from OK to ALARM. The alarm action was configured to publish to an SNS topic called `clarabridge-ops-alerts`. The SNS topic received the notification. The publish succeeded. And then nothing. No email arrived. No Slack message appeared. No text was sent. Three notification paths existed on that topic. None of them delivered.

You are the ops engineer. The team has just learned about the outage from a customer tweet. The CloudWatch alarm did its job. Something after the alarm broke down. You need to find out why the notification pipeline failed silently and how to fix it.

## Resolution

Three weeks earlier, the ops team migrated from an individual email address to a team distribution list. The old subscription to ops-lead@clarabridge.io was replaced with a new subscription to ops-team@clarabridge.io. The new subscription was created but never confirmed. The confirmation email from AWS landed in the spam folder of the shared inbox. For three weeks, the email subscription sat in PendingConfirmation status. SNS does not deliver messages to pending subscriptions. It does not log an error. It simply does not attempt delivery.

The Slack notification path used a Lambda function called `clarabridge-slack-notifier`. The function read a webhook URL from an environment variable and posted alarm payloads to a Slack channel. Eight days ago, the Slack workspace admin rotated all webhook URLs as part of a security audit. Nobody updated the Lambda environment variable. Every invocation since then returned 403 Forbidden from the Slack API. The Lambda function had no dead-letter queue configured, so the failures were only visible in CloudWatch Logs for the function itself -- logs that nobody was watching.

The SMS subscription was the last line of defense. It had been working. But the previous week, a noisy alarm had fired repeatedly during a deployment, sending dozens of SMS messages. The account's SNS SMS spending limit was set to the default of $1.00 per month. The SMS budget was exhausted. SNS stopped sending SMS messages for the remainder of the month. There is no alarm for this. There is no email notification. The delivery simply stops. Three independent paths. Three independent failures. The CloudWatch alarm did exactly what it was supposed to do. The last mile failed in three different ways, and the team learned about a production outage from a customer on Twitter.
