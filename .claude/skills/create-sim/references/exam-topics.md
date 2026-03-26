---
tags:
  - type/reference
  - scope/exam-coverage
  - status/active
---

# AWS Certification Exam Topic Map

Reference for the create-sim skill. Maps exam domains, weight percentages, key services, and incident patterns suitable for simulation. Organized by certification, then by domain.

---

## SAA-C03 -- Solutions Architect Associate

### Domain 1: Design Secure Architectures (30%)

**Key Services:** AWS IAM, Amazon S3, AWS KMS, Amazon VPC, Security Groups, Network ACLs, AWS WAF, AWS Shield, AWS CloudTrail, AWS Config, Amazon Cognito, AWS Secrets Manager, AWS Certificate Manager, AWS STS

**Incident Patterns (Difficulty 1-2):**
1. S3 bucket policy grants `s3:GetObject` to `Principal: *` -- publicly readable bucket exposing customer data
2. IAM role attached to EC2 instance has `AdministratorAccess` -- overly permissive policy discovered during audit
3. Security group allows inbound SSH (port 22) from `0.0.0.0/0` on a production database instance
4. KMS key policy allows cross-account access to an unknown external AWS account
5. CloudTrail logging disabled in a production region -- compliance violation discovered during SOC 2 prep

### Domain 2: Design Resilient Architectures (26%)

**Key Services:** Amazon EC2, Elastic Load Balancing, AWS Auto Scaling, Amazon RDS, Amazon Aurora, Amazon DynamoDB, Amazon SQS, Amazon Route 53, Amazon S3, Amazon EBS, Amazon EFS, AWS Backup

**Incident Patterns (Difficulty 1-2):**
1. Single-AZ RDS instance fails during AZ outage -- application completely unavailable, no read replica configured
2. Auto Scaling group minimum set to 1, instance terminated during deployment -- zero-capacity event
3. Route 53 health check misconfigured -- failover to secondary region never triggers during primary outage
4. EBS volume runs out of provisioned IOPS -- database latency spikes during peak traffic
5. SQS dead-letter queue not configured -- failed messages silently lost, orders never processed

### Domain 3: Design High-Performing Architectures (24%)

**Key Services:** Amazon CloudFront, Amazon ElastiCache, Amazon DynamoDB, Amazon Aurora, Amazon EBS, AWS Global Accelerator, Amazon API Gateway, AWS Lambda, Amazon Kinesis, Amazon SQS, Amazon SNS

**Incident Patterns (Difficulty 2-3):**
1. CloudFront distribution serving stale content after deployment -- cache invalidation not performed, TTL set to 24 hours
2. DynamoDB table throttled during flash sale -- provisioned capacity exceeded, on-demand not enabled
3. Lambda function hitting 15-minute timeout processing large files -- architecture not suited for long-running tasks
4. ElastiCache eviction rate spiking -- cache node undersized, hot key problem causing cascade to database
5. API Gateway 429 throttling errors during product launch -- default throttle limits not adjusted

### Domain 4: Design Cost-Optimized Architectures (20%)

**Key Services:** Amazon EC2, AWS Lambda, Amazon S3, Amazon RDS, Amazon DynamoDB, AWS Auto Scaling, Amazon CloudWatch, AWS Cost Explorer, AWS Trusted Advisor, Reserved Instances, Savings Plans

**Incident Patterns (Difficulty 1-2):**
1. Forgotten EC2 instances running in non-production account -- $14,000/month bill discovered during quarterly review
2. S3 bucket with 50TB of uncompressed logs, no lifecycle policy -- storage costs growing 20% month-over-month
3. RDS Multi-AZ db.r5.4xlarge running a development database -- 10x over-provisioned for actual workload
4. Lambda functions with 3GB memory allocation processing simple API calls -- cost per invocation unnecessarily high
5. NAT Gateway processing 8TB/month of traffic to S3 -- should be using VPC gateway endpoint

---

## SAP-C02 -- Solutions Architect Professional

### Domain 1: Design Solutions for Organizational Complexity (26%)

**Key Services:** AWS Organizations, AWS Control Tower, AWS RAM, AWS Service Catalog, AWS CloudFormation, AWS Config, AWS IAM (cross-account), AWS STS, AWS Transit Gateway, AWS Direct Connect

