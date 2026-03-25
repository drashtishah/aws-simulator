---
tags:
  - type/simulation
  - service/nat-gateway
  - service/s3
  - service/vpc
  - service/cloudwatch
  - difficulty/starter
  - category/cost
---

# Nine Hundred Dollars for Nothing

## Opening

The bill for March was $31,400. In February it had been $30,200. Nobody looked at the line items until the finance lead asked about a $907 charge on a single day. It was labeled "NAT Gateway -- Data Processing."

Fieldspar Analytics processes sensor data from industrial equipment. Twelve thousand sensors across forty-two manufacturing plants, each reporting every thirty seconds. The data arrives at an ingestion layer on EC2 instances in a private subnet, gets transformed, and is written to an S3 bucket in the same region. About 500 gigabytes per day. The pipeline has been running since January.

The company is fourteen engineers. Series A funding closed in November. The infrastructure was built quickly, during a two-week sprint before the first customer demo. A VPC with public and private subnets, a NAT Gateway for outbound internet access, an S3 bucket for the data lake. Standard architecture. Nobody questioned it.

The finance lead is named Ren. She does not work in engineering. She opened the Cost Explorer because the board asked for a runway update. She filtered by service and found that NAT Gateway charges were $907.20 on March 18th alone. She checked the prior days. The number was roughly the same every day. She checked February. Same. She checked January. Same.

She multiplied $907 by 90 days and sent the number to the engineering channel without commentary. $27,135 in NAT Gateway data processing charges since the pipeline went live. The S3 bucket is in us-east-1. The VPC is in us-east-1. The data never leaves AWS.

The pipeline runs on three c5.2xlarge instances in the private subnet. They write to S3 using the AWS SDK. The route table for the private subnet sends all traffic to the NAT Gateway. There is no other path to S3.

You have been asked to find why the NAT Gateway charges are so high and how to eliminate them.

## Resolution

The private subnet's route table had a single non-local route: 0.0.0.0/0 pointing to the NAT Gateway. Every byte sent to S3 traveled from the EC2 instances through the NAT Gateway, through the internet gateway, and then to S3. The NAT Gateway charged $0.045 for each of those gigabytes. Five hundred gigabytes per day, every day, for three months.

The fix was to create an S3 VPC gateway endpoint. Gateway endpoints are free. They add an entry to the route table using an S3 prefix list, so that traffic destined for S3 in the region bypasses the NAT Gateway entirely and routes directly through the endpoint within the AWS network.

After the endpoint was created and the route table updated, the NAT Gateway data processing charges dropped to $1.56 per day -- the hourly charge for the gateway itself, which still handled non-S3 outbound traffic. The daily savings were $905.64. The monthly savings were approximately $27,000.

Ren updated the runway spreadsheet. The board did not need to know the details.
