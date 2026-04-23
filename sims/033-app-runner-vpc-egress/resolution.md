---
tags:
  - type/resolution
  - service/app-runner
  - service/rds
  - service/vpc
  - service/secrets-manager
  - difficulty/associate
  - category/networking
---

# Resolution: The Service That Went Quiet

## Root Cause

The `parable-billing` App Runner service has `NetworkConfiguration.EgressConfiguration.EgressType=VPC` with the `parable-apprunner-connector` VPC connector attached. With this setting, **all outbound traffic** from the App Runner service (not just traffic destined for in-VPC resources) routes through the VPC connector's ENIs in private subnets.

The security group attached to those ENIs, `sg-parable-apprunner`, has deliberately tight egress rules: allow TCP 5432 to the RDS Proxy security group, allow TCP 443 to the `com.amazonaws.us-east-1.s3` managed prefix list, and allow TCP 443 to the `com.amazonaws.us-east-1.secretsmanager` managed prefix list. Nothing else. The implicit deny drops every outbound packet to `api.stripe.com` and `hooks.slack.com`.

RDS Proxy calls succeed because they have an explicit allow rule. The admin portal's database access works perfectly. The Stripe and Slack calls, which the billing service has been making for years without issue under `EgressType=DEFAULT`, now time out at connect.

## Timeline

| Time | Event |
|---|---|
| Mon 22:36 ET | Deploy PR merges; CodePipeline starts the App Runner update |
| Mon 22:47 ET | App Runner update completes: VPC connector attached, EgressType flipped from DEFAULT to VPC |
| Mon 22:49 ET | First Slack notification failure (silently, no alarm) |
| Mon 23:05 ET | First Stripe capture failure |
| Tue 09:00 ET | Billing operations team starts morning reconciliation, sees yesterday's captures are incomplete |
| Tue 15:42 ET | Billing engineer escalates to platform on-call |
| Tue 16:08 ET | Platform oncall accepts the page |
| Tue 16:14 ET | Curl test from an App Runner container confirms `connect: timeout` to api.stripe.com |
| Tue 16:22 ET | Security group egress rules inspected; missing rule for public 443 traffic identified |
| Tue 16:26 ET | Temporary egress rule added: allow TCP 443 to 0.0.0.0/0 |
| Tue 16:27 ET | Next Stripe capture attempt succeeds |
| Tue 16:31 ET | Slack #billing channel receives the accumulated backlog of notifications |
| Wed 10:00 ET | Follow-up PR replaces 0.0.0.0/0 with a managed prefix list of known public endpoints |

## Correct Remediation

