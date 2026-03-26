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

1. **Create S3 VPC gateway endpoint**:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0a1b2c3d4e5f67890 \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0d4e5f6a7b8c9d0e1
```

2. **Verify route table entry**: After creation, the route table should contain a new entry with destination `pl-63a5400a` (the S3 prefix list for us-east-1) pointing to the VPC endpoint `vpce-xxxxxxxxxxxxxxxxx`. S3-bound traffic now bypasses the NAT Gateway.

3. **Verify pipeline functionality**: Confirm the data pipeline continues writing to S3 without errors. Gateway endpoints are transparent to the application -- no SDK or code changes are required.

4. **Consider DynamoDB gateway endpoint**: If any workloads in the private subnet access DynamoDB, create a gateway endpoint for DynamoDB as well:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0a1b2c3d4e5f67890 \
  --service-name com.amazonaws.us-east-1.dynamodb \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0d4e5f6a7b8c9d0e1
```

5. **Set up billing alerts**: Create a CloudWatch billing alarm for NAT Gateway charges exceeding a threshold (e.g., $50/day) to catch similar issues in the future.

6. **Audit other subnets**: Check all private subnets for high-volume AWS service traffic that could benefit from gateway endpoints.

## Key Concepts

### VPC Gateway Endpoints vs Interface Endpoints

- **Gateway endpoints** are available for S3 and DynamoDB only. They are free. They work by adding a route table entry that directs traffic for the service's prefix list to the endpoint. Traffic stays on the AWS private network.
- **Interface endpoints** (powered by AWS PrivateLink) are available for most other AWS services. They cost $0.01/hour per AZ plus $0.01/GB of data processed. They create an elastic network interface in the subnet with a private IP address.
- For S3 and DynamoDB, gateway endpoints are almost always the correct choice due to zero cost.

### NAT Gateway Pricing Model

- **Hourly charge**: $0.045/hour (~$1.08/day, ~$32.40/month) per NAT Gateway, regardless of usage.
- **Data processing charge**: $0.045/GB for all data processed through the NAT Gateway, in both directions. This is the charge that adds up with high-volume workloads.
- NAT Gateway does not distinguish between traffic destined for the internet and traffic destined for AWS services. All traffic routed through it incurs the data processing charge.

### Route Table Entries for Gateway Endpoints

When a gateway endpoint is created and associated with a route table, AWS automatically adds a route entry. The destination is a prefix list (e.g., `pl-63a5400a` for S3 in us-east-1) and the target is the endpoint ID. This route is more specific than the `0.0.0.0/0` default route, so S3 traffic matches the prefix list route first and bypasses the NAT Gateway.

### Why Gateway Endpoints Are Free

Gateway endpoints are a route table modification, not a separate piece of infrastructure. There is no elastic network interface, no hourly charge, and no data processing charge. AWS provides them at no cost because they reduce load on NAT Gateways and internet gateways, and keep traffic on the AWS backbone network.

## Other Ways This Could Break

### Gateway endpoint created but not associated with the correct route table

The endpoint exists but the private subnet route table still has no prefix list entry for S3. Traffic continues through the NAT Gateway because the endpoint was associated with a different route table, such as the public subnet route table. This looks like the fix was applied but costs do not decrease.

**Prevention:** When creating a gateway endpoint, explicitly specify `--route-table-ids` for every private subnet route table that needs the S3 route. Verify with `aws ec2 describe-route-tables` that the prefix list entry appears in each target route table.

### Cross-region S3 access through NAT Gateway

A gateway endpoint only routes traffic to S3 buckets in the same region as the VPC. If the pipeline writes to an S3 bucket in a different region, the traffic still goes through the NAT Gateway and incurs data processing charges plus cross-region data transfer fees. The cost reduction from the endpoint is zero.

**Prevention:** Ensure S3 buckets accessed from private subnets are in the same region as the VPC. If cross-region access is required, understand that gateway endpoints will not help and budget for NAT Gateway and data transfer costs.

### VPC endpoint policy blocks the application

A custom endpoint policy is attached to the gateway endpoint that restricts access to specific buckets or actions. The pipeline's PutObject calls are denied by the policy, causing write failures instead of cost savings. The pipeline breaks after the supposed fix.

**Prevention:** Use the default endpoint policy (full access) unless there is a specific security requirement. If a custom policy is needed, test it against the application's actual S3 API calls before applying to production.

## SOP Best Practices

- Include S3 and DynamoDB gateway endpoints as a standard part of any VPC design with private subnets -- they are free and eliminate unnecessary NAT Gateway charges
- Set up billing alerts for NAT Gateway data processing charges early, before high-volume workloads go live, to catch cost anomalies within days instead of months
- Use VPC flow logs and Cost Explorer together to identify which traffic patterns are driving NAT Gateway costs and whether they can be routed through endpoints instead
- After creating a gateway endpoint, verify the route table entry and monitor Cost Explorer to confirm the expected cost reduction within 24 hours

## Learning Objectives

1. **Gateway endpoint mechanics**: Understand that S3 VPC gateway endpoints add a route table entry using a prefix list, routing S3 traffic directly to S3 without traversing the NAT Gateway
2. **NAT Gateway cost awareness**: Recognize that NAT Gateway data processing charges ($0.045/GB) apply to all traffic routed through it, including traffic to AWS services in the same region
3. **Cost investigation**: Practice using Cost Explorer to identify unexpected charges by filtering on service and usage type
4. **Preventive architecture**: Learn to include S3 and DynamoDB gateway endpoints as a standard part of any VPC design with private subnets

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 4: Cost-Optimized Architectures
- [[catalog]] -- nat-gateway, s3, vpc, cloudwatch service entries