**Incident Patterns (Difficulty 3-4):**
1. Service Control Policy (SCP) accidentally blocks `iam:CreateRole` in production OU -- deployment pipeline broken across 12 accounts
2. Cross-account IAM role trust policy too broad -- any principal in the trusted account can assume the role
3. Transit Gateway route table misconfigured after account onboarding -- new VPC cannot reach shared services
4. Control Tower guardrail drift detected -- mandatory guardrail disabled in a member account
5. CloudFormation StackSets failing in 3 out of 20 target accounts -- concurrent execution limit exceeded

### Domain 2: Design for New Solutions (29%)

**Key Services:** Amazon ECS, Amazon EKS, AWS Fargate, AWS Lambda, Amazon API Gateway, AWS Step Functions, Amazon DynamoDB, Amazon Aurora, Amazon SQS, Amazon SNS, Amazon EventBridge, AWS AppSync, Amazon Kinesis

**Incident Patterns (Difficulty 3-4):**
1. ECS service running on Fargate hitting ENI limits in subnet -- tasks stuck in PROVISIONING, no available IP addresses
2. Step Functions execution fails silently at Map state -- partial batch processing with no error handling or compensation
3. EventBridge rule target Lambda function throttled -- events backed up, order processing delayed by 45 minutes
4. Aurora cluster failover takes 90 seconds -- connection strings hardcoded to writer endpoint, application not using cluster endpoint
5. API Gateway WebSocket connections dropping after 10 minutes -- idle timeout not communicated to frontend team

### Domain 3: Migration Planning (25%)

**Key Services:** AWS DMS, AWS Snow Family, AWS DataSync, AWS Transfer Family, AWS Migration Hub, AWS Application Discovery Service, AWS Storage Gateway, AWS Direct Connect, Amazon S3

**Incident Patterns (Difficulty 3-4):**
1. DMS replication task fails during cutover -- source database schema change not reflected in task mapping
2. Direct Connect link saturated during migration -- production traffic competing with bulk data transfer
3. Storage Gateway cache disk full -- on-premises application writes stalling, NFS mounts timing out
4. DataSync task transferring 200TB discovers 2 million files with special characters -- task fails at 60% completion
5. Snow Edge device returned with encryption key not escrowed -- data unrecoverable, migration must restart

### Domain 4: Cost Control (20%)

**Key Services:** AWS Cost Explorer, AWS Budgets, AWS Trusted Advisor, Amazon S3 (storage classes), Reserved Instances, Savings Plans, AWS Compute Optimizer, Amazon CloudWatch

**Incident Patterns (Difficulty 2-3):**
1. Reserved Instance purchased in wrong region -- $180,000 annual commitment providing zero savings
2. Savings Plans coverage at 40% -- workload shifted from EC2 to Fargate but Compute Savings Plan was not selected
3. S3 Intelligent-Tiering monitoring charges exceeding storage savings for millions of small objects
4. Cross-region data transfer costs spiking after enabling multi-region replication -- $8,000/month unexpected charge
5. CloudWatch custom metrics cardinality explosion -- high-resolution metrics with unique dimensions per request

---

## DVA-C02 -- Developer Associate

### Domain 1: Development with AWS Services (32%)

**Key Services:** AWS Lambda, Amazon API Gateway, Amazon DynamoDB, Amazon S3, Amazon SQS, Amazon SNS, AWS Step Functions, Amazon EventBridge, AWS AppSync, Amazon Cognito

**Incident Patterns (Difficulty 1-2):**
1. Lambda function cold starts causing API Gateway 504 timeouts -- provisioned concurrency not configured for customer-facing endpoint
2. DynamoDB `ConditionalCheckFailedException` flooding logs -- race condition in concurrent writes to same partition key
3. SQS message visibility timeout shorter than Lambda processing time -- messages processed multiple times
4. API Gateway binary media types not configured -- file uploads returning corrupted data
5. S3 pre-signed URL expired before large file upload completes -- multipart upload not implemented

### Domain 2: Security (26%)

