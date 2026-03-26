---
tags:
  - type/resolution
  - service/nat-gateway
  - service/s3
  - service/vpc
  - service/cloudwatch
  - difficulty/starter
  - category/cost
---

# Resolution: Nine Hundred Dollars for Nothing

## Root Cause

The EC2 instances running the data pipeline in private subnet `subnet-0b2c3d4e5f678901a` (10.0.2.0/24) send approximately 500 GB of data daily to S3 bucket `fieldspar-sensor-lake-prod`. The private subnet route table `rtb-0d4e5f6a7b8c9d0e1` has no S3 VPC gateway endpoint. The only non-local route is `0.0.0.0/0 -> nat-0a1b2c3d4e5f67890`. All S3 traffic traverses the NAT Gateway, which charges $0.045 per GB for data processing. At 500 GB/day, this is $22.50 per hour, $907.20 per day, and approximately $27,000 over the three months the pipeline has been running.

## Timeline

| Time | Event |
|---|---|
| 2026-01-06 | Data pipeline deployed to production. Three c5.2xlarge instances in private subnet begin writing sensor data to S3 via NAT Gateway. |
| 2026-01-06 | NAT Gateway data processing charges begin accruing at ~$907/day. No alerts configured for cost anomalies. |
| 2026-01-31 | January AWS bill: $31,100. Reviewed at summary level only. NAT Gateway line item not examined. |
| 2026-02-28 | February AWS bill: $30,200. No detailed review performed. |
| 2026-03-22 | Finance lead opens Cost Explorer for board runway update. Filters by service. Discovers NAT Gateway data processing at $907.20/day. |
| 2026-03-22 | Finance lead calculates 90-day total: $27,135. Posts to engineering channel. |
| 2026-03-22 | Root cause identified: missing S3 VPC gateway endpoint. All S3 traffic routes through NAT Gateway. |
| 2026-03-22 | S3 VPC gateway endpoint created. Route table updated. NAT Gateway data processing charges drop to ~$1.56/day (hourly gateway charge only). |

## Correct Remediation

1. **Create a free shortcut so S3 traffic stays inside the AWS network**. Without this shortcut, all traffic from the private subnet to S3 goes through the NAT Gateway, which charges per gigabyte. The shortcut is called an S3 VPC gateway endpoint:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0a1b2c3d4e5f67890 \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0d4e5f6a7b8c9d0e1
```

2. **Confirm the route table was updated**. After creating the endpoint, check the route table for a new entry. Its destination will be a prefix list -- a set of S3 IP addresses, shown as something like `pl-63a5400a` -- pointing to the new endpoint. Because this rule is more specific than the catch-all rule (`0.0.0.0/0`) that sends everything through the NAT Gateway, S3 traffic now takes the free path.

3. **Confirm the pipeline still works**. Gateway endpoints are invisible to your application. Your code and AWS SDK calls do not need any changes. Verify the data pipeline continues writing to S3 without errors.

4. **Check whether you also need a DynamoDB shortcut**. If any servers in the private subnet talk to DynamoDB (a managed database service), create a gateway endpoint for it too. It is also free:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0a1b2c3d4e5f67890 \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0d4e5f6a7b8c9d0e1
```

5. **Set up a spending alert**. Create a CloudWatch billing alarm that notifies you if NAT Gateway charges exceed a daily threshold (for example, $50/day). This catches similar problems quickly instead of letting them accumulate for months.

6. **Check all other private subnets**. Look for any other subnets with servers sending large amounts of data to S3 or DynamoDB. Each subnet needs its own gateway endpoint to avoid unnecessary NAT Gateway charges.

## Key Concepts

### Two kinds of VPC endpoints: gateway endpoints vs interface endpoints

AWS offers two ways to let servers in a private subnet talk to AWS services without going through the NAT Gateway. The key difference is cost and availability:

- **Gateway endpoints** are free shortcuts available only for S3 and DynamoDB. They work by adding a rule to the route table that directs traffic for those services to the endpoint instead of the NAT Gateway. Traffic stays entirely inside the AWS network.
- **Interface endpoints** (powered by a feature called AWS PrivateLink) are available for most other AWS services, but they cost money -- $0.01/hour per availability zone plus $0.01 per GB of data processed. They work differently: they create a virtual network card (called an elastic network interface) in your subnet with its own private IP address.
- For S3 and DynamoDB, gateway endpoints are almost always the right choice because they cost nothing.

