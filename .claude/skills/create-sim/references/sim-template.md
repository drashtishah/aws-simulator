---
tags:
  - type/reference
  - scope/sim-template
  - status/active
---

# Simulation Package Template

Gold-standard reference for the create-sim skill. Every generated simulation package must follow this structure exactly. This document contains a complete, annotated example: the S3 bucket breach at NovaPay.

---

## Package Directory Structure

```
sims/001-s3-bucket-breach/
  manifest.json        -- Machine-readable sim definition (agents, scoring, metadata)
  story.md             -- Narrative for the Narrator agent (opening, resolution)
  resolution.md        -- Root cause explanation, AWS docs, learning objectives
  artifacts/
    architecture.txt   -- REQUIRED: ASCII infrastructure diagram
    bucket-policy.json -- S3 bucket policy in native AWS format
    iam-policy.json    -- IAM policy document in native AWS format
    cloudtrail-events.json -- CloudTrail event records
    cloudwatch-logs.txt    -- CloudWatch log entries
    s3-access-logs.txt     -- S3 server access logs
    metrics.csv            -- Time-series metrics data
```

---

## 1. manifest.json

The manifest is the machine-readable definition of the simulation. The play skill reads this to configure agents, evaluate the player's resolution, and track progress.

```json
{
  "id": "001-s3-bucket-breach",
  "title": "The Midnight S3 Breach at NovaPay",
  "difficulty": 2,
  "category": "security",
  "services": ["s3", "iam", "cloudtrail"],
  "tags": ["bucket-policy", "public-access", "data-exposure", "forensics"],
  "estimated_minutes": 25,
  "prerequisites": [],
  "exam_topics": [
    "SAA-C03:Domain1:SecureAccess",
    "SAA-C03:Domain1:S3Security",
    "SCS-C02:Domain5:DataProtection"
  ],
  "company": {
    "name": "NovaPay",
    "industry": "fintech",
    "size": "Series B startup, 45 engineers"
  },
  "team": {
    "narrator": {
      "personality": "On-call SRE team lead. Terse, 3am energy. Customer-obsessed. Drops context about merchant impact between technical details.",
      "story_beats": [
        {
          "trigger": "start",
          "section": "opening"
        },
        {
          "trigger": "elapsed_minutes:5",
          "message": "Customer complaints climbing. VP of Engineering just joined the bridge call. Three merchants have emailed support about exposed transaction records."
        },
        {
          "trigger": "elapsed_minutes:10",
          "message": "Security team confirmed: a researcher posted about the exposure on Twitter 20 minutes ago. Clock is ticking on public disclosure."
        },
        {
          "trigger": "elapsed_minutes:15",
          "message": "Legal is asking for a timeline. We need root cause and remediation in the next 10 minutes or we escalate to the CEO."
        },
        {
          "trigger": "wrong_diagnosis",
          "message": "That does not match what the evidence shows. Take another look at the artifacts -- the issue is in the access controls, not the application code."
        },
        {
          "trigger": "fix_validated",
          "section": "resolution"
        }
      ],
      "hints": [
        "Have you looked at who can access that bucket?",
        "CloudTrail keeps a record of every API call. When was the bucket policy last modified?",
        "Look at the bucket policy document carefully -- who is the Principal?",
        "The Principal field is set to * -- that means anyone on the internet can read objects from this bucket."
      ],
      "max_hints_before_nudge": 3
    },
    "agents": [
      {
        "name": "s3-console",
        "service": "s3",
        "artifacts": [
          "artifacts/bucket-policy.json",
          "artifacts/s3-access-logs.txt",
          "artifacts/cloudwatch-logs.txt"
        ],
        "capabilities": [
          "describe_bucket",
          "get_bucket_policy",
          "list_objects",
          "get_bucket_acl",
          "get_public_access_block"
        ]
      },
      {
        "name": "iam-console",
        "service": "iam",
        "artifacts": [
          "artifacts/iam-policy.json"
        ],
        "capabilities": [
          "list_roles",
          "get_role_policy",
          "simulate_policy",
          "list_attached_policies"
        ]
      },
      {
        "name": "cloudtrail-console",
        "service": "cloudtrail",
        "artifacts": [
          "artifacts/cloudtrail-events.json"
        ],
        "capabilities": [
          "lookup_events",
          "get_trail_status",
          "get_event_selectors"
        ]
      }
    ]
  },
  "resolution": {
    "root_cause": "S3 bucket policy grants s3:GetObject to Principal: * -- the novapay-transaction-reports bucket is publicly readable, exposing merchant transaction data to the internet.",
    "fix_criteria": [
      {
        "id": "identify_public_policy",
        "description": "Player identifies that the bucket policy allows public access via Principal: *",
        "required": true
      },
      {
        "id": "identify_when_changed",
        "description": "Player uses CloudTrail to determine when the bucket policy was modified and by whom",
        "required": false
      },
      {
        "id": "identify_scope",
        "description": "Player determines which objects were exposed and the blast radius of the incident",
        "required": false
      },
      {
        "id": "propose_fix",
        "description": "Player proposes restricting the Principal to specific IAM roles/accounts and enabling S3 Block Public Access",
        "required": true
      }
    ],
    "learning_objectives": [
      "Difference between S3 bucket policies and IAM policies for access control",
      "Using CloudTrail for forensic investigation of API-level changes",
      "S3 Block Public Access as an account-level and bucket-level guardrail",
      "Incident response workflow: detect, contain, investigate, remediate"
    ]
  }
}
```

