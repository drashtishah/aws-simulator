---
tags:
  - type/simulation
  - service/transit-gateway
  - service/vpc
  - service/cloudtrail
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# The Route That Was Never There

## Opening

The call came in at 14:30. Payroll processing had stopped. Active Directory authentication was timing out across the payroll VPC. DNS queries were dropping. Monitoring agents had gone silent. The payroll team had been fighting it for an hour before escalating.

Marsh Street Bank runs fourteen production VPCs in a hub-and-spoke Transit Gateway topology. The payroll workloads live in their own VPC, 10.19.0.0/16, and depend on shared services in a separate VPC, 10.0.0.0/16, for everything: AD, DNS, monitoring, certificate management. That cross-VPC path runs through the Transit Gateway.

A junior network engineer had attached a new VPC thirty minutes before the escalation. Routine work. While verifying the new VPC's routing, he ran a Reachability Analyzer path check that happened to traverse the 10.19.0.0/16 destination. The analyzer returned not-reachable. The explanation code: `TGW_RTB_HIGHER_PRIORITY_ROUTE`.

He escalated immediately. The path to payroll was not reachable. It may not have been reachable for a while.

## Resolution

The CloudTrail record told the whole story. Six months earlier, a network engineer had created a static route for 10.19.0.0/16 in the TGW route table `tgw-rtb-main` with the `blackhole: true` flag. The commit message referenced a CIDR reclamation project that was cancelled before completion. The static route was never removed.

A static route in a TGW route table outranks a propagated route for the same CIDR regardless of the static route's state. The blackhole entry had been silently winning the priority contest against the live propagated route from `tgw-attach-payroll` for six months. Every packet destined for the payroll VPC was being dropped at the Transit Gateway. No ICMP unreachable. No alarm. VPC flow logs on the source ENIs showed ACCEPT on egress; there was simply no return traffic because the packets never arrived.

The payroll workloads had been partially functional for six months through a combination of cached AD tokens, local DNS fallbacks, and monitoring gaps. The full failure surfaced only when a new deployment flushed the Kerberos token cache earlier that morning.

The fix took one API call: `DeleteTransitGatewayRoute` on the blackhole entry for 10.19.0.0/16 in `tgw-rtb-main`. The propagated route from `tgw-attach-payroll` became the active path within seconds. Reachability Analyzer confirmed end-to-end connectivity. AD authentication recovered within two minutes.

The post-incident review added a CloudWatch alarm on `PacketDropCountBlackhole` per attachment at threshold 0, and an AWS Config rule that flags any TGW route table containing a blackhole-state static route. The CIDR reclamation project backlog was audited and closed.
