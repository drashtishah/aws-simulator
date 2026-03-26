---
tags:
  - type/resolution
  - service/iam
  - service/sts
  - service/secrets-manager
  - difficulty/starter
  - category/security
---

# Resolution: Someone Else's Keys

## Root Cause

The EC2 instance `fenwick-ci-01` (i-0f4e3d2c1b0a9f8e7) running the CI/CD pipeline had `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables set in `/etc/environment`. These credentials belonged to IAM user `raj.patel`, a former engineer whose account was deactivated during offboarding in November 2025. The environment variables were set eight months prior for an unrelated cross-account debugging session and never removed.

The AWS CLI resolves credentials in a fixed priority order. Environment variables rank above instance profiles. The instance profile role `fenwick-ci-deploy-role` had the correct permissions, but the CLI never reached it. It found the environment variables first, attempted to authenticate as `raj.patel` with inactive access keys, and returned `AccessDenied` on every API call.

## Timeline

| Time | Event |
|---|---|
| 2025-07-14 | Raj Patel sets AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in /etc/environment on fenwick-ci-01 for cross-account debugging |
| 2025-07-16 | Raj completes his debugging task; environment variables are not removed |
| 2025-11-08 | Raj Patel leaves Fenwick Systems; IAM user deactivated, access keys marked inactive |
| 2026-03-18 14:00 UTC | AWS CLI update applied to fenwick-ci-01 via automatic yum update |
| 2026-03-18 16:00 UTC | Scheduled deploy runs; all API calls return AccessDenied |
| 2026-03-18 16:00 UTC | Deploy fails silently; no alerting configured on deploy failures |
| 2026-03-19 09:12 UTC | Product manager notices staging has last week's build |
| 2026-03-19 09:30 UTC | On-call engineer reviews deploy logs, sees AccessDenied errors |
| 2026-03-19 09:45 UTC | `aws sts get-caller-identity` reveals CLI is authenticating as raj.patel |
| 2026-03-19 09:48 UTC | Environment variables discovered in /etc/environment |
| 2026-03-19 09:50 UTC | Variables removed; deploy succeeds on manual re-run |

## Correct Remediation

1. **Remove the stale credentials**: Delete the lines containing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from `/etc/environment` on the CI instance. These environment variables are overriding the machine's built-in credentials. Start a new shell session or reboot the instance so the change takes effect -- environment variables stay in memory until the shell that loaded them is closed.
2. **Confirm the fix**: Run `aws sts get-caller-identity` to check who the CLI is acting as now. The output should show the machine's own role (a role ARN like `arn:aws:sts::...:assumed-role/fenwick-ci-deploy-role/...`) instead of the former employee's user account. Run the deploy script manually to verify it succeeds.
3. **Audit other machines**: Search all EC2 instances and shared infrastructure for hardcoded AWS credentials. Check environment variables, `.bashrc`, `.bash_profile`, `/etc/environment`, `~/.aws/credentials`, and cron job definitions. If one machine had leftover credentials, others might too.
4. **Update the offboarding process**: Add a step to the offboarding checklist: when someone leaves the company, search all shared infrastructure (CI machines, jump boxes, dev servers) for credentials belonging to them.
5. **Set up automatic detection**: Configure CloudTrail (the AWS audit log service) to alert on `AccessDenied` errors from inactive users or from users that do not match the expected role for a given machine's IP address. This catches credential override problems early, before they cause days-long outages.

## Key Concepts

### How the CLI Decides Which Credentials to Use (The Credential Chain)

When you run an AWS CLI command, it needs credentials to prove who you are. It checks several places in a fixed order, and the first one it finds wins. It never looks further.

1. **Flags you typed on the command line** -- like `--profile` or explicit key flags. Highest priority.
2. **Environment variables** -- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN`. These are settings baked into the shell environment.
3. **The credentials file on disk** -- `~/.aws/credentials`, a file that can store access keys for different profiles.
4. **The config file on disk** -- `~/.aws/config`, which can specify roles to assume or SSO settings.
5. **Container credentials** -- used when code runs inside a container on AWS (like ECS). Not relevant for EC2 instances.
6. **The machine's built-in role (instance profile)** -- EC2 instances can have a role attached that provides temporary credentials automatically. This is the most secure option because the credentials rotate on their own.

In this incident, environment variables (priority 2) contained a former employee's deactivated credentials. The machine's instance profile (priority 6) had the correct role and permissions. But the CLI found the environment variables first and never looked further.

### aws configure list -- See Where Your Credentials Come From

This command shows which credential source the CLI is currently using and where each value comes from:

```
      Name                    Value             Type    Location
      ----                    -----             ----    --------
   profile                <not set>             None    None
access_key     ****************XMPL              env    AWS_ACCESS_KEY_ID
secret_key     ****************XMPL              env    AWS_SECRET_ACCESS_KEY
    region                us-west-2      config-file    ~/.aws/config
```