> [!tip] Manifest Quality Checklist
> - `id` matches the directory name exactly
> - `services` array uses slugs from `catalog.csv`
> - Every service in `services` has a corresponding agent in `team.agents`
> - `story_beats` includes at minimum `start` and `fix_validated` triggers
> - `hints` progress from vague to specific
> - `fix_criteria` has at least one `required: true` criterion
> - `exam_topics` reference real domains from `exam-topics.md`

---

## 2. story.md

The narrative file that the Narrator agent reads to the player. Must use Obsidian frontmatter with the project tag taxonomy.

```markdown
---
tags:
  - type/simulation
  - service/s3
  - service/iam
  - service/cloudtrail
  - difficulty/associate
  - category/security
---

# The Midnight S3 Breach at NovaPay

## Opening

It is 3:14 AM on a Tuesday. Your phone buzzes with a PagerDuty alert -- HIGH SEVERITY. You fumble for your glasses and read the notification: "External report: NovaPay transaction data accessible via public URL."

NovaPay is a Series B fintech startup that processes payment transactions for 2,300 small merchants across the eastern seaboard. The platform handles roughly $4.2 million in daily transaction volume. Every merchant trusts NovaPay with their customers' payment data, and that trust is the foundation of the business.

You pull up the Slack bridge channel. The night-shift SRE has already confirmed it: someone posted a link on a security research forum showing that NovaPay's transaction report files are downloadable by anyone with the URL. No authentication required. The files contain merchant names, transaction amounts, timestamps, and partial card numbers.

Three merchants have already emailed support. The VP of Engineering is on the bridge call. Legal wants a timeline. Your job as Incident Commander: figure out what happened, how long the data has been exposed, and shut it down. The clock started 20 minutes ago.

## Resolution

The team traced the exposure to a bucket policy change made six days earlier. During a routine deployment, a junior engineer modified the `novapay-transaction-reports` S3 bucket policy to grant public read access. The change was intended to allow a third-party analytics vendor temporary access to generate monthly reports, but the policy used `Principal: *` instead of the vendor's specific AWS account ID.

For six days, 14,847 transaction report files were publicly accessible. CloudTrail logs confirmed that 23 unique IP addresses accessed the bucket during the exposure window, including the security researcher who reported it and several automated web crawlers.

The immediate fix was straightforward: replace `Principal: *` with the vendor's AWS account ARN (`arn:aws:iam::112233445566:root`) and enable S3 Block Public Access at the bucket level as a guardrail against future misconfigurations. The team also enabled S3 Block Public Access at the account level for all non-public buckets and added an AWS Config rule to detect any future public bucket policies.

The post-incident review identified three contributing factors: no peer review for bucket policy changes, no automated detection of public access configurations, and no separation between production data buckets and integration buckets.
```

