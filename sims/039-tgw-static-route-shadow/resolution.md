---
tags:
  - type/resolution
  - service/transit-gateway
  - service/vpc
  - service/cloudtrail
  - service/cloudwatch
  - difficulty/professional
  - category/networking
---

# Resolution: The Route That Was Never There

## Root Cause

A static route for `10.19.0.0/16` with `State: blackhole` existed in TGW route table `tgw-rtb-main`. In AWS Transit Gateway routing, a static route always takes priority over a propagated route for the same CIDR, regardless of the static route's state. The blackhole entry had been silently outranking the live propagated route from `tgw-attach-payroll` for six months, causing all east-west traffic destined for the payroll VPC to be dropped at the TGW with no error returned to the source.

## Timeline

| Time | Event |
|---|---|
| 2025-10-23T09:14:00Z | `nweng-jdoe` creates static blackhole route for 10.19.0.0/16 in tgw-rtb-main (CIDR reclamation project, later cancelled) |
| 2025-10-23 to 2026-04-23 | All east-west traffic to payroll VPC silently dropped; PacketDropCountBlackhole non-zero for six months |
| 2026-04-23T13:30:00Z | New VPC (10.42.0.0/16) attached to msb-tgw-01 as tgw-attach-new |
| 2026-04-23T14:00:00Z | Engineer runs StartNetworkInsightsAnalysis during new-VPC routing setup; path through 10.19.0.0/16 returns not-reachable with TGW_RTB_HIGHER_PRIORITY_ROUTE |
| 2026-04-23T14:30:00Z | Escalation received; incident investigation begins |
| 2026-04-23T14:47:00Z | DeleteTransitGatewayRoute called on blackhole entry for 10.19.0.0/16 in tgw-rtb-main |
| 2026-04-23T14:49:00Z | Reachability Analyzer confirms networkPathFound: true; AD authentication recovers |

## Correct Remediation

1. **Immediate**: Call `DeleteTransitGatewayRoute` specifying `TransitGatewayRouteTableId: tgw-rtb-main` and `DestinationCidrBlock: 10.19.0.0/16`. This removes the blackhole static entry. The propagated route from `tgw-attach-payroll` becomes the active route for that CIDR immediately.
2. **Verify**: Run `StartNetworkInsightsAnalysis` on a path from a payroll-VPC ENI to a shared-services-VPC ENI. A result of `networkPathFound: true` confirms the fix.
3. **Detection**: Create a CloudWatch alarm on `PacketDropCountBlackhole` in the `AWS/TransitGateway` namespace, filtered by the `TransitGatewayAttachment` dimension. Set threshold to 0 (any drop is an alert). A blackhole active for six months without detection means no alarm existed.
4. **Prevention**: Add an AWS Config rule that flags TGW route tables containing any route with `State: blackhole`. Run `SearchTransitGatewayRoutes` with filter `State=blackhole` after every TGW route-table change as a mandatory post-change health check.

## Key Concepts

### TGW Static vs. Propagated Route Priority

A Transit Gateway route table can contain two types of routes:

- **Propagated routes**: automatically learned from VPC attachments when propagation is enabled. They reflect the actual CIDR of the attached VPC and are kept current by AWS.
- **Static routes**: manually created by an operator. They map a CIDR to a specific attachment or to a blackhole target.

When both a static route and a propagated route exist for the same CIDR, the static route always wins. This is true even if the static route's `State` is `blackhole`. AWS applies the priority rule before evaluating state. A blackhole static route therefore silently shadows a perfectly healthy propagated route.

### Blackhole Routes

A blackhole route is a static route with no valid attachment target. The Transit Gateway accepts packets that match the route, then drops them with no response. From the source VPC's perspective, the packet left the ENI (flow log shows `ACCEPT` on egress), but no response ever arrives. There is no ICMP port-unreachable or host-unreachable. The connection simply times out.

This silent failure mode makes blackhole routes difficult to detect without purpose-built monitoring (`PacketDropCountBlackhole`) or path-analysis tools (Reachability Analyzer).

### Reachability Analyzer Explanation Codes

When Reachability Analyzer returns `networkPathFound: false`, it includes an `ExplanationCode` that identifies the blocking component. Key codes for TGW routing issues:

- `TGW_RTB_HIGHER_PRIORITY_ROUTE`: a static route in the TGW route table is outranking the route to the target attachment. Check for blackhole or misdirected static routes.
- `TGW_RTB_NO_ROUTE_TO_TGW_ATTACHMENT`: no route exists at all for the destination CIDR. Route propagation may not be enabled on the attachment association.
- `TGW_RTB_MORE_SPECIFIC_ROUTE`: a more-specific static route matches before the expected propagated route, causing partial reachability.

### VPC Flow Logs and the TGW Drop

VPC flow logs are captured at the ENI level. When a source ENI in shared-services-vpc sends a packet to payroll-vpc:

1. The packet leaves the source ENI: flow log records `ACCEPT` for the outbound direction.
2. The Transit Gateway receives the packet and looks up the destination (10.19.0.0/16) in tgw-rtb-main.
3. The blackhole static route matches and the packet is dropped inside the TGW.
4. No return traffic ever reaches the source ENI, so there is no return-path entry in the flow log.

The result: egress flow log entries with `ACCEPT` and no corresponding ingress on the destination ENI. This asymmetric pattern in the flow logs points to a mid-path drop, not a security group or NACL denial.

## Other Ways This Could Break

### Missing propagated route

The VPC attachment exists but route propagation is not enabled on the route table association, so no route at all exists for the payroll CIDR. Reachability Analyzer returns `TGW_RTB_NO_ROUTE_TO_TGW_ATTACHMENT`; `SearchTransitGatewayRoutes` returns no entry for the CIDR rather than a blackhole. The fix is to enable propagation on the attachment association, not to delete a route.
**Prevention:** Enforce route propagation on all attachments via AWS Config rule. Alert when a new attachment has no propagated route within 5 minutes.

### Overlapping CIDR conflict

A more-specific static route (for example 10.19.1.0/24) coexists with a propagated /16, causing partial reachability that varies by destination IP. Some payroll hosts are reachable and some are not. Reachability Analyzer returns `TGW_RTB_MORE_SPECIFIC_ROUTE`; no blackhole flag appears in the route state. The issue is harder to notice because some traffic flows normally.
**Prevention:** Audit for overlapping CIDRs before adding any static route. Run `SearchTransitGatewayRoutes` after every route-table change and compare static and propagated entries for CIDR overlap.

## SOP Best Practices

- Run `SearchTransitGatewayRoutes` with filter `State=blackhole` after every TGW route-table change. A blackhole created during a maintenance window six months ago will surface before it silently affects workloads.
- Alarm on `PacketDropCountBlackhole` per attachment at threshold 0 in the `AWS/TransitGateway` namespace. A blackhole that was always present but suddenly matters because workloads shifted will be caught before an incident is reported.

## Learning Objectives

1. **Static-vs-propagated priority**: Static routes in a TGW route table outrank propagated routes for the same CIDR even when the static route is in BLACKHOLE state. Priority is evaluated before state.
2. **Blackhole silent failure**: A blackhole route drops packets silently; VPC flow logs show ACCEPT on egress from the source ENI but no return-path entries, because the drop occurs at the TGW after the packet has left the source VPC.
3. **Detection tooling**: `PacketDropCountBlackhole` in `AWS/TransitGateway` is the canonical metric for blackhole-route drops; Reachability Analyzer returns `TGW_RTB_HIGHER_PRIORITY_ROUTE` for the same condition and pinpoints the route table responsible.