**Key Services:** AWS IAM, Amazon Cognito, AWS KMS, AWS Secrets Manager, AWS STS, AWS Certificate Manager, AWS Systems Manager Parameter Store, AWS WAF

**Incident Patterns (Difficulty 2-3):**
1. Cognito User Pool token expiry misconfigured -- users forced to re-login every 5 minutes, customer complaints spike
2. Secrets Manager rotation Lambda function fails -- database password rotated in Secrets Manager but not in RDS, application cannot connect
3. IAM policy condition `aws:SourceIp` blocks Lambda execution -- Lambda does not originate from the expected IP range
4. Parameter Store SecureString parameter cannot be read by Lambda -- missing `kms:Decrypt` permission on the CMK
5. STS `AssumeRole` call fails with `AccessDenied` -- trust policy requires `ExternalId` that the calling code does not supply

### Domain 3: Deployment (24%)

**Key Services:** AWS CodePipeline, AWS CodeBuild, AWS CodeDeploy, AWS CloudFormation, AWS Elastic Beanstalk, Amazon ECS, AWS SAM, AWS CDK

**Incident Patterns (Difficulty 2-3):**
1. CodeDeploy blue/green deployment stuck in `Ready` state -- load balancer health check path returns 404 on new target group
2. CloudFormation stack UPDATE_ROLLBACK_FAILED -- resource that was manually modified outside CloudFormation
3. CodeBuild timeout during `npm install` -- build environment has no internet access, VPC configuration missing NAT Gateway
4. Elastic Beanstalk rolling deployment causes 50% capacity drop -- batch size too large for minimum healthy instances
5. CodePipeline source action fails after repository branch rename -- branch reference still points to `master` instead of `main`

### Domain 4: Troubleshooting and Optimization (18%)

**Key Services:** Amazon CloudWatch, AWS X-Ray, AWS CloudTrail, Amazon CloudWatch Logs, AWS Lambda (performance), Amazon DynamoDB (optimization), Amazon ElastiCache

**Incident Patterns (Difficulty 2-3):**
1. X-Ray traces show 2-second latency in DynamoDB query -- scan operation instead of query, missing GSI for access pattern
2. CloudWatch Logs Insights query returns no results -- log group retention set to 1 day, logs already expired
3. Lambda function memory at 128MB processing images -- OOM kills causing silent retries, duplicate processing
4. CloudWatch alarm in INSUFFICIENT_DATA state -- metric namespace typo, alarm evaluating a metric that does not exist
5. ElastiCache connection pool exhausted -- application not releasing Redis connections after use

---

## SCS-C02 -- Security Specialty

### Domain 1: Threat Detection and Incident Response (14%)

**Key Services:** Amazon GuardDuty, AWS Security Hub, Amazon Detective, AWS CloudTrail, Amazon CloudWatch, AWS Config, Amazon EventBridge

**Incident Patterns (Difficulty 2-3):**
1. GuardDuty finding `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration` -- EC2 instance credentials used from external IP
2. CloudTrail shows `ConsoleLogin` from unusual geographic location with no MFA -- potential compromised root credentials
3. Security Hub aggregation failing for member accounts -- cross-region finding aggregation not enabled
4. CloudWatch anomaly detection alert on API call volume -- 500x spike in `DescribeInstances` calls from a single IAM user
5. Config rule `restricted-ssh` non-compliant across 30 security groups -- remediation SSM document fails silently

### Domain 2: Security Logging and Monitoring (18%)

**Key Services:** AWS CloudTrail, Amazon CloudWatch Logs, Amazon S3 (access logs), VPC Flow Logs, AWS Config, Amazon OpenSearch Service, Amazon Kinesis Data Firehose

**Incident Patterns (Difficulty 2-3):**
1. CloudTrail log file validation disabled -- integrity of audit logs cannot be verified during investigation
2. VPC Flow Logs show rejected traffic on port 443 to internal service -- Network ACL deny rule overriding security group allow
3. S3 server access logs not delivered for 72 hours -- logging target bucket ACL changed, PutObject denied
4. CloudWatch Logs subscription filter to Kinesis Data Firehose throttled -- log delivery delayed by 30 minutes
5. Config delivery channel S3 bucket policy too restrictive -- configuration snapshots not being written

