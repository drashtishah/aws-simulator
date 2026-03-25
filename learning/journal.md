---
tags:
  - type/learning-journal
  - domain/aws-simulator
---

# Learning Journal

Progress entries are added automatically after each completed simulation.

## The BrightPath Outage: Students Locked Out

- **Date**: 2026-03-24
- **Sim**: [[001-ec2-unreachable]]
- **Difficulty**: 1
- **Category**: networking
- **Services**: EC2, VPC, CloudWatch
- **Questions asked**: 3
- **Hints used**: 0
- **Criteria met**: 3 / 3

### Coaching summary

Strong architectural instinct -- started by understanding the infrastructure layout before investigating. Correctly identified the security group as the culprit and found the missing port 443 rule without hints. Needs to broaden investigation to multiple services (only queried EC2) and develop the habit of checking audit trails and recent changes early.

### Key takeaway

Security groups are deny-by-default firewalls. If no inbound rule explicitly allows traffic on a port, that traffic is silently dropped.

## A Function in the Wrong Room

- **Date**: 2026-03-25
- **Sim**: [[006-wrong-region]]
- **Difficulty**: 1
- **Category**: operations
- **Services**: Lambda, CloudWatch, IAM
- **Questions asked**: 6
- **Hints used**: 0
- **Criteria met**: 3 / 3

### Coaching summary

Solved with zero hints by methodically tracing the deployment path: checked Lambda in us-east-1 (not found), found it in us-west-2, then traced the cause to AWS_DEFAULT_REGION in the CI/CD pipeline. Good audit trail instinct -- asked who made the change and when. Needs to broaden investigation to include CloudWatch logs, which contained the full API Gateway error trace.

### Key takeaway

AWS resources are regional. When a resource "does not exist" but was successfully deployed, check which region the CLI is targeting. `aws configure list` shows the active region and its source in one command.

## The CropSync Harvest Crisis: Database Full

- **Date**: 2026-03-25
- **Sim**: [[003-rds-storage-full]]
- **Difficulty**: 1
- **Category**: data
- **Services**: RDS, CloudWatch, EC2
- **Questions asked**: 5
- **Hints used**: 0
- **Criteria met**: 3 / 3

### Coaching summary

Metrics-first investigation -- went straight to CloudWatch and identified FreeStorageSpace dropping to zero as the root cause. Queried all three services (CloudWatch, RDS, EC2) and dug past the symptom to find that binary logs (3.2GB) and a verbose slow query log (1.8GB) consumed the remaining disk. Proposed auto-scaling with data-driven sizing. Did not check existing alarms to identify the monitoring gap.

### Key takeaway

When a database stops accepting writes but reads still work, storage exhaustion is the most likely cause. Always monitor FreeStorageSpace with a CloudWatch alarm, and enable RDS storage auto-scaling to prevent this class of outage entirely.
