---
tags:
  - type/resolution
  - service/transfer-family
  - service/iam
  - service/s3
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# Resolution: The Partner Who Saw Too Much

## Root Cause

The inline scope-down policy attached to the `acme-bev-bottles` Transfer Family user does not narrow the user's access to their own folder. The policy reads, in part:

```json
{
  "Sid": "AllowReadWriteOwn",
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::ironfoam-invoices-shared/customers/*"
}
```

The Resource is the bucket's entire `customers/*` space. There is no `${transfer:UserName}` policy variable in the path, so every user's scope-down evaluates to the same thing: access to every customer's folder.

The `HomeDirectoryType=LOGICAL` mapping makes only `/customers/acme-bev-bottles/` visible in the SFTP filesystem view. That is a convenience for the user, not a security boundary. An SFTP client can request relative or absolute paths that resolve outside the home directory, and the Transfer Family server will pass those through to S3. S3 evaluates the scope-down IAM policy, finds the request covered by the over-broad Resource, and allows the operation.

The same defect exists in every one of Ironfoam's 270 Transfer Family users because all of them were cloned from the same template.

## Timeline

| Time | Event |
|---|---|
| Day -21 | acme-bev-bottles Transfer Family user created via Terraform, scope-down policy cloned from the existing partner template |
| Day -20 | First test login as acme-bev-bottles succeeds; filesystem view shows only own folder; QA signs off |
| Day -1 22:14 CT | Partner admin logs in via their SFTP client (Cyberduck) |
| Day -1 22:15 CT | Partner admin runs "cd .." then "ls", sees every customer's folder name |
| Day -1 22:17 CT | First GetObject on another customer's invoice.csv |
| Day 0 00:31 CT | 43rd customer folder listed; 1,187 GETs in the interval |
| Day 0 00:31 CT | Partner admin logs out |
| Day 0 00:45 CT | Anomaly detector flags the ListBucket spike |
| Day 0 07:40 CT | SecOps analyst escalates to Platform oncall |
| Day 0 08:15 CT | Scope of breach confirmed by cross-referencing CloudTrail S3 data events against per-customer prefixes |
| Day 0 08:22 CT | acme-bev-bottles SSH public key deleted from the user configuration (access revoked) |
| Day 0 08:50 CT | Corrected scope-down policy authored and simulator-tested |
| Day 0 09:30 CT | Terraform apply updates all 270 users with the corrected scope-down |
| Day 0 10:05 CT | Belt-and-suspenders bucket policy Deny added to ironfoam-invoices-shared |
| Day 0 14:00 CT | Legal and CS begin partner notifications to the 43 affected customers |

## Correct Remediation

