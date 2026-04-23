---
tags:
  - type/simulation
  - service/app-runner
  - service/rds
  - service/vpc
  - service/secrets-manager
  - difficulty/associate
  - category/networking
---

# The Service That Went Quiet

## Opening

- company: Parable Health
- industry: Telehealth for chronic care
- product: patient-facing app that manages chronic care visits, billing, and medication refills
- scale: Series A, 22 engineers, 8,400 active patients, ~650 visits per business day, Stripe-backed billing
- time: Tuesday 16:08, the afternoon after a Monday night deploy that added RDS Proxy for a new admin portal
- scene: Platform on-call Slack. The billing engineer escalated. Stripe dashboard shows accumulating failed capture attempts since late Monday night. The new admin portal is working perfectly.
- alert: no PagerDuty alert. The App Runner service shows RUNNING. Its 5xx rate rose from near zero to 4.8 percent, which is below the 10 percent PagerDuty threshold.
- stakes: 31 Stripe captures failed so far, representing approximately $4,800 in uncaptured visit charges. Billing SLA requires capture within 24 hours of visit completion or the charge must be refunded and re-authorized. Current oldest failed capture is 17 hours old.
- early_signals: Stripe dashboard showing connect timeouts; #billing Slack channel silent since Monday 22:47; admin portal (the thing that was deployed) working fine; RDS Proxy connections steady and healthy
- investigation_starting_point: You know the Monday deploy added an App Runner VPC connector to enable the admin portal to reach RDS Proxy. You have full access to the App Runner service, VPC, RDS Proxy, Secrets Manager, and CloudWatch.

## Resolution

- root_cause: The parable-billing App Runner service has NetworkConfiguration.EgressConfiguration.EgressType=VPC with parable-apprunner-connector attached. That routes ALL outbound traffic (not just RDS) through the VPC subnets. The security group on the connector's ENIs (sg-parable-apprunner) has deliberately tight egress rules: allow 5432 to the RDS Proxy security group, allow 443 to the com.amazonaws.us-east-1.s3 prefix list, allow 443 to the com.amazonaws.us-east-1.secretsmanager prefix list. It has no egress rule to 0.0.0.0/0 or to any prefix list covering Stripe or Slack. The SG implicitly denies everything else. Stripe capture requests and Slack notifications are dropped at the ENI's egress policy before they ever reach the NAT Gateway.
- mechanism: After the deploy, every HTTPS request from parable-billing to api.stripe.com leaves the App Runner runtime and enters an ENI in subnet-priv-a. The subnet's route table has a valid 0.0.0.0/0 -> nat-gateway route and the NAT Gateway is healthy. But before the packet reaches the subnet's route table, the ENI's egress security group rules are evaluated. api.stripe.com's resolved IP is not in 10.12.0.0/16, is not in the S3 prefix list, is not in the Secrets Manager prefix list, and does not match the RDS Proxy SG. The ENI drops the packet with no ICMP response. The TCP client on the App Runner runtime waits out its connect timeout (default 30 seconds) and raises a connect ETIMEDOUT. Node's fetch returns an error the billing service wraps into a 500. Stripe captures fail; Slack notifications fail; the admin portal (which only talks to RDS Proxy) works fine.
- fix: Two changes. Short-term: add an egress rule to sg-parable-apprunner allowing TCP 443 to 0.0.0.0/0 so outbound HTTPS to general internet destinations can flow. This restores Stripe capture and Slack notifications within seconds of the SG change propagating. Medium-term: replace 0.0.0.0/0 with a managed prefix list enumerating the specific public endpoints parable-billing depends on (api.stripe.com IP ranges from Stripe's published ranges, hooks.slack.com, and npm registry for any runtime package fetches). Long-term: evaluate whether the VPC connector is even needed; the billing service itself does not need to talk to RDS, only the admin portal does. Splitting the admin portal into its own App Runner service (with EgressType=VPC) while leaving parable-billing on EgressType=DEFAULT would decouple the two dependencies.
- contributing_factors: The monday deploy PR focused on RDS Proxy wiring and did not call out the EgressType=VPC change as a blast-radius item, even though it is the most consequential networking flip a team can do to an App Runner service. The pre-deploy smoke test covered the admin portal's database call but not any of parable-billing's public-internet outbound paths. The service's 5xx alarm threshold was 10 percent, which is too high for a payment-handling service where any elevated error rate is worth paging on. The security group inherited its tight egress model from the company's general EKS production pattern, without a check for the App Runner-specific implication that the SG now governs public-internet traffic as well. There was no canary for Stripe calls.
