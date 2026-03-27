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

company: Clarabridge Analytics
industry: analytics / business intelligence, bootstrapped profitable, 34 engineers
product: real-time business intelligence dashboards
scale: 890 business customers, $4.8M ARR, data ingestion pipeline processes 14 million events per day
time: 10:52 AM, Wednesday
scene: ops lead discovered the outage from a customer tweet while scrolling Twitter during standup -- not from any alerting system
alert: customer tweet: "anyone else seeing stale data on @clarabridge dashboards? Our revenue numbers haven't updated in an hour"
stakes: product promise is real-time data; when data stops flowing, customers see stale numbers and start asking questions
early_signals:
  - Lambda function clarabridge-ingest-processor failing, writes to DynamoDB tables that feed dashboard frontend
  - CloudWatch alarm for ingest processor Lambda in ALARM state since 10:07 AM (45 minutes before discovery)
  - alarm fired correctly: detected Lambda error rate exceeded 5%, transitioned from OK to ALARM
  - alarm action published to SNS topic clarabridge-ops-alerts, publish succeeded
  - no email arrived, no Slack message appeared, no text was sent
  - three notification paths existed on the topic, none delivered
investigation_starting_point: ops engineer. Team just learned about the outage from a customer tweet. The CloudWatch alarm did its job. Something after the alarm broke down. Need to find why the notification pipeline failed silently.

## Resolution

root_cause: all three SNS notification paths were broken independently -- email subscription in PendingConfirmation for three weeks, Slack webhook Lambda returning 403 Forbidden for eight days, SMS spending limit exhausted the previous week
mechanism: (1) three weeks earlier, ops team migrated from ops-lead@clarabridge.io to ops-team@clarabridge.io. New subscription created but never confirmed -- confirmation email from AWS landed in spam folder of shared inbox. SNS silently skips delivery to PendingConfirmation subscriptions. (2) eight days ago, Slack workspace admin rotated all webhook URLs during security audit. Nobody updated the SLACK_WEBHOOK_URL environment variable on clarabridge-slack-notifier Lambda. Every invocation returned 403 Forbidden. No dead-letter queue configured, failures only visible in CloudWatch Logs nobody was watching. (3) previous week, a noisy alarm fired repeatedly during a deployment, sending dozens of SMS messages. Account SNS SMS spending limit was $1.00/month default. Budget exhausted, SNS silently stopped sending SMS for remainder of month.
fix: (1) confirm the email subscription. (2) update Slack webhook URL in Lambda environment variable. (3) increase SMS spending limit above $1.00 default. Also: add dead-letter queue to Slack Lambda, create CloudWatch alarm on NumberOfNotificationsFailed for the SNS topic routed to a separate verified path, automate weekly subscription health checks.
contributing_factors:
  - email subscription confirmation not verified after migration, confirmation email went to spam
  - Slack webhook rotation not communicated to the team managing the Lambda function
  - SMS spending limit left at $1.00 default, no monitoring on SMSMonthToDateSpentUSD
  - no dead-letter queue on the Slack notifier Lambda
  - no monitoring on the notification pipeline itself (NumberOfNotificationsFailed metric not alarmed)