> [!tip] Story Quality Checklist
> - Opening creates urgency: real users affected, real business impact, time pressure
> - Company feels real: specific numbers (merchant count, transaction volume, team size)
> - Customer-obsessed language: the story is about impact on merchants, not just technical details
> - Resolution explains the full chain: who did what, when, why, and how it was fixed
> - No emojis, no fluff, no "learning moment" language -- this is an incident, not a tutorial

---

## 3. resolution.md

Post-incident learning document. Written after the player completes the simulation. References official AWS documentation.

```markdown
---
tags:
  - type/resolution
  - service/s3
  - service/iam
  - service/cloudtrail
  - difficulty/associate
  - category/security
---

# Resolution: The Midnight S3 Breach at NovaPay

## Root Cause

The S3 bucket `novapay-transaction-reports` had a bucket policy that granted `s3:GetObject` permission to `Principal: *`. This made every object in the bucket publicly readable over the internet without authentication.

The policy was modified six days prior to detection by a junior engineer (IAM user `deploy-svc-analytics`) who intended to grant temporary access to a third-party analytics vendor. Instead of scoping the Principal to the vendor's AWS account, the engineer used a wildcard principal.

## Timeline

| Time | Event |
|---|---|
| Day -6, 14:22 UTC | `deploy-svc-analytics` calls `PutBucketPolicy` with Principal: * |
| Day -6 to Day 0 | 14,847 objects publicly accessible; 23 unique IPs access the bucket |
| Day 0, 03:02 UTC | Security researcher posts public URL on forum |
| Day 0, 03:14 UTC | PagerDuty alert fires, Incident Commander paged |
| Day 0, 03:38 UTC | Bucket policy updated to restrict Principal to vendor account ARN |
| Day 0, 03:41 UTC | S3 Block Public Access enabled at bucket level |

## Correct Remediation

1. **Immediate**: Replace `Principal: *` with the vendor's specific account ARN
2. **Containment**: Enable S3 Block Public Access at the bucket level
3. **Prevention**: Enable S3 Block Public Access at the account level for all non-public buckets
4. **Detection**: Add AWS Config rule `s3-bucket-public-read-prohibited` for continuous monitoring
5. **Process**: Require peer review for any bucket policy changes via CI/CD pipeline checks

## Key Concepts

### S3 Bucket Policies vs IAM Policies

S3 bucket policies are resource-based policies attached directly to the bucket. They can grant access to any AWS principal, including anonymous users (Principal: *). IAM policies are identity-based and can only grant permissions to the IAM entity they are attached to. For cross-account or public access scenarios, bucket policies are the primary mechanism -- and the primary risk.

### S3 Block Public Access

S3 Block Public Access is a set of four independent controls that override bucket policies and ACLs to prevent public access:

- `BlockPublicAcls` -- rejects PUT requests that include public ACLs
- `IgnorePublicAcls` -- ignores existing public ACLs on the bucket
- `BlockPublicPolicy` -- rejects bucket policies that grant public access
- `RestrictPublicBuckets` -- restricts access to bucket with public policies to authorized users only

These can be set at the account level (applies to all buckets) or individual bucket level.

### CloudTrail for Forensics

CloudTrail logs every S3 management API call (PutBucketPolicy, DeleteBucketPolicy, etc.) and optionally data events (GetObject, PutObject). For forensic investigation:

- Management events show WHO changed the policy and WHEN
- S3 data events (if enabled) show WHO accessed objects and from WHERE
- CloudTrail log file validation ensures logs have not been tampered with

## AWS Documentation Links

- [S3 Bucket Policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [CloudTrail S3 Data Events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html)
- [IAM Policy Evaluation Logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)

## Learning Objectives

1. **S3 access control model**: Understand how bucket policies, IAM policies, ACLs, and Block Public Access interact to determine effective permissions
2. **CloudTrail forensics**: Use CloudTrail to reconstruct the timeline of an incident by querying management and data events
3. **Defense in depth**: Apply multiple layers of protection -- Block Public Access as a guardrail, Config rules for detection, policy review processes for prevention
4. **Incident response**: Follow the detect-contain-investigate-remediate workflow under time pressure

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[catalog]] -- s3, iam, cloudtrail service entries
```

