PacketForge, 11:32 AM. The CloudWatch error rate dashboard is red.

`packetforge-threat-sync` fires every five minutes on schedule. Every invocation for the last ten minutes has failed. The metric shows zero successful writes to the `packetforge-threats` table.

Ona Reyes, your on-call lead, pings you on Slack: "Ridgeline Financial just opened a P1. Their SOC is running on our feeds. They're seeing stale indicators and their blocking rules are degrading."

Ridgeline is your largest account. Their SLA guarantees 15-minute threat feed freshness. You are already past it.

CloudWatch Logs for `packetforge-threat-sync` are your first stop. What do you look for?
