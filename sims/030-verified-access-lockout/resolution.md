---
tags:
  - type/resolution
  - service/verified-access
  - service/iam
  - service/cognito
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# Resolution: The Door That Read the Wrong Name

## Root Cause

The Verified Access trust provider `hollowfield-okta-tp` has a claim mapping that references a field called `groups` on the Okta ID token. Okta's authorization server in the Hollowfield tenant does not emit a top-level `groups` claim. The user's group memberships are issued under the claim name `group_membership`. Because the mapping points at a field Okta does not send, Verified Access evaluates every request with `context.okta.groups` equal to null.

The group policy on `hollowfield-internal-apps` has a single permit rule that reads `permit (principal, action, resource) when context.okta.groups.contains("hollowfield-engineering");`. Cedar's `contains` on a null attribute evaluates to false. With no permit rule matching, Verified Access applies its implicit deny and returns 403 to every request.

The broken mapping was introduced on Saturday evening during a planned migration from Amazon Cognito to Okta as the identity source for Verified Access. The previous Cognito trust provider mapped Cognito's `cognito:groups` claim into `context.cognito.groups`, and the engineer performing the migration reused the same source field name without verifying what Okta actually sends.

## Timeline

| Time | Event |
|---|---|
| Sat 19:04 UTC | `CreateVerifiedAccessTrustProvider` creates `hollowfield-okta-tp` with `policyReferenceName=okta` and a claim mapping of `groups -> context.okta.groups` |
| Sat 19:12 UTC | `AttachVerifiedAccessTrustProvider` binds `hollowfield-okta-tp` to the `hollowfield-internal-apps` group; previous Cognito trust provider detached |
| Sat 19:16 UTC | Engineer tests login flow once, reaches Okta, authenticates, sees the portal. (The test account happened to be in a permit-everyone debug rule that has since been removed.) |
| Tue 16:12 UTC | First user reports "Access denied" via Slack; 14 more reports within 4 minutes |
| Tue 16:28 UTC | SRE opens Verified Access access log; sees policy denials with `context.okta.groups = null` |
| Tue 16:41 UTC | `ModifyVerifiedAccessTrustProvider` updates claim mapping to `group_membership -> context.okta.groups` |
| Tue 16:42 UTC | First post-fix login succeeds; access log shows allow decision with groups populated |
| Tue 17:05 UTC | Cedar policy updated to add `has(context.okta.groups)` guard and deployed |

## Correct Remediation