> [!tip] Resolution Quality Checklist
> - Root cause is specific and technical, not vague
> - Timeline has UTC timestamps and references specific API calls
> - Remediation is ordered: immediate, containment, prevention, detection, process
> - Key concepts are explained at the right depth for the sim difficulty level
> - AWS documentation links point to real, current documentation pages
> - Learning objectives are concrete and testable

---

## 4. Artifact Files

Every artifact must be in its native AWS format. No markdown wrappers. The play skill serves these files directly to the player when they query a service agent.

### artifacts/architecture.txt (REQUIRED for every sim)

ASCII diagram of the infrastructure. Shows the components involved in the incident and their relationships.

```
                                    +------------------+
                                    |   Internet       |
                                    +--------+---------+
                                             |
                                    +--------v---------+
                                    | CloudFront       |
                                    | (d1a2b3c4.cf.net)|
                                    +--------+---------+
                                             |
                               +-------------+-------------+
                               |                           |
                      +--------v---------+       +---------v--------+
                      | ALB              |       | S3 Bucket        |
                      | novapay-prod-alb |       | novapay-txn-rpts |
                      +--------+---------+       | [PUBLIC ACCESS]  |
                               |                 +------------------+
                      +--------v---------+         ^
                      | ECS Cluster      |         | PutObject
                      | novapay-prod     |         | (daily reports)
                      | +--------------+ |         |
                      | | txn-service  +-----------+
                      | +--------------+ |
                      +--------+---------+
                               |
                      +--------v---------+
                      | RDS PostgreSQL   |
                      | novapay-prod-db  |
                      | (Multi-AZ)       |
                      +------------------+

  IAM Role: novapay-ecs-task-role
    -> Allows: s3:PutObject on novapay-txn-rpts/*
    -> Allows: rds-data:ExecuteStatement

  Bucket Policy: novapay-txn-rpts
    -> PROBLEM: Allows s3:GetObject to Principal: *

  CloudTrail: novapay-prod-trail
    -> Logging: management events (all regions)
    -> S3 data events: enabled for novapay-txn-rpts
```

> [!tip] Architecture Diagram Rules
> - Use ASCII box-drawing characters (`+`, `-`, `|`, `>`, `v`, `^`)
> - Label every component with its actual resource name
> - Mark the problem area clearly (e.g., `[PUBLIC ACCESS]`)
> - Include IAM roles and their permissions as annotations below the diagram
> - Show data flow direction with arrows

### artifacts/bucket-policy.json

Native AWS bucket policy JSON format. This is what `aws s3api get-bucket-policy` returns.

```json
{
  "Version": "2012-10-17",
  "Id": "NovaPay-TxnReports-Policy",
  "Statement": [
    {
      "Sid": "AllowECSTaskRole",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::498231746283:role/novapay-ecs-task-role"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::novapay-transaction-reports/*"
    },
    {
      "Sid": "AllowAnalyticsVendorRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::novapay-transaction-reports/*"
    }
  ]
}
```

> [!note] The vulnerability
> The second statement's `"Principal": "*"` is the root cause. The Sid suggests the intent was vendor-specific access, but `*` grants it to everyone. A correct policy would use `"Principal": {"AWS": "arn:aws:iam::112233445566:root"}` with the vendor's actual account ID.

### artifacts/iam-policy.json

