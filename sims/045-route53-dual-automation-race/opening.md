# Opening: Two Automations, One Record

It is Friday, 16:42pm Pacific. You are the network on call for Halcyon Pay, a
Series B B2B payments and reconciliation platform that processes ~$4 billion in monthly
volume for 800 mid-market customers. A planned blue/green deploy of the payments API
is at 60% traffic shift.

Eleven minutes ago, PagerDuty INC-20260424-1631 fired with text
`External synthetic: api.halcyonpay.com NXDOMAIN from 4 of 6 prober regions`. Three
customers have opened tickets. Synthetic checks show api.halcyonpay.com works for
ninety seconds at a time, then fails for ninety seconds, then works again, in a
regular cycle. A `dig +trace` from outside AWS returns NOERROR with an empty answer
section, then later returns the expected IPs.

The NLB target group reports all targets healthy. The new ECS task set is healthy.
The old task set is still running. CloudTrail shows that someone disabled a deploy
hook two months ago and re-enabled it.

Your job: find why a public hostname is intermittently unresolvable during a deploy
and stop the oscillation.
