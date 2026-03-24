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

It is 6:22 AM on a Monday. You are halfway through your first cup of coffee when the Slack security channel lights up: a well-known security researcher has sent an email to Meridian Health's responsible disclosure address. She reports that patient documents are publicly accessible via direct S3 URLs. She has included a screenshot of a patient intake form -- name, date of birth, insurance ID, all visible.

Meridian Health is a mid-market healthtech company that provides a digital patient intake platform to 340 medical practices across the midwest. Every day, roughly 12,000 patients fill out intake forms through Meridian's web portal. Those forms are stored as PDFs in S3 and accessed by clinic staff through the Meridian dashboard. The company processes protected health information under strict HIPAA Business Associate Agreements with every clinic.

The security team runs a quick test: copy the S3 object URL from the researcher's email, open it in an incognito browser window with no AWS credentials. The PDF downloads immediately. No authentication, no authorization check, no 403. The file just comes down.

You open CloudTrail and start scrolling. The compliance officer is already calculating: if the bucket has been public for more than 24 hours, this triggers a HIPAA breach notification process. Affected patients must be notified within 60 days. Fines start at $100 per violation and scale to $50,000 per violation category. With 12,000 forms per day, even a few days of exposure could mean thousands of affected patients.

## Resolution

The investigation traced the exposure to a bucket policy change made four days earlier. A backend engineer was building an integration with a third-party medical records system that needed read access to the patient documents bucket. Instead of granting access to the vendor's specific AWS account ARN, the engineer set the bucket policy Principal to `*`, which grants read access to anyone on the internet.

CloudTrail logs showed that `meridian-deploy-svc` called `PutBucketPolicy` on the `meridian-patient-documents` bucket four days before detection. During the exposure window, S3 access logs recorded 187 unique external IP addresses accessing objects in the bucket, including the security researcher, several search engine crawlers, and a handful of IP addresses that could not be attributed.

The immediate fix was to replace `Principal: *` with the vendor's specific AWS account ARN and enable S3 Block Public Access at both the bucket and account level. The team also enabled AWS Config rule `s3-bucket-public-read-prohibited` for continuous monitoring and added a CI/CD pipeline check that rejects any bucket policy containing `Principal: *`.

The compliance team initiated the HIPAA breach notification process for the 48,000 patients whose intake forms were in the bucket during the exposure window.