### How the NAT Gateway charges you

A NAT Gateway is a relay that lets servers in a private subnet send traffic to the internet. It has two charges:

- **Hourly charge**: $0.045/hour (~$1.08/day, ~$32.40/month) just for the NAT Gateway existing, even if no traffic flows through it.
- **Data processing charge**: $0.045 for every gigabyte of data that passes through the NAT Gateway, in either direction. This is the charge that adds up fast with high-volume workloads.

The NAT Gateway does not care whether traffic is going to the public internet or to an AWS service like S3. It charges per gigabyte for everything that flows through it.

### How the route table changes when you create a gateway endpoint

When you create a gateway endpoint and attach it to a route table, AWS automatically adds a new routing rule. The destination is a prefix list -- a set of IP addresses belonging to the service (for example, `pl-63a5400a` for S3 in the us-east-1 region) -- and the target is the endpoint. This rule is more specific than the catch-all rule `0.0.0.0/0` (which sends everything to the NAT Gateway), so S3 traffic matches the prefix list rule first and takes the free path.

### Why gateway endpoints are free

Gateway endpoints are not a separate piece of infrastructure. They are just a modification to the route table. There is no virtual network card, no hourly charge, and no per-gigabyte fee. AWS provides them at no cost because routing traffic directly to S3 or DynamoDB reduces load on NAT Gateways and internet gateways, and keeps data on the AWS backbone network.

## Other Ways This Could Break

### Gateway endpoint created but attached to the wrong route table

You create the endpoint, but you link it to the wrong route table -- for example, the public subnet's route table instead of the private subnet's. The private subnet still has no shortcut to S3, so all traffic continues going through the NAT Gateway. It looks like the fix was applied, but costs do not decrease.

**Prevention:** When creating the endpoint, list every private subnet route table that needs the S3 shortcut using `--route-table-ids`. Then verify each route table actually has the new prefix list entry by running `aws ec2 describe-route-tables`.

### Accessing an S3 bucket in a different region

A gateway endpoint only works for S3 buckets in the same AWS region as your network. If the pipeline writes to a bucket in a different region, the traffic still goes through the NAT Gateway and you pay both the NAT Gateway per-gigabyte fee and a cross-region data transfer fee. The gateway endpoint provides no cost savings.

**Prevention:** Keep S3 buckets in the same region as the servers that use them. If cross-region access is necessary, know that the gateway endpoint will not help, and plan your budget accordingly.

### An endpoint security policy blocks your application

When creating a gateway endpoint, you can attach a policy that restricts which buckets or actions are allowed through it. If this policy is too restrictive, your pipeline's write requests (PutObject calls) get denied. Instead of saving money, the pipeline breaks after the supposed fix.

**Prevention:** Use the default policy (which allows all access) unless you have a specific security reason to restrict it. If you add a custom policy, test it against the application's actual S3 operations before applying it in production.

## SOP Best Practices

- Whenever you set up a private network (VPC) with private subnets, add S3 and DynamoDB gateway endpoints from the start. They cost nothing and prevent your servers from routing AWS-service traffic through the NAT Gateway, which charges per gigabyte.
- Set up spending alerts for NAT Gateway charges before you launch high-volume workloads. Catching a cost problem in the first week is much cheaper than discovering it three months later.
- Use network traffic logs (VPC flow logs) alongside the spending dashboard (Cost Explorer) to figure out which traffic patterns are driving NAT Gateway costs. If the traffic is going to S3 or DynamoDB, a free gateway endpoint can eliminate the charge.
- After creating a gateway endpoint, confirm the route table entry is in place, then check Cost Explorer over the next 24 hours to verify that charges dropped as expected.

## Learning Objectives

1. **Gateway endpoint mechanics**: Understand that S3 VPC gateway endpoints add a route table entry using a prefix list, routing S3 traffic directly to S3 without traversing the NAT Gateway
2. **NAT Gateway cost awareness**: Recognize that NAT Gateway data processing charges ($0.045/GB) apply to all traffic routed through it, including traffic to AWS services in the same region
3. **Cost investigation**: Practice using Cost Explorer to identify unexpected charges by filtering on service and usage type
4. **Preventive architecture**: Learn to include S3 and DynamoDB gateway endpoints as a standard part of any VPC design with private subnets

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 4: Cost-Optimized Architectures
- [[catalog]] -- nat-gateway, s3, vpc, cloudwatch service entries
