---
tags:
  - type/simulation
  - service/s3
  - service/iam
  - service/cloudtrail
  - difficulty/associate
  - category/security
---

# The Meridian Health Data Leak

## Opening

company: Meridian Health
industry: healthtech, mid-market SaaS, 80 engineers
product: digital patient intake platform for medical practices, intake forms stored as PDFs in S3, accessed by clinic staff through Meridian dashboard
scale: 340 medical practices across the midwest, 12,000 patients fill out intake forms daily
compliance: HIPAA Business Associate Agreements with every clinic, processes protected health information (PHI)
time: 6:22 AM, Monday
scene: halfway through first cup of coffee
alert: Slack security channel lights up -- well-known security researcher sent responsible disclosure email reporting patient documents publicly accessible via direct S3 URLs, screenshot of patient intake form attached (name, date of birth, insurance ID all visible)
stakes: HIPAA breach notification triggered if bucket public for more than 24 hours, affected patients must be notified within 60 days, fines start at $100 per violation scaling to $50,000 per violation category, 12,000 forms per day means even a few days of exposure could mean thousands of affected patients
early_signals:
  - security team copied S3 object URL from researcher's email, opened in incognito browser with no AWS credentials -- PDF downloaded immediately, no authentication, no authorization check, no 403
  - compliance officer already calculating exposure window and breach notification timeline
investigation_starting_point: CloudTrail is available to scroll through. The bucket is confirmed publicly readable. The question is how it got that way, how long it has been exposed, who accessed it, and how to contain it.

## Resolution

root_cause: backend engineer building integration with third-party medical records system set bucket policy Principal to `*` instead of vendor's specific AWS account ARN on `meridian-patient-documents` bucket, granting read access to anyone on the internet
mechanism: CloudTrail logs showed `meridian-deploy-svc` called `PutBucketPolicy` on `meridian-patient-documents` four days before detection. During the exposure window, S3 access logs recorded 187 unique external IP addresses accessing objects, including the security researcher, several search engine crawlers, and unattributable IP addresses.
fix: replace `Principal: *` with vendor's specific AWS account ARN, enable S3 Block Public Access at both bucket and account level, enable AWS Config rule `s3-bucket-public-read-prohibited` for continuous monitoring, add CI/CD pipeline check rejecting any bucket policy containing `Principal: *`
contributing_factors:
  - no validation step in CI/CD pipeline to catch wildcard Principal in bucket policies
  - no S3 Block Public Access enabled at account or bucket level as a guardrail
  - 48,000 patients affected (intake forms in bucket during four-day exposure window), HIPAA breach notification process initiated