The `Type` column is the most important part. If it says `env`, the credentials are coming from environment variables -- not from the machine's built-in role. If it says `iam-role`, they come from the instance profile, which is what you want on an EC2 instance.

### aws sts get-caller-identity -- Check Who AWS Thinks You Are

This command answers the question "who am I right now?" It returns the identity (user or role) the CLI is authenticating as. It works even when you lack permissions for anything else -- it is always allowed. It is the single fastest way to check whether you are acting as the right principal.

If the output shows an IAM user name (like `raj.patel`) when you expected a machine role, something in the credential chain is overriding the instance profile.

### Why Leftover Environment Variables Are Dangerous

Environment variables are invisible in day-to-day work. You do not see them unless you look for them. They persist across reboots if set in `/etc/environment` or shell profile files. They silently override the machine's built-in role and any config files. Engineers set them for a quick debugging session and forget to clean them up. Months later, when the associated user account is deactivated during offboarding, every API call on that machine starts failing -- with no obvious explanation because nothing about the machine itself changed.

## Other Ways This Could Break

### A credentials file on disk overrides the machine's built-in role

The file `~/.aws/credentials` on the instance contains long-lived access keys from a previous setup. This is similar to the environment variable problem, but the credentials come from a file on disk (priority 3 in the chain) instead of environment variables (priority 2). Running `aws configure list` shows Type as `shared-credentials-file` instead of `env`. The fix is the same pattern: remove the credentials file and let the machine's instance profile take over. Prevention: never store long-lived credentials on shared infrastructure. Use instance profiles exclusively for EC2 workloads.

### A temporary security token expired but the variables are still set

An engineer once generated temporary credentials by running `aws sts get-session-token` and saved all three values (access key, secret key, and session token) as environment variables in a persistent file like `/etc/environment`. The session token expired after a few hours, but the variables are still set. The error message says `ExpiredToken` rather than `AccessDenied` -- that is the key difference. The access key may still be valid on its own, but the session token has a fixed lifetime and once it expires, every call fails. Prevention: never save temporary session tokens into persistent files. Use instance profiles for automated workloads -- they handle token renewal automatically.

### The machine's built-in role does not have the right permissions

The EC2 instance has an instance profile, and the CLI correctly authenticates as that role (`get-caller-identity` shows a role ARN, not a user ARN). But the role's permission policy does not include the actions the deploy script needs (like uploading files to S3 or updating a Lambda function). The fix is different from this sim: you need to update the role's permissions, not remove credential overrides. Prevention: define instance profile roles and their permissions using infrastructure-as-code. Review role permissions whenever deploy requirements change.

### The instance's metadata service is locked down and the CLI cannot reach it

The instance was configured to require a newer, more secure version of the metadata service (called IMDSv2). But the AWS CLI or SDK version running on the machine does not support IMDSv2. The credential chain reaches the instance profile step but fails to retrieve credentials because it cannot speak the right protocol. The error says `Unable to locate credentials` rather than `AccessDenied`. Prevention: update the AWS CLI and SDKs to versions that support IMDSv2 before enabling the requirement on instances. Test credential retrieval after making the switch.

## SOP Best Practices

- **Use the machine's built-in role (instance profile) instead of hardcoded access keys for EC2 workloads.** An instance profile provides temporary credentials that rotate automatically through the metadata service. There are no keys to lose, leak, or forget to remove when someone leaves the company.
- **When you see AccessDenied, the first question to answer is "who does AWS think I am?"** Run `aws sts get-caller-identity`. If the output shows a personal user account when you expected the machine's role, something in the credential chain is overriding the instance profile. This single command saves hours of looking in the wrong place.
- **Add a credential sweep to your offboarding checklist.** When someone leaves the company, search all shared infrastructure (CI machines, jump boxes, dev servers) for their credentials. Check `/etc/environment`, `~/.bashrc`, `~/.bash_profile`, `~/.aws/credentials`, and cron job definitions. Leftover credentials are invisible until they break.
- **Set up automatic detection using CloudTrail alerts.** CloudTrail records every API call made in your account. Configure it to alert when AccessDenied errors come from inactive users or from users that do not match the expected role for a given machine. This catches credential override problems before they cause days-long outages.

## Learning Objectives

1. **Credential resolution order**: The AWS CLI and SDKs resolve credentials in a fixed priority chain -- environment variables override instance profiles
2. **Identity verification**: `aws sts get-caller-identity` is the definitive way to determine which principal the CLI is authenticating as
3. **Credential hygiene**: Hardcoded credentials on shared infrastructure are a latent failure waiting to happen, especially after offboarding
4. **Diagnostic tools**: `aws configure list` shows the source of active credentials, making it trivial to detect environment variable overrides

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 2: Security
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Secure Architectures
- [[catalog]] -- iam, sts, secrets-manager service entries