1. **Confirm the breach scope.** Open CloudTrail Event history filtered to the Lookup attribute `EventSource=s3.amazonaws.com` and the role session name `acme-bev-bottles` (Transfer Family sets the role session name equal to the Transfer Family user name). For each GetObject and ListBucket event, extract the prefix from the `resourceName` field. Group by the first path segment after `customers/`. Any value other than `acme-bev-bottles` is an unauthorized access. (S3 data events must be enabled; management events alone do not record object-level reads.)
2. **Revoke access immediately.** The fastest revocation is to call `DeleteSshPublicKey` on the `acme-bev-bottles` Transfer Family user, which prevents future logins without tearing down the user itself. Do not delete the user yet; keeping it present makes the scope-down fix verifiable with `simulate-principal-policy` against the actual user.
3. **Read the user's configuration.** Call `aws transfer describe-user --server-id <id> --user-name acme-bev-bottles`. Look at `Role`, `HomeDirectoryType`, `HomeDirectoryMappings`, and `Policy` (the inline scope-down). The problem is in the `Policy` document.
4. **Read the scope-down policy carefully.** Every `Resource` under `customers/` must include `${transfer:UserName}` (or an equivalent per-user constraint). Every `s3:ListBucket` Condition that uses `s3:prefix` must include `${transfer:UserName}` in the prefix. If any of these are absent, the user can see every folder.
5. **Rewrite the scope-down.** A correct template:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ListOwnFolder",
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::ironfoam-invoices-shared",
         "Condition": {
           "StringLike": { "s3:prefix": ["customers/${transfer:UserName}/*"] }
         }
       },
       {
         "Sid": "ReadWriteOwn",
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::ironfoam-invoices-shared/customers/${transfer:UserName}/*"
       }
     ]
   }
   ```
   Deploy to the `acme-bev-bottles` user via `UpdateUser` or through your IaC pipeline.
6. **Simulate the fix.** Use the IAM simulator: `aws iam simulate-principal-policy` with `PolicySourceArn` set to the Transfer Family role and `--resource-arns arn:aws:s3:::ironfoam-invoices-shared/customers/other-customer/foo.csv --context-entries ContextKeyName=transfer:UserName,ContextKeyValues=acme-bev-bottles,ContextKeyType=string`. The result should be explicitDeny for another customer's path and allowed for acme-bev-bottles's own path.
7. **Apply the fix across every user.** This defect is in every one of the 270 users because the scope-down template was identical. Use Terraform (or a CloudFormation macro, or a one-time script) to update the policy document for every user at once. Spot-check a sample of three users with the policy simulator to confirm the new policy takes effect.
8. **Add the defense-in-depth bucket policy.** Attach this Deny statement to `ironfoam-invoices-shared`:
   ```json
   {
     "Sid": "DenyCrossCustomerAccess",
     "Effect": "Deny",
     "Principal": "*",
     "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
     "Resource": "arn:aws:s3:::ironfoam-invoices-shared/customers/*/*",
     "Condition": {
       "StringNotLike": {
         "aws:userid": "*:${transfer:UserName}",
         "s3:ExistingObjectTag/customer": "${transfer:UserName}"
       }
     }
   }
   ```
   In the Transfer Family role session, `aws:userid` equals `<roleId>:<transfer-user-name>`, so this Deny fires on any request whose session name does not match the first path segment. This is a backstop: if a future scope-down mistake happens, the bucket policy still refuses the request.
9. **Reissue partner credentials.** Generate a new SSH key pair for acme-bev-bottles, import the public key into the Transfer Family user, and securely deliver the private key to the partner through your offboarding-and-onboarding channel. Document this rotation in the incident record.
10. **Audit the 30-day exposure window.** Pull all CloudTrail S3 data events where the role session name is any Transfer Family user and the requested prefix does not start with the user's own name. Produce a per-customer exposure report for legal: which Ironfoam customer's data was read by which partner user, how many files, what timestamps.
11. **Notify.** Coordinate with legal and account management to send breach notifications per contract and per state data-breach-notification law. Do it within 72 hours of confirmation.
12. **Add preventive controls.**
    - An AWS Config custom rule that evaluates every Transfer Family user and flags any whose scope-down policy is missing `${transfer:UserName}` in the S3 Resource or ListBucket prefix condition.
    - CloudWatch alarm on anomalous per-user LIST-to-GET ratios. A partner who normally GETs five files per login from their own folder should not suddenly LIST 43 prefixes.
    - A code-review checklist entry for any PR that edits a Transfer Family user: "Does the scope-down policy use `${transfer:UserName}` in every customer-path Resource and prefix?"

## Key Concepts

### Transfer Family's Two-Layer Access Model

AWS Transfer Family gives you two knobs that look like they both control access but do very different jobs:

- **HomeDirectory / HomeDirectoryMappings.** A UX convention. Controls what the user sees in the SFTP filesystem view. LOGICAL mode remaps paths (`/` -> `/customers/acme-bev-bottles`) so the user cannot navigate above their home. PATH mode uses the raw S3 prefix. Neither affects IAM evaluation.
- **Role + scope-down policy.** The real access control. The role's attached policies set the maximum permissions any user can ever have; the per-user inline scope-down policy narrows that. The user's effective permissions are the intersection: `(role policies) AND (scope-down)`.

Treating HomeDirectory as the security boundary is the defect pattern that produces this sim. It looks secure when you log in as the user, because the filesystem view is constrained. But the underlying storage layer evaluates IAM, not the filesystem view. An SFTP client that requests an absolute S3 path bypasses the logical view and goes straight to the IAM check.

### Transfer Family Policy Variables

Transfer Family exposes a set of policy variables that the IAM engine substitutes at evaluation time:

- `${transfer:UserName}` — the Transfer Family user name of the authenticated session.
- `${transfer:HomeDirectory}` — the user's configured HomeDirectory (useful if the path is not derivable from the username).
- `${transfer:HomeFolder}` — the "bare" home folder part.
- `${transfer:HomeBucket}` — the home bucket name.

The canonical scope-down template uses `${transfer:UserName}` in every S3 Resource ARN and every ListBucket prefix condition. A single policy document attached to all users then produces per-user isolation. Leaving the variable out turns the "per-user" policy into a "per-everyone" policy.

### Why the Shared Role Is a Blast Radius

Every Transfer Family user in this architecture assumes the same `ironfoam-sftp-partner-role`. The scope-down is how that role's permissions get sliced per user. Two consequences:

- The role's maximum permissions are the ceiling for every user. If the role allows `s3:*`, even a perfectly written scope-down cannot exceed `s3:*` for a specific bucket path. But if the role is too broad, a misconfigured scope-down gets you a user with `s3:*` access to the bucket.
- A change to the role affects every user. Adding a new S3 action to the role is not a per-user change; it grants that action to every user simultaneously (subject to their individual scope-downs).

Keep the shared role as narrow as possible. A good target: the role allows exactly the S3 actions any user ever needs on the bucket, on path `customers/*`, and nothing else. Then the scope-down per user is only responsible for the `${transfer:UserName}` narrowing.

### CloudTrail S3 Data Events

S3 management events (always on) record bucket-level operations: `CreateBucket`, `PutBucketPolicy`, `GetBucketPolicy`, `DeleteBucket`, and so on. They do NOT record `GetObject` or `PutObject`.

S3 data events (must be explicitly enabled per trail per bucket) record object-level operations: every `GetObject`, every `PutObject`, by whom, from where. Without data events, a breach that only reads files is invisible. This is why every bucket holding sensitive data behind Transfer Family should have S3 data events enabled on an organization-wide trail.

Data events cost money (per-event pricing), but they are the only way to answer "which files did this user read?" after the fact. For buckets that back Transfer Family, it is almost always worth it.

## Other Ways This Could Break

### Role is too broad; scope-down is correct
A scope-down can only subtract from the role's permissions. If the role is over-granted, even a correct scope-down can be bypassed by a second attached policy or by a different identity assuming the role outside Transfer Family. Symptom is the same: cross-customer access.
**Prevention:** Tighten the role to the exact intersection of permissions every user ever needs. Use IAM Access Analyzer to flag wildcard actions or Resources and review every change.

### User name contains whitespace or special characters
The scope-down uses `${transfer:UserName}`, but the user's name is "Acme Beverage Bottles" with spaces. The resolved ARN has whitespace that some clients or S3 path handlers do not treat consistently. Partner may accidentally still be able to list more than intended.
**Prevention:** Enforce a naming convention (lowercase, kebab-case, ASCII only) on `CreateUser`. Never let a customer's display name flow verbatim into the Transfer Family user name.

### HomeDirectoryMappings and scope-down paths disagree
LOGICAL chroot maps `/` to `/customers/acme-bev-bottles/`, but the scope-down allows `customers/acme/*`. The LOGICAL view looks right to the user, but the scope-down matches any customer whose name starts with `acme`, exposing `acme-wine`, `acme-cider`, etc.
**Prevention:** Treat HomeDirectoryMappings and the scope-down as two halves of the same contract. Use the same `${transfer:UserName}` in both. Enforce in code review.

## SOP Best Practices

- HomeDirectory is a filesystem view; the scope-down policy is the access boundary. Always scope the scope-down's S3 Resources with `${transfer:UserName}` or an equivalent per-user constraint.
- Add a bucket-policy Deny statement as defense in depth. A bucket policy fires even when the scope-down is missing, which catches future configuration drift.
- Enable S3 data events on every bucket that backs Transfer Family. Without them, investigating a breach is impossible.
- Keep the shared Transfer Family role as narrow as possible. Its permissions are the ceiling for every user's access.

## Learning Objectives

1. **Transfer Family IAM model:** Understand the role-plus-scope-down pattern and why the scope-down is the real access boundary.
2. **HomeDirectory semantics:** Recognize that LOGICAL mode is a filesystem convention, not a security boundary.
3. **Policy variables:** Use `${transfer:UserName}` to turn a single scope-down template into per-user isolation.
4. **CloudTrail for S3 forensics:** Investigate object-level access using S3 data events and role-session-name filtering.
5. **Defense in depth:** Pair a tight scope-down with a bucket-policy Deny to limit the blast radius of future configuration drift.

## Related

- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 3: Migration Planning
- [[learning/catalog.csv]] -- Player service catalog and progress
