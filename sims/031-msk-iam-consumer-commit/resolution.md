---
tags:
  - type/resolution
  - service/msk
  - service/iam
  - service/ec2
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# Resolution: Every Order, Again

## Root Cause

The IAM policy attached to the EC2 instance role for the order-processor consumer group (`consumer-order-processor-role`) is missing `kafka-cluster:AlterGroup` on the consumer-group resource. The policy has `Connect`, `DescribeCluster`, `DescribeTopic`, `ReadData`, and `DescribeGroup`, but not `AlterGroup`. `AlterGroup` is the specific kafka-cluster action that Amazon MSK IAM access control checks when a client attempts to commit offsets or participate in a consumer group rebalance.

Without `AlterGroup`, the consumer connects, joins the group, fetches records, and processes them normally, but every offset commit is rejected by the broker with `GROUP_AUTHORIZATION_FAILED`. The Java Kafka client's default auto-commit loop catches the exception, logs a WARN, and keeps going. The committed offset in the group therefore remains stuck at the last successful commit, which is where the group was on Friday before the SASL to IAM migration. Every consumer restart, ASG health-check replacement, or partition rebalance causes the group to reset to that old committed offset. The same block of OrderPlaced messages gets processed again, and the Fulfillment service produces duplicate charges and duplicate shipments for each.

## Timeline

| Time | Event |
|---|---|
| Fri 14:02 ET | Change PR merged: migrate order-processor to MSK IAM access control |
| Fri 14:17 ET | Rolling deploy finishes across six order-processor EC2 instances |
| Fri 14:17 ET | First commit failure WARN appears in consumer logs; no alarm fires |
| Fri 16:40 ET | First consumer ASG instance is replaced by an unrelated health check; group rebalances and re-reads from the pre-migration offset |
| Sat 02:11 ET | First duplicate charge hits Stripe; customer service closed |
| Sun 09:00 ET | Weekend support ticket volume reaches 23 |
| Mon 08:50 ET | Platform oncall opens the incident; Stripe fraud hold threatened |
| Mon 09:12 ET | Consumer group lag chart shows sawtooth pattern, revealing offsets not sticking |
| Mon 09:18 ET | `kafka-cluster:AlterGroup` added to the role's IAM policy via Terraform |
| Mon 09:21 ET | Commit success rate returns to normal; group lag begins draining |
| Mon 12:40 ET | Reconciliation job completes; 341 customers refunded and notified |

## Correct Remediation

1. **Confirm the duplicate processing.** Ask Fulfillment for the IDs of the duplicate charges. Cross-reference those IDs against the OrderPlaced messages in the MSK topic. If the same message was consumed more than once, the problem is on the consumer side, not a producer-side duplicate event.
2. **Check the consumer group state.** Run `kafka-consumer-groups.sh --describe --group order-processor --bootstrap-server <iam-endpoint> --command-config iam.properties` or view the group in the MSK console. A working group has CURRENT-OFFSET values that advance monotonically. A broken group has CURRENT-OFFSET stuck at the same value and LAG resetting to the total topic size every restart.
3. **Read the consumer logs.** Filter for "commit" and WARN level. The aws-msk-iam-auth SASL plugin surfaces MSK authorization failures as `TopicAuthorizationException` with the full resource ARN in the message. When auto-commit is enabled, these errors are logged and swallowed. The presence of these warnings is the smoking gun.
4. **Inspect the consumer role's IAM policy.** For MSK IAM access control, every Kafka client operation is authorized by a specific `kafka-cluster:*` action on a specific resource ARN. A consumer needs at minimum: `Connect` on the cluster; `DescribeCluster`; `DescribeTopic` and `ReadData` on the topic; `DescribeGroup` and **`AlterGroup`** on the consumer group. Compare against the policy document. In this sim, `AlterGroup` is missing.
5. **Apply the fix.** Add `kafka-cluster:AlterGroup` with `Resource: arn:aws:kafka:us-east-1:742108355610:group/linden-msk-prod/<cluster-uuid>/order-processor` to the policy. Push through Terraform; do not hand-edit production IAM policies in the console. Changes propagate to the MSK broker's authorization path within a minute.
6. **Verify commits are now succeeding.** Watch the CloudWatch metric `OffsetCommitRequestsPerSec` for the consumer group, or re-check the consumer log for successful commits. The consumer group's LAG should begin draining toward zero as the consumer works through the backlog of messages it had been replaying.
7. **Seek the group past the backlog.** Since the backlog will be re-processed if you simply let the consumer catch up, and every re-processed message was already handled by Fulfillment during the duplicate-charging window, you need to decide whether to replay or skip. For this sim, the right action is to seek the group to the latest offset for every partition (`kafka-consumer-groups.sh --reset-offsets --to-latest --execute`) because the backlog has already produced side effects downstream. Then reconcile.
8. **Reconcile duplicates.** Pull the week's worth of OrderPlaced events, cross-reference against Stripe's charge log and the Fulfillment service's shipment log, identify duplicates, refund the extra charges, and cancel any shipments that have not yet left the warehouse. Send customer notifications.
9. **Harden for next time.** Disable Kafka client auto-commit (or switch to `commitSync()` with explicit error handling). Add an alarm on the consumer group's `SumOffsetLag` metric for sudden jumps. Add an alarm on `OffsetCommitRate` dropping to zero. Store the canonical MSK IAM policies in a shared Terraform module with separate producer and consumer role definitions, each listing the full set of `kafka-cluster:*` actions required.

## Key Concepts

### MSK IAM Access Control vs SASL/SCRAM