1. **Reproduce the failure deliberately.** Open an AWS Systems Manager session into a short-lived App Runner container (or use App Runner's built-in debugging), and make three outbound calls: one to RDS Proxy, one to an AWS service via VPC endpoint, and one to `api.stripe.com`. Note which succeed. This locates the block surface to "public internet from this ENI".
2. **Read the App Runner network configuration.** Open the service's Configuration > Networking section. Confirm `EgressType` is `VPC` and note which VPC connector is attached.
3. **Trace the outbound path.** A packet from App Runner to `api.stripe.com` traverses: App Runner ENI in subnet -> subnet route table -> NAT Gateway -> internet gateway -> internet. Any break kills the request. The security group on the ENI is the first gate.
4. **Inspect the subnet route table.** Confirm `0.0.0.0/0` has a route to a healthy NAT Gateway and that the NAT is in `available` state with an elastic IP. In this sim, both are fine.
5. **Inspect the ENI's security group egress rules.** The connector's security group is the implicit firewall for every outbound packet. Look for an egress rule matching port 443 to a general internet destination. In this sim, no such rule exists.
6. **Decide on the fix.** Three real options:
   - **Quickest:** add an egress rule `sg-parable-apprunner` allow `tcp:443` to `0.0.0.0/0`. Restores function within seconds of propagation. Acceptable if you later tighten it.
   - **Medium:** create a managed prefix list that enumerates the specific public IP ranges for Stripe, Slack, and any other public dependency. Update `sg-parable-apprunner` to allow 443 to that prefix list. Refresh the prefix list on a schedule (Stripe publishes its ranges and rotates them quarterly).
   - **Best:** revisit whether the VPC connector is the right pattern. In this architecture, only the admin portal needs in-VPC access. Splitting the admin portal into its own App Runner service with `EgressType=VPC` while leaving `parable-billing` on `EgressType=DEFAULT` removes the need for public egress rules entirely.
7. **Verify the fix.** After the SG change, run the same curl test. Confirm Stripe and Slack calls complete. Watch the App Runner 5xx rate in CloudWatch return to its baseline.
8. **Reconcile the Stripe failures.** For each failed capture in the window, confirm the authorization is still valid (Stripe auths expire in 7 days). For any that have expired, re-authorize through the patient billing flow. For ones still valid, replay the capture using Stripe's idempotency keys.
9. **Budget for NAT traffic.** Every outbound byte from the App Runner service now traverses the NAT Gateway. Parable's billing traffic is small, but a service making frequent large API calls (or downloading npm packages at runtime) can accumulate hundreds of dollars per month in NAT data processing charges.
10. **Alarm on App Runner 5xx anomaly.** App Runner does not publish an explicit "outbound failure" metric. The closest proxy is the service's 5xx rate. Use CloudWatch anomaly detection so a sudden rise over baseline pages the oncall, not just an absolute percentage threshold that a service with a normally low error rate can hide under.

## Key Concepts

### App Runner VPC Connectors

AWS App Runner is a managed service for running containerized web apps without touching ECS, ALBs, or Auto Scaling. By default, the service lives on App Runner's managed public network, and its outbound traffic exits through AWS's managed public egress.

A **VPC connector** is the object that attaches an App Runner service to a VPC. When you attach one, App Runner creates elastic network interfaces in the subnets you specify, associates them with a security group you provide, and routes traffic through them according to the service's `EgressConfiguration.EgressType` setting.

Two settings matter:

- **EgressType=DEFAULT**: Outbound traffic uses App Runner's managed public egress. The service can reach public AWS services and the general internet. It cannot reach in-VPC resources.
- **EgressType=VPC**: *All* outbound traffic routes through the VPC connector. In-VPC resources become reachable. Public internet destinations become reachable only if the VPC's routing and security groups permit it.

The setting is a single switch for the entire service. App Runner does not support split routing (some destinations via VPC, others via DEFAULT). If any part of the service needs VPC egress, the whole service uses VPC egress.

### Private Subnet Egress Path

When a packet leaves an ENI in a private subnet bound for a public destination, it follows this chain:

1. **Security group egress rules** on the ENI's security group. If no rule matches, the packet is dropped with no ICMP response, and the client sees a connect timeout.
2. **Network ACL outbound rules** on the subnet. These are stateless; both outbound and the return traffic's inbound must be allowed.
3. **Subnet route table**. For a public destination, `0.0.0.0/0` must point at either a NAT Gateway or a NAT instance.
4. **NAT Gateway health and capacity**. The NAT must be `available` and have port capacity.
5. **Internet gateway**. Attached to the VPC, this is where the NAT egresses to.

Any break at any step produces a silent timeout, not an error. The fastest diagnostic is a `curl -v https://api.stripe.com` from inside the service; the `Connection timed out` message is much more useful than the application's HTTP 500.

### App Runner vs App Runner + VPC Cost Model

A VPC connector itself is free, but the traffic it generates is not.

- With `EgressType=DEFAULT`, outbound traffic uses App Runner's managed egress and costs roughly $0.09/GB for data transfer to the internet (after the AWS free tier).
- With `EgressType=VPC`, every byte of outbound internet traffic traverses the NAT Gateway, adding a NAT processing charge of approximately $0.045/GB on top of the NAT hourly charge (~$0.045/hour per NAT) and the existing data transfer fee.

For a service like Parable's billing (low-bandwidth API calls), the difference is negligible. For a service that downloads large models, container layers, or frequent package updates at runtime, NAT charges can easily reach several hundred dollars per month that did not exist under `EgressType=DEFAULT`.

## Other Ways This Could Break

### The subnets the VPC connector uses are actually public subnets
Instead of failing closed, the service behaves correctly for outbound traffic but the App Runner ENIs receive real public IPs. This is a security risk rather than a connectivity issue: if any security group becomes permissive, the ENI could be reached from the internet directly.
**Prevention:** Audit that VPC connector subnets do not have a route to an internet gateway. An AWS Config custom rule can enforce this.

### NAT Gateway hits its port allocation limit
The security group and route table are both correct, but the NAT cannot open new source ports because existing flows have exhausted the pool. Symptom is intermittent `connect: timeout` and the CloudWatch metric `ErrorPortAllocation` is nonzero.
**Prevention:** Alarm on NAT Gateway `ErrorPortAllocation` and `IdleTimeoutCount`. For very high-throughput workloads, split long-lived connections across multiple NATs or use an NLB-based egress pattern.

### RDS Proxy traffic fails, not Stripe
The VPC connector security group allows outbound 5432, but the RDS Proxy's own security group does not list the connector SG as an allowed source. Stripe calls work (if you later allow them) but DB calls do not.
**Prevention:** When wiring up a VPC connector, explicitly add the connector's SG as an allowed source in every resource SG it needs to reach.

## SOP Best Practices

- App Runner VPC connector routing is all-or-nothing. Decide up front whether the service needs in-VPC egress; if yes, budget for NAT traffic and explicitly permit every class of public dependency in the connector SG.
- Treat a VPC connector security group like a firewall policy. Write egress rules for every class of destination: intra-VPC databases, AWS service endpoints (prefer VPC endpoints), and public internet calls. Do not rely on a generic 0.0.0.0/0 allow except as a temporary fix.
- Prefer VPC endpoints over NAT traversal for AWS services. Gateway endpoints for S3 and DynamoDB are free; interface endpoints for Secrets Manager, KMS, and STS cost less than the equivalent NAT bytes.
- Stage VPC connector changes in a staging App Runner service with a representative outbound-call sample before enabling them in production. Most App Runner outbound bugs look like "the app is fine" on the surface.

## Learning Objectives

1. **App Runner VPC model:** Understand how VPC connectors work and why `EgressType=VPC` routes all outbound traffic, not just in-VPC traffic.
2. **Private subnet egress path:** Trace outbound packets through security groups, NACLs, route tables, and NAT Gateways to identify where silent drops originate.
3. **Security group-first debugging:** Default to checking SG egress rules when symptoms are "connect timeout to a public destination" from an in-VPC resource.
4. **Architecture-level fixes:** Recognize that the right answer is often to split a service rather than to patch around a misconfigured connector.
5. **NAT cost awareness:** Understand that enabling VPC egress changes the cost model, especially for services with significant outbound traffic.

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 2: Design Resilient Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 3: Deployment
- [[learning/catalog.csv]] -- Player service catalog and progress
