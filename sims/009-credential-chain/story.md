---
tags:
  - type/simulation
  - service/iam
  - service/sts
  - service/secrets-manager
  - difficulty/starter
  - category/security
---

# Someone Else's Keys

## Opening

company: Fenwick Systems
industry: b2b SaaS, invoice reconciliation software for mid-size accounting firms
location: shared office above a ramen shop in Portland
scale: 10 engineers, 18 paying customers, Series A closed in January
infrastructure: single CI/CD pipeline on an EC2 instance deploying to staging and production
time: Wednesday morning (deploy failed silently on Tuesday at 4 PM)
scene: product manager asked why staging still has last week's build
alert: "AccessDenied on every AWS API call in the deploy script -- S3 upload, Secrets Manager fetch, Lambda update"
stakes: deploy pipeline completely blocked, staging stuck on last week's build, no code shipping
early_signals:
  - deploy script ran daily at 4 PM without error for eleven months, returned AccessDenied on Tuesday
  - nothing in the script had changed
  - failure was silent -- nobody checked until Wednesday morning
  - every AWS API call returns AccessDenied: S3 upload, Secrets Manager fetch, Lambda update
  - EC2 instance has instance profile attached, IAM role has correct policies (verified twice)
  - deploy script not modified since February, instance is healthy
investigation_starting_point: permissions are verified correct on the instance profile and IAM role. Deploy script unchanged since February. Instance healthy. Everything looks right but the pipeline cannot do anything at all. Something outside the usual configuration is interfering.

## Resolution

root_cause: two environment variables AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY set in /etc/environment on the CI machine. Added eight months ago by former engineer Raj Patel while debugging a cross-account access issue for a different project. He solved his problem and moved on. The variables stayed.
mechanism: when Raj left the company in November, his IAM user account was deactivated and access keys marked inactive during standard offboarding. For months this did not matter -- SDK calls fell through to the instance profile because of how the credential chain resolved. A recent AWS CLI update changed the behavior, and environment variables began taking precedence consistently. Credentials pointed to a deactivated user, so every call failed.
fix: remove the two environment variables from /etc/environment and restart the shell session. Instance profile credentials took over immediately. Deploy ran without error at the next scheduled time.
contributing_factors:
  - former engineer left hardcoded credentials on shared CI machine eight months ago
  - offboarding checklist deactivated IAM user but did not search infrastructure for leftover credentials
  - AWS CLI update changed credential chain resolution behavior, making environment variables consistently take precedence
  - team added check to offboarding documentation: search all CI machines for hardcoded AWS credentials
