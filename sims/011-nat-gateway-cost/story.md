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

company: Fieldspar Analytics
industry: sensor data analytics for industrial equipment, Series A (closed November), 14 engineers
product: sensor data ingestion pipeline -- 12,000 sensors across 42 manufacturing plants, each reporting every 30 seconds
scale: approximately 500 GB per day written to S3, pipeline running since January
infrastructure: VPC with public and private subnets in us-east-1, NAT Gateway for outbound internet, S3 bucket (fieldspar-sensor-lake-prod) in us-east-1, three c5.2xlarge instances in private subnet writing to S3 via AWS SDK. Built during two-week sprint before first customer demo.
time: mid-March (finance lead checking Cost Explorer for board runway update)
scene: finance lead Ren opened Cost Explorer because board asked for runway update
alert: "$907.20 in NAT Gateway data processing charges on March 18th alone -- same amount every day since January"
stakes: $27,135 in unnecessary NAT Gateway charges over 90 days, direct impact on startup runway
early_signals:
  - March bill $31,400, February $30,200, nobody looked at line items until finance lead asked
  - NAT Gateway Data Processing charge $907.20 on a single day, same every day since January
  - Ren multiplied $907 by 90 days and sent $27,135 to engineering channel without commentary
  - S3 bucket in us-east-1, VPC in us-east-1, data never leaves AWS
  - route table for private subnet sends all traffic to NAT Gateway, no other path to S3
investigation_starting_point: three c5.2xlarge instances in private subnet write 500 GB daily to S3 using AWS SDK. The route table has one non-local route: 0.0.0.0/0 to the NAT Gateway. There is no VPC endpoint. All S3 traffic passes through the NAT Gateway at $0.045 per GB.

## Resolution

root_cause: private subnet route table had a single non-local route (0.0.0.0/0 to NAT Gateway). No S3 VPC gateway endpoint existed. Every byte sent to S3 traveled from EC2 instances through the NAT Gateway, through the internet gateway, then to S3. NAT Gateway charged $0.045 per GB. 500 GB per day for three months.
mechanism: without an S3 VPC gateway endpoint, the only path from the private subnet to S3 was through the NAT Gateway. The $0.045/GB data processing charge accumulated to $907 per day on 500 GB of daily S3 traffic.
fix: create an S3 VPC gateway endpoint (free). Endpoint adds a prefix list entry to the route table so S3-bound traffic bypasses NAT Gateway and routes directly through the AWS network. After endpoint created and route table updated, NAT Gateway data processing charges dropped to $1.56 per day (hourly charge for gateway itself handling non-S3 outbound traffic). Daily savings $905.64, monthly savings approximately $27,000.
contributing_factors:
  - infrastructure built quickly during two-week sprint before first customer demo
  - no S3 VPC gateway endpoint created at VPC setup time
  - nobody examined line-item billing for three months
  - Ren updated the runway spreadsheet