1. **Confirm the app is up.** Check the internal ALB target group for the admin portal. All targets should be healthy and responding. If the app itself were down, you would see target failures, not Verified Access denials.
2. **Read the Verified Access access log.** Every policy evaluation writes a record: the user's principal, the decision, the statement that matched (or that no statement matched), and the full `context` object the policy saw. Find a recent deny entry and look at the value Verified Access saw for each context variable.
3. **Identify the null claim.** In this sim, the trace shows `context.okta.groups` is null. Cedar's `contains` on a null value returns false, which is what causes the permit rule to fail.
4. **Locate the claim mapping.** Open the Verified Access trust provider `hollowfield-okta-tp` and inspect its claim mappings. Each row maps an identity-provider field to a context variable. Compare the source field name to the real claim names in a fresh Okta ID token (decode it with https://jwt.io or the Okta admin console's token preview).
5. **Fix the mapping.** Update the trust provider so the `groups` context variable sources from `group_membership` (the field Okta actually emits). The Verified Access API call is `ModifyVerifiedAccessTrustProvider` with a new `oidcOptions.scope` and claim mapping. Alternatively, add a custom claim in Okta's authorization server that copies `group_membership` onto a field named `groups`, so the existing mapping starts working; only do this if you cannot change the Verified Access side.
6. **Test the fix with a fresh session.** Open a private browser window to force a new OIDC flow. Confirm the portal loads and the access log shows an allow decision with `context.okta.groups` populated.
7. **Harden the Cedar policy.** Rewrite the permit rule as `permit (principal, action, resource) when has(context.okta.groups) && context.okta.groups.contains("hollowfield-engineering");`. When a future claim mapping is wrong, the evaluation trace will explicitly show `has(context.okta.groups) = false` rather than a silent false, pointing you straight at the claim layer.
8. **Alarm on the denial rate.** Create a CloudWatch alarm on the `AWS/VerifiedAccess` metric `PolicyEvaluationDenied` per endpoint. A sudden jump in denies is the earliest signal that a trust provider or policy change has locked users out. Page the oncall.

## Key Concepts

### AWS Verified Access

AWS Verified Access is the zero-trust alternative to a VPN. Instead of giving a user a tunnel into the network and trusting everything on that tunnel, Verified Access puts AWS in front of each internal application and evaluates every single request against an identity and device posture policy. If the request fails the policy, it never reaches the application. This shrinks the blast radius of a compromised credential to exactly the applications whose policies the credential satisfies.

Three objects do the work:

- A **trust provider** is the glue between Verified Access and an external identity source (OIDC or device posture). It holds the authorization endpoint, client credentials, and a claim mapping that translates identity-provider fields into context variables that policies can read.
- A **Verified Access group** collects one or more endpoints that share the same policy. The policy is written in Cedar.
- A **Verified Access endpoint** is the front door for a single application. It maps a public hostname to an internal ALB or network interface and evaluates the group's policy (and any endpoint-specific policy) on every request.

### Cedar Policy and Context Variables

Cedar is the policy language Verified Access uses. A Cedar policy is a small rule that begins with `permit` or `forbid` and uses a `when` clause to describe the conditions under which the rule applies. The `context` object exposes the claims Verified Access pulled from each trust provider, namespaced by the trust provider's `policyReferenceName`. For a trust provider whose reference name is `okta`, `context.okta.email` exposes the user's email, `context.okta.groups` exposes whatever field the claim mapping said to treat as groups, and so on.

If a policy references an attribute that is null or missing, comparisons against it evaluate to false rather than raising an error. This is by design: it means a policy never crashes, but it also means a broken claim mapping produces a silent deny. Guarding attribute references with `has(...)` is how you tell the difference between "the claim was there and it did not include the right group" and "the claim was not there at all".

### Claim Mapping

OIDC identity providers issue ID tokens containing claims (key/value pairs about the user). The exact field names depend on the provider's configuration. Cognito issues `cognito:groups`. Okta's default is to not issue a groups claim at all; you have to enable a group claim and choose its name. Verified Access does not know the field names in advance; the trust provider's claim mapping table tells it which field to copy into which context variable.

If the field names on the mapping do not match the claims the identity provider actually emits, the corresponding context variables are null. The policy keeps evaluating but can no longer make access decisions based on attributes it cannot see.

## Other Ways This Could Break

### The policy was saved as a draft and never published
The claim mapping is fine, but the group's active policy is empty because someone started a new policy version and did not click apply. Verified Access treats an empty policy as deny-all. The access log trace shows no statement matched (not a statement that evaluated to false).
**Prevention:** Manage Verified Access group policies as code via Terraform or CloudFormation. Every change goes through a pull request and the apply step verifies a canary user can still reach a known endpoint.

### The trust provider's signing key rotated
The request never reaches the Cedar policy at all. Verified Access rejects the ID token at the OIDC validation step because it does not recognize the signing key. Users see a 401 or an Okta error, not the 403 from the group policy.
**Prevention:** Configure the trust provider to use Okta's JWKS endpoint (dynamic key retrieval) rather than a static key. Verified Access then fetches the current signing keys automatically.

### A device posture provider is denying, not the identity provider
Verified Access supports multiple trust providers at once. A second trust provider might expose `context.jamf.compliant` for device posture. If the Cedar policy requires `context.jamf.compliant == true` and the device trust provider flags the laptop as non-compliant, the denial looks identical on the surface.
**Prevention:** Write Cedar policies as the conjunction of readable conditions, then add separate `forbid` rules per reason (`forbid when !context.jamf.compliant`, `forbid when !context.okta.groups.contains(...)`) so the access log tells you which specific check failed.

## SOP Best Practices

- Write Cedar policies defensively. Always guard attribute references with `has(context.<provider>.<attribute>)` so a missing claim surfaces as a clearly identified reason rather than a silent false. This is the single most useful habit for Verified Access operators.
- Roll out identity provider migrations behind a canary endpoint. Keep the old trust provider bound to a non-critical endpoint, bind the new trust provider to the canary, verify a real user session, and only then cut over the production endpoints.
- Enable Verified Access access logs on every endpoint and ship them to a CloudWatch log group with at least 30-day retention. The evaluation trace is the only complete picture of what the policy actually saw.
- Alarm on the per-endpoint denial rate. A sudden jump is the earliest signal that a configuration change has locked users out.

## Learning Objectives

1. **Verified Access architecture:** Understand how Verified Access uses trust providers, groups, and endpoints to replace VPN access with per-request policy evaluation.
2. **Access log forensics:** Use the access log's evaluation trace to see exactly what context variables a Cedar policy saw at decision time.
3. **OIDC claim mapping:** Understand how claim mappings translate identity-provider fields into Cedar context variables and why a wrong source field name produces a silent deny.
4. **Defensive policy design:** Apply `has()` guards in Cedar to distinguish "attribute absent" from "attribute false" and produce interpretable evaluation traces.

## Related

- [[exam-topics#SCS-C02 -- Security Specialty]] -- Domain 4: Identity and Access Management
- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 1: Design Solutions for Organizational Complexity
- [[learning/catalog.csv]] -- Player service catalog and progress