### Domain 3: Infrastructure Security (20%)

**Key Services:** Amazon VPC, Security Groups, Network ACLs, AWS WAF, AWS Shield, AWS Network Firewall, AWS Firewall Manager, AWS PrivateLink, NAT Gateway

**Incident Patterns (Difficulty 2-4):**
1. WAF rate-based rule blocking legitimate traffic -- threshold set too low during marketing campaign launch
2. Network Firewall stateful rule dropping valid TLS traffic -- SNI inspection failing on wildcard certificates
3. PrivateLink endpoint policy too permissive -- allows access to all actions on the service, not just intended operations
4. Shield Advanced DDoS event detected -- application layer attack bypassing Network ACL, requires WAF mitigation
5. VPC peering route table entries missing after VPC CIDR expansion -- new CIDR range not added to peer route tables

### Domain 4: Identity and Access Management (16%)

**Key Services:** AWS IAM, AWS STS, AWS Organizations (SCPs), Amazon Cognito, AWS Directory Service, AWS IAM Identity Center (SSO)

**Incident Patterns (Difficulty 2-4):**
1. IAM policy with `NotAction` and `Allow` effect -- unintentionally grants permissions to all services except the listed ones
2. SCP `Deny` on `s3:DeleteBucket` not working -- resource-level condition missing, only applies to specific OU
3. IAM Identity Center permission set propagation delay -- users cannot access newly assigned accounts for 15 minutes
4. Cognito identity pool authenticated role too permissive -- grants `s3:*` instead of scoped permissions per user
5. Cross-account role chaining fails at third hop -- `AssumeRole` maximum session duration exceeded

### Domain 5: Data Protection (18%)

**Key Services:** AWS KMS, AWS CloudHSM, AWS Certificate Manager, Amazon S3 (encryption), Amazon RDS (encryption), AWS Secrets Manager, Amazon Macie

**Incident Patterns (Difficulty 2-4):**
1. KMS key deletion scheduled with 7-day waiting period -- application using the key starts failing, 200 S3 objects unreadable
2. Macie discovers PII in S3 bucket tagged as non-sensitive -- data classification incorrect, compliance violation
3. RDS snapshot shared publicly -- encryption at rest was enabled but snapshot copy lost encryption setting
4. CloudHSM cluster node failure -- single-node cluster, no backup, application signing operations halt
5. ACM certificate auto-renewal fails -- DNS validation CNAME record deleted, HTTPS endpoints begin failing at expiry

### Domain 6: Management and Security Governance (14%)

**Key Services:** AWS Organizations, AWS Control Tower, AWS Config, AWS Trusted Advisor, AWS License Manager, AWS Service Catalog, AWS Audit Manager

**Incident Patterns (Difficulty 3-4):**
1. AWS Config conformance pack shows 47 non-compliant resources -- drift accumulated over 6 months, no automated remediation
2. Control Tower Account Factory provisioning fails -- VPC CIDR conflicts with existing account in the OU
3. Organizations SCP blocking `iam:PassRole` -- breaks CloudFormation deployments that create Lambda functions
4. Audit Manager assessment report missing evidence -- data source not configured for the required AWS Config rules
5. Service Catalog product version update not propagated -- launch constraint IAM role lacks permissions for new resources

---

## Difficulty Level Guide

| Level | Label | Description | Target Certs |
|---|---|---|---|
| 1 | Starter | Single-service, obvious misconfiguration. Root cause visible in one artifact. | SAA-C03 |
| 2 | Associate | Two to three services involved. Requires correlating evidence across artifacts. | SAA-C03, DVA-C02 |
| 3 | Professional | Multi-service cascade. Requires understanding service interactions and cross-account patterns. | SAP-C02, SCS-C02 |
| 4 | Expert | Subtle misconfiguration with misleading symptoms. Requires deep knowledge of service internals and edge cases. | SAP-C02, SCS-C02 |

## Related

- [[sim-template]] -- Gold-standard simulation package example
- [[manifest-schema.json]] -- JSON Schema for manifest validation
- [[services/catalog.csv]] -- AWS services catalog; [[learning/catalog.csv]] -- player progress
