---
tags:
  - type/simulation
  - service/s3
  - service/vpc
  - service/iam
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# The Lock You Wrote Yourself

## Opening

- company: Larkspur Health
- industry: Regional healthcare network
- product: cloud-first clinical data platform; stores PHI archive files in S3 under a VPC-only access policy
- scale: mid-size, 2,400 employees, 6 facilities, 14-person cloud infrastructure team
- time: Thursday 14:22 Eastern, four hours after a bucket policy change was deployed
- scene: Security on-call Slack channel. A compliance engineer reports AccessDenied on the larkspur-phi-archive bucket from the AWS Console. You wrote the bucket policy this morning.
- alert: the application tier (EC2 in private subnet, routing through the gateway VPC endpoint) continues to read and write successfully. Only Console and non-VPC CLI sessions are blocked.
- stakes: PHI archive bucket. Compliance team cannot run audit pulls. Incident response is blocked. If the lockout is not resolved before the weekly audit window at 17:00, a regulatory report will be delayed.
- early_signals: AccessDenied on GetObject from the Console; AdministratorAccess role is unaffected in IAM; application EC2 traffic works fine; the bucket policy was last modified at 09:47 by the on-call engineer
- investigation_starting_point: You know you wrote the bucket policy. You know the application tier still works. You have full access to the bucket policy, the IAM role, the VPC endpoint configuration, and CloudTrail.

## Resolution

- root_cause: The Deny statement in the larkspur-phi-archive bucket policy uses StringNotEquals on aws:SourceVpce. When a request arrives from the AWS Console or any caller outside the VPC, the aws:SourceVpce key is absent from the request context. StringNotEquals on an absent key evaluates to true, so the Deny fires unconditionally on all non-VPC traffic. The admin's AdministratorAccess policy grants s3:*, but an explicit Deny in a resource-based policy overrides all identity-based Allows. The application EC2 instances route their S3 traffic through the gateway VPC endpoint, so their requests carry aws:SourceVpce and the Deny correctly does not fire for them.
- mechanism: The engineer added a Deny statement to enforce VPC-only access. The statement's Condition block reads: StringNotEquals: { aws:SourceVpce: vpce-0a1b2c3d4e5f67890 }. The intent was: deny any request whose source VPC endpoint is not our approved endpoint. The bug: when aws:SourceVpce is absent (Console, non-VPC CLI, cross-account calls from outside the VPC), IAM compares "absent" against "vpce-0a1b2c3d4e5f67890". StringNotEquals on a missing key is true. The Deny fires. Every Console GetObject, PutObject, and ListObjects call fails with AccessDenied. CloudTrail records the denials with errorCode AccessDenied and no vpcEndpointId in the requestParameters.
- fix: Replace StringNotEquals with StringNotEqualsIfExists in the Deny statement. StringNotEqualsIfExists short-circuits when the condition key is absent: if aws:SourceVpce is not present in the request context, the condition evaluates to false and the Deny does not fire; the request proceeds to identity-based policy evaluation. If aws:SourceVpce is present but does not equal the approved endpoint ID, the condition evaluates to true and the Deny fires as intended. Recovery before the fix can be applied: the account root user can call PutBucketPolicy to replace the policy, since root principals in the bucket-owner account are not blocked by bucket policy Denies on PutBucketPolicy and DeleteBucketPolicy. Alternatively, an IAM principal with s3:PutBucketPolicy calling from within the VPC through the approved endpoint satisfies the condition and is not denied.
- contributing_factors: The StringNotEquals versus StringNotEqualsIfExists distinction is subtle. Most IAM documentation examples use StringEquals (presence assumed) not the negated form. The engineer tested the policy from inside the VPC (where aws:SourceVpce is present) and confirmed application traffic still worked, but did not test a Console-path request before deploying. No pre-deploy policy simulation was in place. No break-glass runbook existed for bucket policy lockouts.
