---
tags:
  - type/resolution
  - service/s3
  - service/iam
  - service/cloudtrail
  - difficulty/associate
  - category/security
---

# Resolution: The Meridian Health Data Leak

## Root Cause

The S3 bucket `meridian-patient-documents` had a bucket policy that granted `s3:GetObject` permission to `Principal: *`. This made every object in the bucket publicly readable over the internet without authentication. The bucket contained patient intake forms with protected health information (PHI), including names, dates of birth, and insurance IDs.

The policy was modified four days prior to detection by a service account (`meridian-deploy-svc`) during an integration with a third-party medical records vendor. The engineer intended to grant the vendor read access but used a wildcard principal instead of the vendor's specific AWS account ARN.

## Timeline

| Time | Event |
|---|---|
| Day -4, 11:07 UTC | `meridian-deploy-svc` calls `PutBucketPolicy` with Principal: * |
| Day -4 to Day 0 | 48,000+ patient intake forms publicly accessible |
| Day -3, 14:22 UTC | First external crawler accesses the bucket (Googlebot) |
| Day -1, 22:15 UTC | Security researcher discovers the exposure via URL enumeration |
| Day 0, 06:22 UTC | Researcher's responsible disclosure email received |
| Day 0, 06:35 UTC | Security team confirms: objects downloadable without credentials |
| Day 0, 06:52 UTC | Bucket policy updated to restrict Principal to vendor account ARN |
| Day 0, 06:55 UTC | S3 Block Public Access enabled at bucket level |
| Day 0, 07:10 UTC | S3 Block Public Access enabled at account level for all non-public buckets |

## Correct Remediation

1. **Immediate**: Replace `Principal: *` with the vendor's specific account ARN in the bucket policy
2. **Containment**: Enable S3 Block Public Access at the bucket level to override any public policy
3. **Prevention**: Enable S3 Block Public Access at the account level for all buckets that should not be public
4. **Detection**: Enable AWS Config rule `s3-bucket-public-read-prohibited` for continuous compliance monitoring
5. **Process**: Add a CI/CD policy check that rejects bucket policies containing `Principal: *`

## Key Concepts

### S3 Bucket Policies vs IAM Policies

S3 bucket policies are resource-based policies attached directly to the bucket. They can grant access to any AWS principal, including anonymous users (`Principal: *`). IAM policies are identity-based and attached to users, groups, or roles -- they can only grant permissions to the entity they are attached to.

For cross-account access, bucket policies are often the simplest mechanism. But a wildcard principal turns a cross-account grant into a public-access grant. The correct approach is to always specify the exact account or role ARN.

### S3 Block Public Access

S3 Block Public Access provides four independent controls that override bucket policies and ACLs:

- `BlockPublicAcls` -- rejects PUT requests that include public ACLs
- `IgnorePublicAcls` -- ignores existing public ACLs on the bucket
- `BlockPublicPolicy` -- rejects bucket policies that grant public access
- `RestrictPublicBuckets` -- restricts access to buckets with public policies to authorized users only

These can be set at the account level (applies to all buckets) or per bucket. Enabling Block Public Access at the account level is an AWS security best practice that prevents accidental public exposure regardless of individual bucket policies.

### CloudTrail for S3 Forensics

CloudTrail logs S3 management events (PutBucketPolicy, DeleteBucketPolicy) by default. S3 data events (GetObject, PutObject) must be explicitly enabled. For forensic investigation:

- Management events reveal WHO changed the policy and WHEN
- Data events (if enabled) reveal WHO accessed specific objects and from WHICH IP address
- S3 server access logs provide a complementary view of individual object-level access

## AWS Documentation Links

- [S3 Bucket Policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [CloudTrail Logging for S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cloudtrail-logging.html)
- [S3 Server Access Logging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerLogs.html)
- [IAM Policy Evaluation Logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)

## Learning Objectives

1. **S3 access control model**: Understand how bucket policies, IAM policies, ACLs, and Block Public Access interact to determine effective permissions
2. **CloudTrail forensics**: Use CloudTrail to reconstruct the timeline of an incident by querying management events
3. **Defense in depth**: Apply multiple layers of protection -- Block Public Access as a guardrail, Config rules for detection, CI/CD checks for prevention
4. **Incident response**: Follow the detect-contain-investigate-remediate workflow under regulatory pressure

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[catalog]] -- s3, iam, cloudtrail service entries
