# Opening: One Thread Per Neighbor

It is Friday, 09:48am Pacific. You are the senior SRE on call for Adagio Trading, a
Series A electronic market-making firm trading equity options on three US exchanges.
A product launch is scheduled for 10:00am, twelve minutes from now.

Six minutes ago, an SRE updated `adagio-matcher-service` from desiredCount 40 to 100
ahead of the launch. Two minutes after that, PagerDuty INC-20260424-0948 fired:
`MatcherErrorRate = 12% on adagio-matcher-service, threshold 1%`.

The ECS console says all 100 tasks are RUNNING and reporting healthy via the
container-level health check. Container logs are full of
`java.io.IOException: Too many open files`. The mesh peer registry (Cloud Map)
reports 100 healthy instances. The original 40 tasks were healthy at 40-task scale,
started failing only after the new 60 came online. VPC subnets have ~75% free IPs.

Your job: find why scaling out broke the existing fleet, restore matcher availability
before market open, and identify the configuration that needs to change.
