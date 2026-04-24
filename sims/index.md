---
tags:
  - type/index
  - domain/aws-simulator
---

# Simulation Catalog

| ID | Title | Difficulty | Category | Services | Time |
|---|---|---|---|---|---|
| 001 | [[001-ec2-unreachable/story\|The BrightPath Outage: Students Locked Out]] | 1 - Foundational | Networking | ec2, vpc, cloudwatch | 15 min |
| 002 | [[002-s3-public-exposure/story\|The Meridian Health Data Leak]] | 2 - Associate | Security | s3, iam, cloudtrail | 25 min |
| 003 | [[003-rds-storage-full/story\|The CropSync Harvest Crisis: Database Full]] | 1 - Foundational | Data | rds, cloudwatch, ec2 | 15 min |
| 004 | [[004-lambda-access-denied/story\|PacketForge Lambda Lockout: The Missing Permission]] | 2 - Associate | Security | lambda, iam, dynamodb, cloudwatch | 20 min |
| 005 | [[005-elb-502-errors/story\|UrbanFleet Rush Hour Meltdown: The 502 Storm]] | 2 - Associate | Reliability | elb, auto-scaling, ec2, cloudwatch | 25 min |
| 006 | [[006-wrong-region/story\|A Function in the Wrong Room]] | 1 - Foundational | Operations | lambda, cloudwatch, iam | 15 min |
| 007 | [[007-dynamodb-scan/story\|Four Million Records, One by One]] | 2 - Associate | Performance | dynamodb, cloudwatch, lambda | 25 min |
| 008 | [[008-s3-cors-presigned/story\|The Upload That Worked Everywhere Else]] | 2 - Associate | Operations | s3, cloudfront, api-gateway | 25 min |
| 009 | [[009-credential-chain/story\|Someone Else's Keys]] | 1 - Foundational | Security | iam, sts, secrets-manager | 15 min |
| 010 | [[010-cloudformation-stuck/story\|The Stack That Wouldn't Move]] | 2 - Associate | Operations | cloudformation, iam, cloudwatch | 25 min |
| 011 | [[011-nat-gateway-cost/story\|Nine Hundred Dollars for Nothing]] | 1 - Foundational | Cost | nat-gateway, s3, vpc, cloudwatch | 15 min |
| 012 | [[012-elb-flash-sale/story\|The Sale That Started Too Fast]] | 2 - Associate | Reliability | elb, auto-scaling, cloudwatch | 25 min |
| 013 | [[013-elb-target-drain/story\|The Targets That Disappeared]] | 2 - Associate | Reliability | elb, auto-scaling, ec2, cloudwatch | 25 min |
| 014 | [[014-sqs-double-process/story\|The Queue Nobody Watched]] | 2 - Associate | Reliability | sqs, lambda, cloudwatch | 25 min |
| 015 | [[015-route53-failover-blind/story\|Sixteen Seconds of Nothing]] | 2 - Associate | Networking | route53, elb, cloudwatch | 25 min |
| 016 | [[016-sns-unconfirmed/story\|A Notification for No One]] | 2 - Associate | Operations | sns, cloudwatch, lambda | 25 min |
| 017 | [[017-elasticache-eviction/story\|The Cache That Forgot Everything]] | 2 - Associate | Performance | elasticache, elb, cloudwatch | 25 min |
| 018 | [[018-bedrock-agent-lambda/story\|The Agent That Could Not Act]] | 2 - Associate | Operations | bedrock, lambda, iam, cloudwatch | 25 min |
| 019 | [[019-bedrock-rag-dimension/story\|One Thousand and Twenty-Four]] | 2 - Associate | Data | bedrock, opensearch-serverless, s3, cloudwatch | 25 min |
| 020 | [[020-bedrock-cross-region-scp/story\|Intermittent by Design]] | 3 - Professional | Operations | bedrock, iam, organizations, cloudwatch | 35 min |
| 021 | [[021-bedrock-agent-cost/story\|Ten Dollars a Minute]] | 2 - Associate | Cost | bedrock, cloudwatch, lambda | 25 min |
| 022 | [[022-bedrock-guardrail-medical/story\|The Guardrail and the Doctor]] | 2 - Associate | Reliability | bedrock, cloudwatch, lambda, sns | 25 min |
| 023 | [[023-sagemaker-endpoint-scaling/story\|The Endpoint That Stopped Thinking]] | 3 - Professional | Performance | sagemaker, cloudwatch, auto-scaling, lambda | 35 min |
| 024 | [[024-agentcore-runaway-session/story\|The Agent That Would Not Stop]] | 3 - Professional | Cost | bedrock-agentcore, bedrock, cloudwatch, iam | 35 min |
| 025 | [[025-agentcore-iam-god-mode/story\|The Agent With the Wrong Keys]] | 3 - Professional | Security | bedrock-agentcore, iam, cloudtrail, s3 | 35 min |
| 026 | [[026-devops-agent-prod-wipe/story\|The Thirteen-Hour Recreation]] | 3 - Professional | Operations | q-developer, cloudformation, iam, cloudtrail | 40 min |
| 027 | [[027-s3-vectors-filter-rag/story\|The Filter That Lost the Answer]] | 3 - Professional | Data | s3-vectors, bedrock, opensearch-serverless, cloudwatch | 40 min |
| 028 | [[028-lambda-snapstart-credentials/story\|Yesterday's Token, Today's Traffic]] | 3 - Professional | Reliability | lambda, iam, sts, secrets-manager, cloudwatch | 35 min |
| 029 | [[029-agentcore-gateway-timeout/story\|Five Minutes Is Not Enough]] | 2 - Associate | Operations | bedrock-agentcore, lambda, api-gateway, cloudwatch | 25 min |
| 030 | [[030-verified-access-lockout/story\|The Door That Read the Wrong Name]] | 3 - Professional | Security | verified-access, iam, cognito, cloudtrail | 35 min |
| 031 | [[031-msk-iam-consumer-commit/story\|Every Order, Again]] | 3 - Professional | Data | msk, iam, ec2, cloudwatch | 35 min |
| 032 | [[032-pipes-filter-number-string/story\|The Pipe That Said No to Everything]] | 2 - Associate | Operations | eventbridge-pipes, sqs, lambda, cloudwatch | 25 min |
| 033 | [[033-app-runner-vpc-egress/story\|The Service That Went Quiet]] | 2 - Associate | Networking | app-runner, rds, vpc, secrets-manager | 30 min |
| 034 | [[034-memorydb-acl-flushdb/story\|The Key the Cache Would Not Drop]] | 3 - Professional | Reliability | memorydb, ec2, iam, cloudwatch | 30 min |
| 035 | [[035-transfer-family-scope-down/story\|The Partner Who Saw Too Much]] | 3 - Professional | Security | transfer-family, iam, s3, cloudtrail | 35 min |
| 036 | [[036-s3-vpce-policy-lockout/story\|The Lock You Wrote Yourself]] | 3 - Professional | Security | s3, vpc, iam, cloudtrail | 35 min |
| 037 | [[037-rds-proxy-pinning/story\|The Proxy That Stopped Sharing]] | 3 - Professional | Performance | rds-proxy, lambda, rds, cloudwatch | 30 min |
| 038 | [[038-aurora-serverless-deep-sleep/story\|Thirty Seconds of Silence]] | 3 - Professional | Performance | aurora, rds, lambda, cloudwatch | 30 min |
| 039 | [[039-tgw-static-route-shadow/story\|The Route That Was Never There]] | 3 - Professional | Networking | transit-gateway, vpc, cloudtrail, cloudwatch | 35 min |
| 040 | [[040-eventbridge-cross-account-drop/story\|The Events Nobody Sent]] | 2 - Associate | Operations | eventbridge, iam, cloudwatch, cloudtrail | 25 min |
