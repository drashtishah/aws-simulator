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

1. **Immediate**: Fix the bucket policy -- the JSON document that controls who can access the bucket. Replace `Principal: *` (which means "anyone on the internet") with the vendor's specific account ARN (Amazon Resource Name -- the unique address for their AWS account). This instantly restricts access to only the intended vendor.
2. **Containment**: Turn on S3 Block Public Access at the bucket level. Block Public Access is a set of four safety switches that override any policy or setting that would make the bucket public. Even if the bucket policy still has a mistake, Block Public Access prevents public access.
3. **Prevention**: Turn on S3 Block Public Access at the account level too, so all buckets in the account are protected by default. This prevents future accidents on any bucket, not just this one.
4. **Detection**: Enable the AWS Config rule `s3-bucket-public-read-prohibited`. AWS Config continuously monitors your resources against rules you define and alerts you when something is out of compliance -- like a bucket that has become publicly readable.
5. **Process**: Add a check to your deployment pipeline (CI/CD) that automatically rejects any bucket policy containing `Principal: *` before it gets deployed. This catches the mistake before it reaches production.

## Key Concepts

### S3 Bucket Policies vs IAM Policies -- Two Ways to Control Access

There are two main ways to control who can access files in S3. A bucket policy is a JSON document attached directly to the bucket that says "here is who can access this bucket." It can grant access to anyone, including people with no AWS account at all (by setting `Principal: *`). An IAM policy, on the other hand, is attached to a user, group, or role and says "here is what this identity can access." IAM policies can only grant permissions to the identity they are attached to.

For sharing data with a partner or vendor in a different AWS account, bucket policies are often the simplest approach. But using `Principal: *` (a wildcard meaning "everyone") turns what should be a private vendor grant into a public-internet grant. Always specify the exact account or role ARN (Amazon Resource Name -- the unique address for that identity).

### S3 Block Public Access -- The Safety Net

S3 Block Public Access is a set of four independent safety switches that override bucket policies and ACLs (older access control settings) to prevent public access:

- `BlockPublicAcls` -- rejects any attempt to add public access through an ACL
- `IgnorePublicAcls` -- ignores any existing public ACLs already on the bucket
- `BlockPublicPolicy` -- rejects any bucket policy that would grant public access
- `RestrictPublicBuckets` -- limits access to buckets with public policies to only authorized AWS users

These switches can be turned on for the entire account (protecting all buckets) or for individual buckets. Turning on Block Public Access at the account level is a widely recommended practice -- it acts as a safety net that prevents accidental public exposure no matter what individual bucket policies say.

### CloudTrail for S3 Forensics -- Finding Out What Happened

CloudTrail is like a security camera for your AWS account. It records every API call -- who did what, when, and from where. For S3 investigations:

- Management events (recorded by default) tell you WHO changed the bucket policy (PutBucketPolicy) and WHEN
- Data events (must be explicitly turned on) tell you WHO downloaded specific files (GetObject) and from WHICH IP address
- S3 server access logs provide another view of individual file-level access, complementing CloudTrail

## Other Ways This Could Break

### Bucket ACL Grants Public Read Access

Instead of the bucket policy, the exposure comes from an older access control mechanism called an ACL (Access Control List). If the ACL is set to AllUsers READ, anyone can download files. The tricky part is that ACLs are separate from bucket policies, so the bucket policy might look fine while the ACL is the real problem. Block Public Access with IgnorePublicAcls would override this. Prevention: disable ACLs entirely by setting S3 Object Ownership to BucketOwnerEnforced -- this makes it impossible for anyone to grant public access through an ACL.

### Presigned URL with Overly Long Expiration Leaks via Shared Link

The bucket policy is correctly locked down, but someone generated a presigned URL -- a temporary link that grants access to a specific file for a limited time. If the expiration is set to days instead of minutes and that link gets shared outside the organization, anyone with the link can download the file until it expires. Prevention: limit how long presigned URLs can last by setting shorter session duration limits, and monitor for presigned URL generation in CloudTrail data events.

### S3 Static Website Hosting Enabled on a Private Data Bucket

S3 can serve files as a website (like a simple web server). If this feature is turned on for a bucket containing private data, the files become accessible through a special website URL, bypassing some normal access controls. The bucket does not even need a `Principal: *` policy -- website hosting alone can expose files if there is no explicit deny rule. Prevention: never turn on static website hosting for buckets containing sensitive data. If you need to serve files over the web, use CloudFront (a content delivery service) with Origin Access Control, which keeps the bucket private while still serving content to authorized users.

### Cross-Account Role with Overly Broad S3 Permissions

The bucket policy correctly limits access to a specific vendor account, but the vendor's IAM role (their set of permissions) has s3:GetObject on * -- meaning it can read from any bucket that grants it access, not just the one you intended. The vendor could read other shared buckets you did not mean to expose. Prevention: add condition keys to your bucket policy to restrict access more precisely, such as aws:PrincipalOrgID (limits to your organization) or s3:prefix (limits which folders they can read). Monitor cross-account access patterns in CloudTrail.

## SOP Best Practices

- Turn on S3 Block Public Access at the account level so that all buckets are protected by default. Only turn it off for a specific bucket when you have a documented, deliberate reason to make that bucket public.
- Never use `Principal: *` (meaning "everyone on the internet") in a bucket policy when you want to share data with a specific partner or vendor. Always specify the exact account or role using their ARN (Amazon Resource Name -- the unique address for that AWS identity).
- Turn on AWS Config rules like s3-bucket-public-read-prohibited and s3-bucket-public-write-prohibited. AWS Config continuously checks your resources against rules you define and alerts you when something is out of compliance -- like a bucket that has become publicly readable.
- Require all bucket policy changes to go through your deployment pipeline (CI/CD) with an automated check that rejects any policy containing `Principal: *` or overly broad permissions. This catches mistakes before they reach production.

## Learning Objectives

1. **S3 access control model**: Understand how bucket policies, IAM policies, ACLs, and Block Public Access interact to determine effective permissions
2. **CloudTrail forensics**: Use CloudTrail to reconstruct the timeline of an incident by querying management events
3. **Defense in depth**: Apply multiple layers of protection -- Block Public Access as a guardrail, Config rules for detection, CI/CD checks for prevention
4. **Incident response**: Follow the detect-contain-investigate-remediate workflow under regulatory pressure

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Design Secure Architectures
- [[catalog]] -- s3, iam, cloudtrail service entries