IAM policy document format. This represents the ECS task role's permissions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ReportUpload",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::novapay-transaction-reports/*"
    },
    {
      "Sid": "AllowRDSDataAccess",
      "Effect": "Allow",
      "Action": [
        "rds-data:ExecuteStatement",
        "rds-data:BatchExecuteStatement"
      ],
      "Resource": "arn:aws:rds:us-east-1:498231746283:cluster:novapay-prod-db"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:498231746283:log-group:/ecs/novapay-txn-service:*"
    }
  ]
}
```

> [!note] Why include this
> The IAM policy is a red herring for less experienced players -- it looks like it could be the access control issue, but it only grants write access. The bucket policy (a resource-based policy) is the actual problem. This teaches the difference between identity-based and resource-based policies.

### artifacts/cloudtrail-events.json

CloudTrail event record format. This is what `aws cloudtrail lookup-events` returns. Shows the policy change and subsequent access.

```json
{
  "Events": [
    {
      "EventId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "EventName": "PutBucketPolicy",
      "ReadOnly": "false",
      "EventTime": "2026-03-18T14:22:07Z",
      "EventSource": "s3.amazonaws.com",
      "Username": "deploy-svc-analytics",
      "Resources": [
        {
          "ResourceType": "AWS::S3::Bucket",
          "ResourceName": "novapay-transaction-reports"
        }
      ],
      "CloudTrailEvent": "{\"eventVersion\":\"1.09\",\"userIdentity\":{\"type\":\"IAMUser\",\"principalId\":\"AIDAJQABLZS4A3QDU576Q\",\"arn\":\"arn:aws:iam::498231746283:user/deploy-svc-analytics\",\"accountId\":\"498231746283\",\"userName\":\"deploy-svc-analytics\"},\"eventTime\":\"2026-03-18T14:22:07Z\",\"eventSource\":\"s3.amazonaws.com\",\"eventName\":\"PutBucketPolicy\",\"awsRegion\":\"us-east-1\",\"sourceIPAddress\":\"10.0.4.82\",\"userAgent\":\"aws-cli/2.15.30 Python/3.11.8\",\"requestParameters\":{\"bucketName\":\"novapay-transaction-reports\",\"bucketPolicy\":{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"AllowECSTaskRole\",\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::498231746283:role/novapay-ecs-task-role\"},\"Action\":\"s3:PutObject\",\"Resource\":\"arn:aws:s3:::novapay-transaction-reports/*\"},{\"Sid\":\"AllowAnalyticsVendorRead\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::novapay-transaction-reports/*\"}]}},\"responseElements\":null,\"requestID\":\"8B2CFA1E03F5B842\",\"eventID\":\"a1b2c3d4-e5f6-7890-abcd-ef1234567890\",\"eventType\":\"AwsApiCall\",\"recipientAccountId\":\"498231746283\"}"
    },
    {
      "EventId": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
      "EventName": "GetObject",
      "ReadOnly": "true",
      "EventTime": "2026-03-24T02:58:14Z",
      "EventSource": "s3.amazonaws.com",
      "Username": "ANONYMOUS_PRINCIPAL",
      "Resources": [
        {
          "ResourceType": "AWS::S3::Object",
          "ResourceName": "novapay-transaction-reports/reports/2026/03/merchant-txn-20260323.csv"
        }
      ],
      "CloudTrailEvent": "{\"eventVersion\":\"1.09\",\"userIdentity\":{\"type\":\"AWSAccount\",\"principalId\":\"ANONYMOUS_PRINCIPAL\",\"accountId\":\"ANONYMOUS_PRINCIPAL\"},\"eventTime\":\"2026-03-24T02:58:14Z\",\"eventSource\":\"s3.amazonaws.com\",\"eventName\":\"GetObject\",\"awsRegion\":\"us-east-1\",\"sourceIPAddress\":\"203.0.113.42\",\"userAgent\":\"Mozilla/5.0\",\"requestParameters\":{\"bucketName\":\"novapay-transaction-reports\",\"key\":\"reports/2026/03/merchant-txn-20260323.csv\"},\"responseElements\":null,\"requestID\":\"9C3DFB2F14G6C953\",\"eventID\":\"f9e8d7c6-b5a4-3210-fedc-ba0987654321\",\"eventType\":\"AwsApiCall\",\"recipientAccountId\":\"498231746283\"}"
    }
  ]
}
```

> [!tip] CloudTrail artifact rules
> - First event should show the ROOT CAUSE action (the misconfiguration)
> - Subsequent events show the IMPACT (unauthorized access)
> - `ANONYMOUS_PRINCIPAL` indicates unauthenticated access -- a strong signal
> - Include the full `CloudTrailEvent` JSON string for realism
> - Use realistic timestamps that match the story timeline

### artifacts/cloudwatch-logs.txt

CloudWatch Logs format. These are application-level logs showing the transaction service in normal operation, providing context but not directly revealing the root cause.

```
2026-03-24T03:02:17.342Z INFO  [novapay-txn-service] Report generation completed: merchant-txn-20260323.csv (2,847 records, 4.2MB)
2026-03-24T03:02:17.891Z INFO  [novapay-txn-service] Uploaded to s3://novapay-transaction-reports/reports/2026/03/merchant-txn-20260323.csv
2026-03-24T03:02:18.104Z INFO  [novapay-txn-service] S3 PutObject response: 200 OK, ETag: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
2026-03-24T03:14:02.556Z WARN  [novapay-alert-handler] External security report received via support channel
2026-03-24T03:14:02.891Z WARN  [novapay-alert-handler] Report claims public access to transaction data -- escalating to on-call
2026-03-24T03:14:03.112Z INFO  [novapay-alert-handler] PagerDuty incident created: INC-20260324-0314 (HIGH severity)
2026-03-24T03:18:42.773Z INFO  [novapay-txn-service] Health check: OK (db_connection: healthy, s3_write: healthy, queue_depth: 0)
2026-03-24T03:22:15.209Z WARN  [novapay-support-api] 3 merchant support tickets opened in last 15 minutes (avg: 0.1/hr at this time)
2026-03-24T03:25:33.441Z INFO  [novapay-txn-service] Health check: OK (db_connection: healthy, s3_write: healthy, queue_depth: 0)
```

> [!tip] CloudWatch log rules
> - ISO 8601 timestamps with milliseconds
> - Log level: INFO, WARN, ERROR, DEBUG
> - Service/component tag in brackets
> - Logs should provide CONTEXT, not hand the answer to the player
> - Include normal operational logs alongside alert-related entries
> - Timestamps must be consistent with the story timeline

### artifacts/s3-access-logs.txt

S3 server access log format. Each line is a space-delimited record showing who accessed the bucket.

```
498231746283 novapay-transaction-reports [24/Mar/2026:02:41:08 +0000] 203.0.113.42 - REST.GET.OBJECT reports/2026/03/merchant-txn-20260322.csv "GET /novapay-transaction-reports/reports/2026/03/merchant-txn-20260322.csv HTTP/1.1" 200 - 4418203 4418203 31 29 "-" "Mozilla/5.0 (compatible; SecurityResearchBot/1.0)" -
498231746283 novapay-transaction-reports [24/Mar/2026:02:43:22 +0000] 198.51.100.17 - REST.GET.OBJECT reports/2026/03/merchant-txn-20260321.csv "GET /novapay-transaction-reports/reports/2026/03/merchant-txn-20260321.csv HTTP/1.1" 200 - 4102847 4102847 28 26 "-" "python-requests/2.31.0" -
498231746283 novapay-transaction-reports [24/Mar/2026:02:58:14 +0000] 203.0.113.42 - REST.GET.OBJECT reports/2026/03/merchant-txn-20260323.csv "GET /novapay-transaction-reports/reports/2026/03/merchant-txn-20260323.csv HTTP/1.1" 200 - 4521093 4521093 33 30 "-" "Mozilla/5.0" -
498231746283 novapay-transaction-reports [24/Mar/2026:03:02:17 +0000] - arn:aws:iam::498231746283:role/novapay-ecs-task-role REST.PUT.OBJECT reports/2026/03/merchant-txn-20260323.csv "PUT /novapay-transaction-reports/reports/2026/03/merchant-txn-20260323.csv HTTP/1.1" 200 - - 4521093 142 18 "-" "aws-sdk-java/2.20.126" -
498231746283 novapay-transaction-reports [24/Mar/2026:03:15:44 +0000] 192.0.2.88 - REST.GET.OBJECT reports/2026/03/merchant-txn-20260320.csv "GET /novapay-transaction-reports/reports/2026/03/merchant-txn-20260320.csv HTTP/1.1" 200 - 3987621 3987621 25 23 "-" "curl/8.5.0" -
```

> [!tip] S3 access log rules
> - Space-delimited, one record per line
> - External IPs with no IAM principal = anonymous access (the smoking gun)
> - Internal access shows the IAM role ARN
> - Mix of external (unauthorized) and internal (legitimate) access to show contrast
> - HTTP response 200 confirms objects were successfully retrieved
> - User-Agent strings hint at the type of accessor (researcher, bot, script)

### artifacts/metrics.csv

Time-series metrics in CSV format. Shows the spike in unauthorized access.

```csv
timestamp,metric_name,value,unit
2026-03-23T00:00:00Z,s3_get_requests,12,Count
2026-03-23T06:00:00Z,s3_get_requests,8,Count
2026-03-23T12:00:00Z,s3_get_requests,15,Count
2026-03-23T18:00:00Z,s3_get_requests,11,Count
2026-03-24T00:00:00Z,s3_get_requests,47,Count
2026-03-24T01:00:00Z,s3_get_requests,89,Count
2026-03-24T02:00:00Z,s3_get_requests,234,Count
2026-03-24T03:00:00Z,s3_get_requests,412,Count
2026-03-23T00:00:00Z,s3_4xx_errors,0,Count
2026-03-23T06:00:00Z,s3_4xx_errors,0,Count
2026-03-23T12:00:00Z,s3_4xx_errors,0,Count
2026-03-23T18:00:00Z,s3_4xx_errors,0,Count
2026-03-24T00:00:00Z,s3_4xx_errors,0,Count
2026-03-24T01:00:00Z,s3_4xx_errors,0,Count
2026-03-24T02:00:00Z,s3_4xx_errors,0,Count
2026-03-24T03:00:00Z,s3_4xx_errors,0,Count
2026-03-23T00:00:00Z,bytes_downloaded,49832,Bytes
2026-03-23T06:00:00Z,bytes_downloaded,33104,Bytes
2026-03-23T12:00:00Z,bytes_downloaded,62440,Bytes
2026-03-23T18:00:00Z,bytes_downloaded,45628,Bytes
2026-03-24T00:00:00Z,bytes_downloaded,195274,Bytes
2026-03-24T01:00:00Z,bytes_downloaded,371893,Bytes
2026-03-24T02:00:00Z,bytes_downloaded,978412,Bytes
2026-03-24T03:00:00Z,bytes_downloaded,1723847,Bytes
```

> [!tip] Metrics artifact rules
> - CSV format: timestamp, metric_name, value, unit
> - ISO 8601 timestamps
> - Include a visible anomaly that correlates with the incident timeline
> - Zero 4xx errors confirms the access was authorized by policy (not blocked)
> - Bytes downloaded metric shows the scale of data exposure
> - Normal baseline values followed by the spike tells the story

---

## Quality Standards

### Company Names

Good: NovaPay, Meridian Health Systems, TidePool Analytics, Greenline Logistics, Arclight Media
Bad: Acme Corp, Test Company, Example Inc, FooBar LLC

### Narrative Voice

Good: "Three merchants have emailed support about exposed transaction records."
Bad: "Some data might have been accessed by unauthorized users."

Good: "Your phone buzzes with a PagerDuty alert at 3:14 AM."
Bad: "An alert was generated by the monitoring system."

### AWS Vocabulary

Good: "S3 bucket policy grants s3:GetObject to Principal: *"
Bad: "The S3 permissions are set to public"

Good: "CloudTrail shows PutBucketPolicy called by deploy-svc-analytics"
Bad: "The logs show someone changed the bucket settings"

### Difficulty Calibration

| Level | Services | Root Cause | Red Herrings | Expected Time |
|---|---|---|---|---|
| 1 | 1-2 | Obvious in first artifact | None | 10-15 min |
| 2 | 2-3 | Requires correlating 2 artifacts | 1 (e.g., IAM policy) | 20-30 min |
| 3 | 3-5 | Multi-service cascade, timeline reconstruction | 2-3 | 30-45 min |
| 4 | 4-6 | Subtle misconfiguration, misleading metrics | 3-4 | 45-60 min |

## Related

- [[exam-topics]] -- Exam domain coverage reference
- [[manifest-schema.json]] -- JSON Schema for manifest validation
