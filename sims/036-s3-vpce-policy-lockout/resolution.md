---
tags:
  - type/resolution
  - service/s3
  - service/vpc
  - service/iam
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# Resolution: The Lock You Wrote Yourself

## Root Cause

The bucket policy on `larkspur-phi-archive` contains this Deny statement:

```json
{
  "Sid": "DenyNonVPCEAccess",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::larkspur-phi-archive",
    "arn:aws:s3:::larkspur-phi-archive/*"
  ],
  "Condition": {
    "StringNotEquals": {
      "aws:SourceVpce": "vpce-0a1b2c3d4e5f67890"
    }
  }
}
```

The condition reads: "deny if the request's aws:SourceVpce is not equal to our approved endpoint."

The bug: when a request arrives from the AWS Console, the CLI from a workstation, or any caller not routing through a VPC endpoint, the `aws:SourceVpce` key is **absent** from the request context. IAM evaluates `StringNotEquals` by comparing the expected value (`vpce-0a1b2c3d4e5f67890`) against a null. `StringNotEquals` on an absent key evaluates to **true**. The Deny fires.

The admin's IAM role has `s3:*` via AdministratorAccess. It does not matter. An explicit Deny in a resource-based policy overrides all identity-based Allows. There is no identity-based override path.

Application EC2 instances inside the private subnet route S3 traffic through the gateway VPC endpoint. Their requests carry `aws:SourceVpce`. The condition evaluates to false (the key is present and equals the approved endpoint ID). The Deny does not fire. Application traffic continues unaffected.

## Timeline

| Time | Event |
|---|---|
| 09:47 ET | Security engineer deploys updated bucket policy with StringNotEquals on aws:SourceVpce |
| 09:50 ET | Engineer verifies application EC2 traffic still works; closes change ticket |
| 14:18 ET | Compliance engineer attempts Console GetObject; receives AccessDenied |
| 14:22 ET | On-call ticket opened |
| 14:30 ET | Bucket policy identified as the source; condition key semantics recognized |
| 14:45 ET | Root user replaces bucket policy with StringNotEqualsIfExists variant |
| 14:48 ET | Console access confirmed restored |

## Recovery Paths

Two recovery paths exist when a bucket policy Deny self-locks out all non-VPC callers.

### Path 1: Root user override

The root principal of the AWS account that owns the bucket can call `PutBucketPolicy` and `DeleteBucketPolicy` on that bucket even when the bucket policy explicitly denies those actions. This is a specific carve-out: bucket Deny statements do not apply to the root principal of the bucket-owner account for policy management actions on that bucket.

Steps:
1. Sign in to the AWS Console as the account root user (requires MFA).
2. Navigate to S3 > larkspur-phi-archive > Permissions > Bucket Policy.
3. Replace the policy with the corrected version (see below).
4. Verify Console access is restored under a non-root IAM role.

### Path 2: VPC endpoint caller

Any IAM principal with `s3:PutBucketPolicy` that makes the call from within the VPC through the approved endpoint satisfies the condition. The `aws:SourceVpce` key is present and matches, so the Deny does not fire. The principal can update the policy from an EC2 instance or a Session Manager shell in the private subnet.

Steps:
1. Start a Session Manager session on an EC2 instance in the private subnet that routes S3 traffic through the endpoint.
2. Confirm the instance can reach S3: `aws s3 ls s3://larkspur-phi-archive`.
3. Write the corrected policy to a file and call `aws s3api put-bucket-policy`.

### Path 3: Organizations Root Access Management (alternative for member accounts)

If the account is a member account in AWS Organizations (not the management account), the 2024 Root Access Management feature allows a delegated administrator or the management account root to perform a "Delete bucket policy" privileged action without needing the member account's root credentials. Use this as an alternative when root access to the member account is unavailable.

## Corrected Policy

Replace `StringNotEquals` with `StringNotEqualsIfExists`:

```json
{
  "Sid": "DenyNonVPCEAccess",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::larkspur-phi-archive",
    "arn:aws:s3:::larkspur-phi-archive/*"
  ],
  "Condition": {
    "StringNotEqualsIfExists": {
      "aws:SourceVpce": "vpce-0a1b2c3d4e5f67890"
    }
  }
}
```

`StringNotEqualsIfExists` behavior:
- Key **absent** (Console, non-VPC CLI): condition evaluates to **false**. Deny does not fire. Caller proceeds to identity-based evaluation.
- Key **present, value matches**: condition evaluates to **false**. Deny does not fire. Call is allowed.
- Key **present, value does not match**: condition evaluates to **true**. Deny fires. Call is blocked.

