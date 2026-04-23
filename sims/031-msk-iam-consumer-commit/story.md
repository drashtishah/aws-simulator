---
tags:
  - type/simulation
  - service/msk
  - service/iam
  - service/ec2
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# Every Order, Again

## Opening

- company: Linden Goods
- industry: Direct-to-consumer home goods
- product: end-to-end order platform: web storefront, checkout, fulfillment, and shipping orchestration
- scale: Series B, 120 engineers, 14,000 orders per business day, 7-day retention on the orders topic (~2.1 million messages at any time)
- time: Monday 08:50 Eastern, first business morning after a Friday MSK authentication migration
- scene: Customer Support Slack channel at 41 open tickets in 36 hours. Stripe's fraud monitoring has flagged Linden's merchant account for abnormal refund-following-charge patterns.
- alert: no PagerDuty alert fired. MSK console shows cluster Active. Fulfillment dashboard shows healthy throughput. The alarm that matters (consumer group offset commit rate) does not exist.
- stakes: ~340 customers charged at least twice over the weekend; estimated $78,000 in over-charges. Stripe is threatening to put the merchant account on a 7-day review hold if the duplicate charge rate does not come down immediately.
- early_signals: 41 customer support tickets, Stripe fraud flag, warehouse operations complaining about duplicate pick orders from the same parent OrderPlaced event
- investigation_starting_point: You know a Friday change cut the order-processor consumer group over from SASL/SCRAM to MSK IAM access control. The config change went through code review and the rollout was uneventful. You have access to the MSK console, CloudWatch metrics, IAM, the consumer EC2 instance role, and Kafka client logs via CloudWatch Logs.

## Resolution

- root_cause: The IAM policy attached to the consumer-order-processor-role EC2 instance profile is missing kafka-cluster:AlterGroup on the order-processor consumer group resource. It has kafka-cluster:Connect, DescribeCluster, DescribeTopic, ReadData, and DescribeGroup. The policy was authored from the first half of the MSK IAM access control documentation page and the engineer stopped reading before the section on consumer-group actions.
- mechanism: Consumers start up, assume the EC2 instance role, and use the aws-msk-iam-auth SASL plugin to authenticate to the MSK broker. Connect succeeds. Join-group succeeds (DescribeGroup is present). Fetch succeeds (ReadData is present). Processing succeeds. Every 5 seconds, the Kafka client's auto-commit loop sends an OffsetCommit request. The broker checks the caller's IAM policy for kafka-cluster:AlterGroup on the order-processor group resource and finds nothing. It returns GROUP_AUTHORIZATION_FAILED. The client library catches the error, logs a WARN with the exception, and continues. Because the commit fails, the committed offset in the group stays where it was last Friday, before the migration. Every consumer restart, every ASG health-check replacement, and every partition rebalance causes the group to reset to that old committed offset, and the same backlog of messages is replayed through Fulfillment. Fulfillment has no idempotency check; every duplicate OrderPlaced becomes a duplicate charge and a duplicate shipment.
- fix: Add kafka-cluster:AlterGroup on the consumer-group ARN to the consumer role's IAM policy: Resource arn:aws:kafka:us-east-1:742108355610:group/linden-msk-prod/f4c6a8e9-1d2b-4abc-9e7f-110022334455/order-processor. Deploy via Terraform. Once the policy propagates (usually within 60 seconds), the next auto-commit succeeds, visible in the cluster's OffsetCommitRequestsPerSec metric. Consumer group lag starts draining. After the backlog clears, the group is manually seeked to the latest offset and the replayed duplicate orders are reconciled against Stripe. Customers are refunded and notified.
- contributing_factors: The IAM policy for MSK access control was written by hand rather than generated from a shared module that enumerates the canonical set of actions per role type. The Java Kafka client was left on auto-commit, so the authorization failure was silenced as a WARN log rather than raised to the application. There was no CloudWatch alarm on the consumer group's offset commit rate or on sudden lag increases. The migration from SASL to IAM was rolled out to all order-processor instances simultaneously on Friday afternoon, with no dark-launch canary in a non-critical consumer group first. The Fulfillment service has no idempotency key on the OrderPlaced path, which converts a consumer reliability problem into a customer-facing charge problem.
