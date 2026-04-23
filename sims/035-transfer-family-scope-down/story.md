---
tags:
  - type/simulation
  - service/transfer-family
  - service/iam
  - service/s3
  - service/cloudtrail
  - difficulty/professional
  - category/security
---

# The Partner Who Saw Too Much

## Opening

- company: Ironfoam Beverage
- industry: Regional craft beverage distribution
- product: wholesale distributor of craft beer, cider, and non-alcoholic beverages; runs invoice-reconciliation workflows with 270 retail customers
- scale: family-owned, 120 employees, 4 warehouses, 270 retail customers dropping monthly invoice CSVs via SFTP
- time: Tuesday 07:40 Central, the morning after a new partner's second day of SFTP access
- scene: Security Operations Slack channel. A midnight anomaly detector flagged a 40x spike in s3:ListBucket calls from one Transfer Family user to prefixes they have no business reading.
- alert: the anomaly detector is the only reason this was caught within 8 hours. No other alarm exists on SFTP activity. CloudTrail management events do not show GetObject; only data events do, and data events are enabled on this bucket by luck, not by policy.
- stakes: 43 retail customers' invoices were read by one unauthorized partner. Under state data-breach law and under Ironfoam's partner contracts, each affected customer requires a written notification within 72 hours. Ironfoam's general counsel is already involved.
- early_signals: anomaly-detector CloudTrail alert on s3:ListBucket volume; SecOps analyst's manual spot check of the CloudTrail data events confirming reads outside the partner's expected prefix; no production failures, nothing else broken
- investigation_starting_point: You know the partner is acme-bev-bottles. You know their Transfer Family user was created three weeks ago. You have full access to the Transfer Family server configuration, the partner user's scope-down policy, the IAM role every user assumes, the S3 bucket, and CloudTrail with data events enabled.

## Resolution

- root_cause: The inline scope-down policy attached to the acme-bev-bottles Transfer Family user grants s3:GetObject, s3:PutObject, and s3:ListBucket on paths under customers/ without incorporating ${transfer:UserName}. The GetObject/PutObject Resource reads 'arn:aws:s3:::ironfoam-invoices-shared/customers/*' and the ListBucket condition uses Prefix 'customers/*'. Neither narrows to the user's own folder. The user's effective permissions are therefore the role's full allowance across every customer folder. The HomeDirectoryType=LOGICAL mapping makes only /customers/acme-bev-bottles/ visible in the SFTP filesystem view, which is what made the configuration look correct during QA, but any relative path the user types gets resolved and evaluated against the real IAM layer, which allows everything.
- mechanism: The partner's administrator logged in via SFTP with the registered SSH key. Transfer Family authenticated the connection and assumed the ironfoam-sftp-partner-role on behalf of the user, with the inline scope-down policy applied. The partner's SFTP client ran 'ls ../' followed by 'cd ../../customers/other-customer/2026-03/' and 'ls'. The Transfer Family logical chroot did not stop the commands because SFTP servers accept relative path traversal out of the HomeDirectory if the underlying storage layer allows it. The LIST and GET operations translate to s3:ListBucket (with prefix parameter set to the requested path) and s3:GetObject calls. The IAM evaluation returned Allow because the scope-down permits every path under customers/*. Over 2 hours and 17 minutes, the client issued 43 ListBucket calls across unrelated customer folders and downloaded 1,187 individual CSV files via GetObject. CloudTrail data events recorded every one.
- fix: Rewrite the scope-down policy so every S3 Resource and ListBucket prefix condition explicitly includes ${transfer:UserName}. The GetObject/PutObject Resource becomes arn:aws:s3:::ironfoam-invoices-shared/customers/${transfer:UserName}/*, and the ListBucket condition becomes {"s3:prefix":["customers/${transfer:UserName}/*"]} with a separate allow for ListBucket on the bucket root with Prefix ["customers/${transfer:UserName}"] (so the user can list their own folder without listing siblings). Deploy via Terraform across all 270 users; the same defect is in every user's scope-down because they were all cloned from the same template. Add a bucket-policy Deny statement as defense in depth: deny any caller whose role-session-name does not equal the first path component after customers/. Simulate-policy tests on three sample users confirm cross-customer access is now denied.
- contributing_factors: The scope-down policy was copied from an AWS blog post without adapting the Resource to use ${transfer:UserName}. The engineer who wrote it assumed HomeDirectoryType=LOGICAL provided the access control; the blog post did actually include the policy variable but in a comment, which was stripped during the copy-paste. QA validated the user's experience by logging in as the test user and confirming they saw only their own folder; nobody tested a relative-path traversal because the SFTP client used in QA sandboxed relative paths. No bucket-policy Deny existed as a safety net. No AWS Config rule checked whether Transfer Family scope-down policies use ${transfer:UserName}. S3 data events were enabled on the bucket by luck, not by standard; without them, the breach would have been invisible.
