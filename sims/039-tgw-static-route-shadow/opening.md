---
tags:
  - type/opening
  - service/transit-gateway
  - service/vpc
  - service/cloudtrail
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# The Route That Was Never There

Payroll processing is down. The payroll VPC cannot reach shared services: Active Directory authentication is timing out, DNS queries are failing, and monitoring agents have gone silent. The helpdesk has been fielding calls for the past hour.

The Transit Gateway is healthy. No alarms fired. VPC flow logs on the payroll ENIs show outbound traffic leaving normally. Nothing came back.

An engineer opened a Reachability Analyzer path check thirty minutes ago while setting up routing for a newly attached VPC. The analysis returned not-reachable with an explanation code. The investigation is yours.