Amazon MSK supports several authentication modes: mTLS with client certificates, SASL/SCRAM with username/password stored in AWS Secrets Manager, and IAM access control. SASL/SCRAM is username-based and pairs poorly with AWS's identity model: once a user authenticates, their authorization comes from Kafka ACLs managed separately via the Kafka Admin API. Rotating credentials means rotating secrets.

MSK IAM access control, introduced in 2021, lets Kafka clients sign requests using AWS IAM credentials (the same SigV4 mechanism that signs S3 API calls) and evaluates authorization against the IAM policy attached to the caller's identity. There is no separate Kafka ACL layer and no separate credential management: the EC2 instance role or IRSA role is the credential, and its IAM policy is the access control list. This is the mode AWS recommends for new MSK deployments.

The catch is that MSK IAM access control introduces a set of fine-grained `kafka-cluster:*` IAM actions. Each Kafka operation maps to one or more of these actions, and the broker evaluates the caller's IAM policy before allowing the operation.

### kafka-cluster:* Actions for a Consumer

| Action | What it authorizes | Resource |
|---|---|---|
| `kafka-cluster:Connect` | Opening a TCP connection to the broker | Cluster ARN |
| `kafka-cluster:DescribeCluster` | Reading cluster metadata | Cluster ARN |
| `kafka-cluster:DescribeTopic` | Reading topic metadata (partitions, replication) | Topic ARN |
| `kafka-cluster:ReadData` | Fetching records from a topic partition | Topic ARN |
| `kafka-cluster:DescribeGroup` | Reading consumer group metadata (committed offsets, members) | Consumer group ARN |
| **`kafka-cluster:AlterGroup`** | **Committing offsets, joining or leaving a consumer group, rebalancing** | Consumer group ARN |

`AlterGroup` is the one that matters for this sim. A consumer without it can still read, but cannot record progress. The failure is not at connect, not at fetch, not at process, but at the commit step that runs every few seconds in the background.

### Why This Failure Is Silent

The Java Kafka client's default behavior, when an auto-commit fails, is to log the exception at WARN and continue trying on the next interval. This is reasonable when commits fail transiently due to a network glitch, but it is dangerous when the failure is permanent (like a missing IAM action) because the consumer keeps processing messages without ever persisting its progress. The first visible symptom tends not to be the commit failure itself but a downstream consequence: the next time the consumer restarts and the group rebalances, it re-reads from the last known committed offset, which is the one that was persisted before the problem started.

The right production setting is `enable.auto.commit=false` combined with explicit `commitSync()` calls after each successful batch, with an exception handler that raises commit failures to the application as first-class errors.

## Other Ways This Could Break

### IAM actions are correct, but the Resource ARN is wrong
The policy has all the right `kafka-cluster:*` actions, but the Resource field uses a cluster UUID from a different cluster or lists a wildcard `/*` where a specific group ARN is required. The policy authorizes nothing because nothing matches. Authorization failures look similar: commit fails, log WARNs accumulate. Reading the error message shows the resource the broker was expecting to match against.
**Prevention:** Generate all kafka-cluster resource ARNs through a single Terraform module or CDK construct that takes the cluster ARN and the group or topic name as inputs. Never type an MSK ARN by hand.

### The consumer cannot connect at all because of network policy
Consumers are in a reconnect loop, not a commit loop. The Kafka client prints `ConnectionException` or TLS handshake failures. IAM is not even consulted yet because the broker never receives a SigV4-signed request.
**Prevention:** Before blaming IAM, confirm network reachability with a quick `openssl s_client -connect <broker>:9098` from the consumer host. A successful TLS handshake that then fails authorization is a different problem from a failed handshake.

### Two consumer groups share the same name across environments
Commits succeed, but offsets are being clobbered by a consumer that is processing different or stale records. This can happen when a dev account assumes a role into prod for troubleshooting and the developer forgets to namespace their group name.
**Prevention:** Enforce a naming convention (`<env>-<service>-<purpose>`, e.g., `prod-order-processor`) and deny `kafka-cluster:AlterGroup` via an SCP on group ARNs that do not start with the caller's environment prefix.

## SOP Best Practices

- Treat every `kafka-cluster:*` action as a distinct capability. Producers need `WriteData`; consumers need `ReadData` AND `AlterGroup`; admin tools need `AlterCluster` or `AlterTopic`. Copy-pasting a partial policy from a blog post is the most common way a production consumer ends up unable to commit.
- Disable Kafka client auto-commit in production. Commit explicitly after each processed batch and surface commit failures as application errors. Auto-commit is a convenience for local experiments, not a production pattern.
- Alarm on both consumer group lag jumps and offset-commit rate going to zero. Lag alone is not enough because a broken consumer can still drain lag per restart, just to re-accumulate it.
- Roll out MSK authentication mode changes behind a canary. Bring up one consumer using the new auth mode reading from a non-critical group, verify commits end-to-end, then cut over the production consumers.

## Learning Objectives

1. **MSK IAM access control model:** Understand how Kafka operations map to `kafka-cluster:*` actions and which actions a consumer needs.
2. **Offset commit semantics:** Understand why a silent commit failure causes unbounded duplicate processing in at-least-once consumers.
3. **Auto-commit is a production anti-pattern:** Recognize that the default Kafka client setting suppresses authorization failures and masks real bugs.
4. **Consumer lag interpretation:** Read the sawtooth lag pattern and identify that it signals non-sticking offsets, not a traffic spike.
5. **Idempotency as the failsafe:** Understand why the Fulfillment service's lack of idempotency turned a consumer bug into customer-facing overcharging.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
- [[learning/catalog.csv]] -- Player service catalog and progress
