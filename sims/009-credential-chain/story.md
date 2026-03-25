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

The deploy script ran every day at 4 PM. It had run without error for eleven months. On Tuesday it returned `AccessDenied`. Nothing in the script had changed.

Fenwick Systems builds invoice reconciliation software for mid-size accounting firms. Ten engineers, a shared office above a ramen shop in Portland, a single CI/CD pipeline running on an EC2 instance that deploys to staging and production. The pipeline is not sophisticated. It works, or it used to. The company has eighteen paying customers and a Series A that closed in January.

You are the one who noticed. The deploy failed silently on Tuesday and nobody checked until Wednesday morning, when the product manager asked why the staging environment still had last week's build. You pulled up the logs. Every AWS API call in the deploy script returned `AccessDenied`. The S3 upload, the Secrets Manager fetch, the Lambda update. All of them.

The EC2 instance has an instance profile attached. The IAM role has the correct policies. You verified this twice. The permissions are there. The deploy script has not been modified since February. The instance is healthy. Everything looks right, but the pipeline cannot do anything at all.

## Resolution

The root cause was two environment variables. `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` were set in `/etc/environment` on the CI machine. They had been there for eight months. Raj Patel, a former engineer, had added them while debugging a cross-account access issue for a different project. He solved his problem and moved on. The variables stayed.

When Raj left the company in November, his IAM user account was deactivated and his access keys were marked inactive as part of the standard offboarding checklist. For months this did not matter. The deploy script happened to use SDK calls that fell through to the instance profile because of how the credential chain resolved at the time. A recent AWS CLI update changed the behavior slightly, and the environment variables began taking precedence consistently. The credentials pointed to a deactivated user. Every call failed.

The fix was to remove the two environment variables from `/etc/environment` and restart the shell session. The instance profile credentials took over immediately. The deploy ran without error at the next scheduled time. The team added a check to their onboarding documentation: search all CI machines for hardcoded AWS credentials during offboarding.
