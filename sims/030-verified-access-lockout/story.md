---
tags:
  - type/simulation
  - service/verified-access
  - service/iam
  - service/cognito
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# The Door That Read the Wrong Name

## Opening

- company: Hollowfield Labs
- industry: Enterprise AI research
- product: internal admin portal used for cluster provisioning, feature flag management, and billing overrides
- scale: 280 engineers across 6 offices, ~1,400 authenticated sessions per business day
- time: Tuesday 09:12 Pacific, first full business morning after a weekend identity migration
- scene: Slack #admin-portal channel is filling with "is this down for anyone else?" messages at one per minute. The VP of Research has already emailed Platform Eng directly.
- alert: no PagerDuty alert fired. The admin portal's health checks pass. Discovery came from user reports.
- stakes: A quarterly cluster budget approval is due by end of day. Feature-flag rollover for the March cohort is scheduled for 11:00 AM and requires an admin portal login. Eight SOC2 evidence uploads are blocked behind the same portal.
- early_signals: "Access denied. Contact your administrator" returned to every employee. No one, including the SRE team, can get in. The "contact your administrator" link points at the SRE team. Okta login itself works for other apps.
- investigation_starting_point: You know the Verified Access configuration for the hollowfield-internal-apps group was edited Saturday evening as part of the Cognito to Okta trust provider migration. You have console access to Verified Access, IAM, CloudWatch Logs, CloudTrail, and the Okta admin tenant.

## Resolution

- root_cause: The Verified Access trust provider hollowfield-okta-tp has a claim mapping that maps the Okta ID token field named 'groups' onto the context variable context.okta.groups. Okta, however, does not emit a top-level 'groups' claim by default. The matching Okta authorization server rule writes the user's group memberships into a claim called 'group_membership'. The source field name on the mapping was copied verbatim from the previous Cognito trust provider, where the field was indeed called 'groups' after the 'cognito:groups' to 'groups' rename. Nobody verified the Okta token contents.
- mechanism: Every request goes through the normal Verified Access flow: the user is redirected to Okta, authenticates successfully, and returns with a valid ID token. Verified Access applies the trust provider claim mapping, which pulls the non-existent 'groups' field and writes it as context.okta.groups. Cedar sees context.okta.groups as null. The only permit rule in the group policy is 'permit (principal, action, resource) when context.okta.groups.contains("hollowfield-engineering");'. Cedar's contains on a null value is false. With no permit rule matching, Verified Access falls through to its implicit deny and returns 403 with the text configured on the endpoint.
- fix: The claim mapping on hollowfield-okta-tp is updated so the groups context variable sources from 'group_membership' instead of 'groups'. The change is applied via ModifyVerifiedAccessTrustProvider. Within 30 seconds of the update, users who refresh the page are let through; their access log entries now show context.okta.groups resolved to the expected array and an allow decision matched against the permit rule. To prevent a repeat, the Cedar policy is rewritten to guard with has(context.okta.groups) so a missing claim produces an interpretable denial in the evaluation trace instead of a silent false.
- contributing_factors: The Cognito to Okta migration was run end-to-end by a single engineer on Saturday, without a second reviewer on the claim mapping change. There was no canary Verified Access endpoint with test users bound to Okta to validate the mapping before the hollowfield-internal-apps group was cut over. The Cedar policy had no has() guards, so the evaluation trace produced a silent false rather than an explicit "attribute missing" reason. Access log retention was set to 3 days, which would have made post-mortem reconstruction impossible if the incident had taken longer than a day to detect.
