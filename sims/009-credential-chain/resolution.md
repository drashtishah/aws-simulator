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

1. **Immediate**: Remove `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from `/etc/environment` on the CI instance. Start a new shell session or reboot the instance to clear the variables from the running environment.
2. **Verification**: Run `aws sts get-caller-identity` to confirm the CLI now resolves to the instance profile role ARN. Run the deploy script manually to verify it succeeds.
3. **Audit**: Search all EC2 instances for hardcoded AWS credentials in environment variables, `.bashrc`, `.bash_profile`, `/etc/environment`, and cron job definitions. Remove any that are found.
4. **Offboarding process**: Add a step to the offboarding checklist -- search all shared infrastructure (CI machines, jump boxes, dev servers) for credentials belonging to the departing engineer.
5. **Detection**: Configure CloudTrail to alert on `AccessDenied` events from IAM users that are inactive or do not match expected principals for a given source IP.

## Key Concepts

### AWS Credential Resolution Chain

The AWS CLI and SDKs resolve credentials in this fixed order. The first source that provides credentials wins. Later sources are never consulted.

1. **Command-line options** -- `--profile`, explicit `--access-key-id` and `--secret-access-key` flags
2. **Environment variables** -- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
3. **CLI credentials file** -- `~/.aws/credentials` (the `[default]` profile or a named profile)
4. **CLI config file** -- `~/.aws/config` (can specify role_arn for assume-role, SSO configuration)
5. **Container credentials** -- ECS task role credentials via the `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` endpoint
6. **Instance profile** -- EC2 instance metadata service (IMDS) providing temporary credentials from the attached IAM role

In this incident, the environment variables (priority 2) contained credentials for a deactivated user. The instance profile (priority 6) had the correct role. The CLI never reached priority 6.

### `aws configure list`

This command shows which credential source is active and where each component comes from:

```
      Name                    Value             Type    Location
      ----                    -----             ----    --------
   profile                <not set>             None    None
access_key     ****************XMPL              env    AWS_ACCESS_KEY_ID
secret_key     ****************XMPL              env    AWS_SECRET_ACCESS_KEY
    region                us-west-2      config-file    ~/.aws/config
```

The `Type` column reveals the source. If it says `env`, credentials are coming from environment variables, not the instance profile. If it says `iam-role`, they come from the instance profile.

### `aws sts get-caller-identity`

This command returns the IAM principal the CLI is currently authenticating as. It works even when the principal lacks permissions for other actions. It is the single fastest way to answer "who does AWS think I am right now?"

If the output shows an IAM user ARN when you expect a role ARN, something in the credential chain is overriding the instance profile.

### Why Environment Variables Are Dangerous

Environment variables are invisible in day-to-day operations. They persist across reboots if set in `/etc/environment` or shell profiles. They silently override instance profiles and config files. Engineers set them for quick debugging and forget to remove them. When the associated IAM user is offboarded, the credentials break with no warning until the next API call.

## Other Ways This Could Break

### Credentials file override

The `~/.aws/credentials` file on the instance contains long-lived access keys from a previous setup, overriding the instance profile. This differs from the environment variable scenario because the credential source is the shared credentials file (priority 3 in the chain) rather than environment variables (priority 2). Running `aws configure list` shows Type as `shared-credentials-file` instead of `env`. The fix is the same pattern: remove the credentials file and let the instance profile take over. Prevention: never store long-lived credentials on shared infrastructure; use instance profiles exclusively for EC2 workloads.

### Expired STS session token

An engineer ran `aws sts get-session-token` and exported `AWS_SESSION_TOKEN` alongside the access key variables into a persistent file like `/etc/environment`. The session token expired, but the environment variables remain. The error message is `ExpiredToken` rather than `AccessDenied`, which is the key difference. The access key itself may still be valid, but the session token has a fixed expiration. Prevention: never export temporary session tokens into persistent environment files. Use instance profiles or role assumption for automated workloads.

### Wrong instance profile attached

The EC2 instance has an instance profile, but it is associated with a role that lacks the required permissions. The CLI authenticates as the role (`get-caller-identity` returns a role ARN, not a user ARN), but the role's policies do not include the needed actions (s3:PutObject, secretsmanager:GetSecretValue, etc.). The fix is updating the role's policies, not removing credential overrides. Prevention: use infrastructure-as-code to define instance profile roles and their policies; review role permissions when deploy requirements change.

### IMDSv2 enforcement blocks credential retrieval

The instance was configured to require IMDSv2 (token-based metadata access), but the AWS CLI or SDK version running on the instance does not support IMDSv2. The credential chain reaches the instance profile step but fails to retrieve credentials from the metadata service. The error is `Unable to locate credentials` rather than `AccessDenied`. Prevention: update the AWS CLI and SDKs to versions that support IMDSv2 before enforcing it on instances.

## SOP Best Practices

- **Use instance profiles instead of access keys for EC2 workloads.** Instance profiles provide automatic credential rotation through the metadata service. There are no keys to lose, leak, or forget to remove. The SOP for setting up an instance profile involves creating an IAM role with a trust policy for ec2.amazonaws.com, wrapping it in an instance profile, and attaching it to the instance.
- **Run `aws sts get-caller-identity` as the first step in any AccessDenied investigation.** It reveals the actual authenticating principal regardless of what you expect. If the output shows an IAM user ARN when you expect a role ARN, something in the credential chain is overriding the instance profile.
- **Include a credential sweep in your offboarding checklist.** Search all shared infrastructure (CI machines, jump boxes, dev servers) for environment variables, credentials files, and config files belonging to the departing engineer. Check `/etc/environment`, `~/.bashrc`, `~/.bash_profile`, `~/.aws/credentials`, and cron job definitions.
- **Configure CloudTrail alerts for AccessDenied events from inactive or unexpected principals.** This catches credential override issues before they cause extended outages. Alert when the principal in a CloudTrail event does not match the expected instance profile role for a given source IP.

## Learning Objectives

1. **Credential resolution order**: The AWS CLI and SDKs resolve credentials in a fixed priority chain -- environment variables override instance profiles
2. **Identity verification**: `aws sts get-caller-identity` is the definitive way to determine which principal the CLI is authenticating as
3. **Credential hygiene**: Hardcoded credentials on shared infrastructure are a latent failure waiting to happen, especially after offboarding
4. **Diagnostic tools**: `aws configure list` shows the source of active credentials, making it trivial to detect environment variable overrides

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 2: Security
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Secure Architectures
- [[catalog]] -- iam, sts, secrets-manager service entries