## Key Concepts

### Deny Precedence

IAM policy evaluation order for S3: evaluate all applicable policies, then apply this rule: **any explicit Deny overrides any Allow, everywhere**. An identity-based policy granting `s3:*` does not override a bucket policy Deny. Even AdministratorAccess cannot override a resource-based Deny, except in the specific case of the account root user performing policy management actions on a bucket they own.

The only reliable override paths are:
1. The root user of the bucket-owner account (for PutBucketPolicy and DeleteBucketPolicy).
2. Calling from a path that satisfies the Deny condition (i.e., from within the VPC via the approved endpoint).

### Condition Key Absence Semantics

IAM condition operators behave differently depending on whether a key is present or absent:

| Operator | Key absent | Key present, no match | Key present, matches |
|---|---|---|---|
| StringEquals | false | false | true |
| StringNotEquals | **true** | true | false |
| StringEqualsIfExists | false | false | true |
| StringNotEqualsIfExists | **false** | true | false |

When writing Deny conditions on context keys that are sometimes absent (like `aws:SourceVpce`, `aws:SourceVpc`, `aws:PrincipalOrgID`), always use the `IfExists` variant to avoid firing the Deny on callers that simply lack the key.

### Gateway Endpoint Mechanics

An S3 gateway endpoint is a route-table entry, not a network interface. It does not change the source IP address of requests; it changes the route so traffic does not leave the AWS network via an internet gateway or NAT gateway. Every request routed through the endpoint carries `aws:SourceVpce` set to the endpoint ID. Requests from outside any VPC (Console, workstation CLI) do not route through any endpoint and carry no `aws:SourceVpce`.

Interface endpoints (PrivateLink) for S3 work similarly for the `aws:SourceVpce` key but also set `aws:SourceIp` to the ENI's private IP address.

## Other Ways This Could Break

### Same pattern with aws:SourceVpc

`aws:SourceVpc` is also absent on Console requests. A Deny using `StringNotEquals` on `aws:SourceVpc` produces an identical lockout. The fix is the same: use `StringNotEqualsIfExists`.

### NotPrincipal Deny lockout

Using `"NotPrincipal"` in a Deny statement excludes a specific principal from the Deny. Listing the wrong ARN format (user ARN instead of assumed-role ARN, or missing the account ID) means the exclusion does not match and the intended principal is also denied. Root cause is ARN mismatch, not condition key absence.

**Prevention:** Prefer explicit Allow statements for trusted principals. Use `simulate-principal-policy` to test before deploying.

### VPC endpoint policy contains the restrictive Deny

If the endpoint policy (not the bucket policy) is over-restrictive, only traffic through the endpoint fails. Console traffic (not through the endpoint) continues to work. The failure pattern is the inverse: VPC traffic denied, Console traffic allowed. Verify which policy is at fault before debugging.

## SOP Best Practices

- Use `StringNotEqualsIfExists` when writing Deny conditions on `aws:SourceVpce` or `aws:SourceVpc`. The `IfExists` suffix prevents the Deny from firing when the key is absent.
- After writing any bucket policy Deny, run the IAM policy simulator with a Console-path request (provide no `aws:SourceVpce` context entry) to confirm the Deny does not fire on non-VPC callers.
- Document the break-glass procedure before deploying a restrictive bucket policy. The root user override for `PutBucketPolicy` on an owned bucket is the canonical recovery path.
- For Organizations member accounts, configure Root Access Management so a delegated admin can perform privileged bucket policy actions without needing member-account root credentials.

## Learning Objectives

1. **Deny precedence:** An explicit Deny in a resource-based policy overrides all identity-based Allows, including AdministratorAccess and `s3:*`.
2. **Condition key absence:** `StringNotEquals` on a missing key evaluates to true; `StringNotEqualsIfExists` short-circuits (false), preventing accidental lockout of callers who simply lack the key.
3. **aws:SourceVpce mechanics:** The key is present only on requests routed through a VPC endpoint; Console and non-VPC CLI requests do not carry it.
4. **Recovery paths:** Root user override for bucket policy management; VPC endpoint caller satisfying the condition; Organizations Root Access Management for member accounts.
5. **Prevention:** Pre-deploy policy simulation with no vpc context keys; `IfExists` operator convention for optional context keys.

## Related

- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 4: Access Controls
- [[learning/catalog.csv]] -- Player service catalog and progress
