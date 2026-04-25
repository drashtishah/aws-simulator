# Opening: The Region You Did Not Know You Lived In

It is Sunday, 23:14 UTC. You are the SRE on call for Westmark Insights, a Series B
B2B analytics platform for European retailers. The customer-facing dashboard runs in
eu-west-1 and the team has practiced regional failover to eu-central-1 quarterly.

Two hours ago, AWS US-EAST-1 began a major service event affecting DynamoDB, IAM,
EC2, Lambda, and ACM. The eu-west-1 region is green. Your customer-facing dashboard at
dashboard.westmark-insights.com is fully healthy: ALB target health is 100%, ECS Fargate
is serving requests, Aurora is up.

Yet PagerDuty has fired four chained alerts:
- `westmark-cd: deploy to eu-west-1 failed: AssumeRole 5xx`
- `westmark-docs-cdn: 502 responses from origin`
- `westmark-support-bot: Slack reachability degraded`
- `westmark-iam: console login redirect failed`

A press release referencing docs.westmark-insights.com goes out tomorrow morning.
A critical customer fix was scheduled to deploy tonight. Engineers in the office cannot
log in to the AWS console.

Your job: find why a regionally independent architecture cannot perform any operational
task during an outage of a region you do not even use, and design the layered remediation.
